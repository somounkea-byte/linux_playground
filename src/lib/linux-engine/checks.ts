/**
 * State-based grading. Every check inspects the final virtual machine state,
 * so any valid sequence of commands that reaches the goal passes.
 */
import { z } from "zod";
import { VirtualFileSystem } from "./filesystem";
import { modeToOctal } from "./permissions";
import { LinuxEnvironment } from "./terminal";
import type { EnvState } from "./types";
import { findGroup, findUser, groupsOf } from "./users";
import { stripAnsi } from "./util";

const base = { id: z.string().min(1).max(64), description: z.string().min(1).max(300), hint: z.string().max(500).optional() };
const path = z.string().min(1).max(4096).startsWith("/");
const name = z.string().min(1).max(64);

export const checkSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("file_exists"), path, kind: z.enum(["file", "dir", "symlink"]).optional() }),
  z.object({ ...base, type: z.literal("file_not_exists"), path }),
  z.object({ ...base, type: z.literal("file_contains"), path, text: z.string().max(2000), ignoreCase: z.boolean().optional() }),
  z.object({ ...base, type: z.literal("file_matches"), path, pattern: z.string().max(500) }),
  z.object({ ...base, type: z.literal("file_mode"), path, mode: z.string().regex(/^[0-7]{3,4}$/) }),
  z.object({ ...base, type: z.literal("file_owner"), path, user: name.optional(), group: name.optional() }),
  z.object({ ...base, type: z.literal("user_exists"), username: name, shell: z.string().max(100).optional(), home: z.string().max(200).optional(), homeExists: z.boolean().optional() }),
  z.object({ ...base, type: z.literal("user_not_exists"), username: name }),
  z.object({ ...base, type: z.literal("user_locked"), username: name, locked: z.boolean() }),
  z.object({ ...base, type: z.literal("user_has_password"), username: name }),
  z.object({ ...base, type: z.literal("group_exists"), group: name }),
  z.object({ ...base, type: z.literal("group_not_exists"), group: name }),
  z.object({ ...base, type: z.literal("user_in_group"), username: name, group: name }),
  z.object({ ...base, type: z.literal("user_not_in_group"), username: name, group: name }),
  z.object({ ...base, type: z.literal("user_primary_group"), username: name, group: name }),
  z.object({ ...base, type: z.literal("package_installed"), name }),
  z.object({ ...base, type: z.literal("package_not_installed"), name }),
  z.object({ ...base, type: z.literal("service_active"), name, active: z.boolean() }),
  z.object({ ...base, type: z.literal("service_enabled"), name, enabled: z.boolean() }),
  z.object({ ...base, type: z.literal("process_running"), name, running: z.boolean() }),
  z.object({ ...base, type: z.literal("firewall_enabled"), enabled: z.boolean() }),
  z.object({ ...base, type: z.literal("firewall_rule"), port: z.string().max(20), proto: z.enum(["tcp", "udp"]).optional(), action: z.enum(["allow", "deny", "reject", "limit"]).optional() }),
  z.object({ ...base, type: z.literal("disk_mounted"), device: z.string().max(40), mountpoint: path }),
  z.object({ ...base, type: z.literal("disk_formatted"), device: z.string().max(40), fstype: z.string().max(20).optional() }),
  z.object({ ...base, type: z.literal("interface_up"), name, up: z.boolean() }),
  z.object({ ...base, type: z.literal("cwd"), path }),
  z.object({ ...base, type: z.literal("hostname"), value: name }),
  z.object({ ...base, type: z.literal("history_contains"), pattern: z.string().max(300) }),
  z.object({ ...base, type: z.literal("command_output"), command: z.string().max(1000), contains: z.string().max(2000).optional(), equals: z.string().max(4000).optional(), asUser: name.optional(), exitCode: z.number().int().optional() }),
]);

export type Check = z.infer<typeof checkSchema>;
export const checksSchema = z.array(checkSchema).max(50);

export interface CheckResult {
  id: string;
  description: string;
  passed: boolean;
  detail?: string;
}

export const CHECK_TYPE_LABELS: Record<Check["type"], string> = {
  file_exists: "File / directory exists",
  file_not_exists: "File / directory does not exist",
  file_contains: "File contains text",
  file_matches: "File matches regex",
  file_mode: "Permission mode equals",
  file_owner: "Owner / group equals",
  user_exists: "User exists",
  user_not_exists: "User does not exist",
  user_locked: "Account locked state",
  user_has_password: "User has a password",
  group_exists: "Group exists",
  group_not_exists: "Group does not exist",
  user_in_group: "User is member of group",
  user_not_in_group: "User is not member of group",
  user_primary_group: "User's primary group",
  package_installed: "Package installed",
  package_not_installed: "Package not installed",
  service_active: "Service running state",
  service_enabled: "Service enabled at boot",
  process_running: "Process running",
  firewall_enabled: "Firewall enabled",
  firewall_rule: "Firewall rule exists",
  disk_mounted: "Disk mounted",
  disk_formatted: "Disk formatted",
  interface_up: "Network interface state",
  cwd: "Current directory",
  hostname: "Hostname",
  history_contains: "Command was used",
  command_output: "Command output",
};

function safeRegex(pattern: string, flags = ""): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

export function evaluateCheck(state: EnvState, check: Check, now = Date.now()): CheckResult {
  const fs = new VirtualFileSystem(state);
  const res = (passed: boolean, detail?: string): CheckResult => ({ id: check.id, description: check.description, passed, detail });
  const node = "path" in check && check.type !== "cwd" ? fs.tryLookup(check.path, "/", null, check.type !== "file_exists" || check.kind !== "symlink") : null;
  const user = "username" in check ? state.users.find((u) => u.username === check.username) : undefined;

  switch (check.type) {
    case "file_exists":
      if (!node) return res(false, `${check.path} does not exist`);
      if (check.kind && node.type !== check.kind) return res(false, `${check.path} is not a ${check.kind === "dir" ? "directory" : check.kind}`);
      return res(true);
    case "file_not_exists":
      return res(!node, node ? `${check.path} still exists` : undefined);
    case "file_contains": {
      if (!node || node.type !== "file") return res(false, `${check.path} is not a file`);
      const ok = check.ignoreCase ? node.content.toLowerCase().includes(check.text.toLowerCase()) : node.content.includes(check.text);
      return res(ok, ok ? undefined : `${check.path} does not contain the expected text`);
    }
    case "file_matches": {
      if (!node || node.type !== "file") return res(false, `${check.path} is not a file`);
      const re = safeRegex(check.pattern, "m");
      return res(!!re && re.test(node.content), "content does not match");
    }
    case "file_mode": {
      if (!node) return res(false, `${check.path} does not exist`);
      const want = parseInt(check.mode, 8);
      const have = check.mode.length === 4 ? node.mode & 0o7777 : node.mode & 0o777;
      return res(have === want, `mode is ${modeToOctal(node.mode & 0o7777, check.mode.length)}, expected ${check.mode}`);
    }
    case "file_owner": {
      if (!node) return res(false, `${check.path} does not exist`);
      const owner = findUser(state, node.uid)?.username ?? String(node.uid);
      const group = findGroup(state, node.gid)?.name ?? String(node.gid);
      if (check.user && owner !== check.user) return res(false, `owner is ${owner}, expected ${check.user}`);
      if (check.group && group !== check.group) return res(false, `group is ${group}, expected ${check.group}`);
      return res(true);
    }
    case "user_exists": {
      if (!user) return res(false, `user ${check.username} does not exist`);
      if (check.shell && user.shell !== check.shell) return res(false, `shell is ${user.shell}, expected ${check.shell}`);
      if (check.home && user.home !== check.home) return res(false, `home is ${user.home}, expected ${check.home}`);
      if (check.homeExists && fs.tryLookup(user.home, "/")?.type !== "dir") return res(false, `home directory ${user.home} was not created`);
      return res(true);
    }
    case "user_not_exists":
      return res(!user, user ? `user ${check.username} still exists` : undefined);
    case "user_locked":
      if (!user) return res(false, `user ${check.username} does not exist`);
      return res(user.locked === check.locked, user.locked ? "account is locked" : "account is not locked");
    case "user_has_password":
      if (!user) return res(false, `user ${check.username} does not exist`);
      return res(user.passwordHash.startsWith("$"), "no password has been set");
    case "group_exists":
      return res(!!state.groups.find((g) => g.name === check.group), `group ${check.group} does not exist`);
    case "group_not_exists":
      return res(!state.groups.find((g) => g.name === check.group), `group ${check.group} still exists`);
    case "user_in_group": {
      if (!state.users.find((u) => u.username === check.username)) return res(false, `user ${check.username} does not exist`);
      const ok = groupsOf(state, check.username).some((g) => g.name === check.group);
      return res(ok, `${check.username} is not in ${check.group}`);
    }
    case "user_not_in_group":
      return res(!groupsOf(state, check.username).some((g) => g.name === check.group), `${check.username} is still in ${check.group}`);
    case "user_primary_group": {
      if (!user) return res(false, `user ${check.username} does not exist`);
      const g = findGroup(state, user.gid)?.name;
      return res(g === check.group, `primary group is ${g}`);
    }
    case "package_installed":
      return res(!!state.packages.installed[check.name], `${check.name} is not installed`);
    case "package_not_installed":
      return res(!state.packages.installed[check.name], `${check.name} is still installed`);
    case "service_active": {
      const active = !!state.services[check.name]?.active;
      return res(active === check.active, `${check.name} is ${active ? "running" : "not running"}`);
    }
    case "service_enabled": {
      const enabled = !!state.services[check.name]?.enabled;
      return res(enabled === check.enabled, `${check.name} is ${enabled ? "enabled" : "disabled"}`);
    }
    case "process_running": {
      const running = state.processes.some((p) => p.command === check.name || p.args.split(" ")[0].endsWith(`/${check.name}`));
      return res(running === check.running, `${check.name} is ${running ? "running" : "not running"}`);
    }
    case "firewall_enabled":
      return res(state.firewall.enabled === check.enabled, `firewall is ${state.firewall.enabled ? "active" : "inactive"}`);
    case "firewall_rule": {
      const ok = state.firewall.rules.some((r) => r.port.split(/[,:]/).includes(check.port) && (!check.proto || !r.proto || r.proto === check.proto) && r.action === (check.action ?? "allow"));
      return res(ok, `no ${check.action ?? "allow"} rule for port ${check.port}`);
    }
    case "disk_mounted": {
      const d = state.disks.find((x) => `/dev/${x.name}` === check.device || x.name === check.device);
      return res(d?.mountpoint === check.mountpoint, d?.mountpoint ? `mounted on ${d.mountpoint}` : `${check.device} is not mounted`);
    }
    case "disk_formatted": {
      const d = state.disks.find((x) => `/dev/${x.name}` === check.device || x.name === check.device);
      return res(!!d?.fstype && (!check.fstype || d.fstype === check.fstype), d?.fstype ? `file system is ${d.fstype}` : "no file system");
    }
    case "interface_up": {
      const i = state.network.interfaces.find((x) => x.name === check.name);
      return res(!!i && i.up === check.up, i ? `${check.name} is ${i.up ? "up" : "down"}` : `no interface ${check.name}`);
    }
    case "cwd": {
      const frame = state.session.userStack[state.session.userStack.length - 1];
      return res(frame.cwd === check.path, `you are in ${frame.cwd}`);
    }
    case "hostname":
      return res(state.hostname === check.value, `hostname is ${state.hostname}`);
    case "history_contains": {
      const re = safeRegex(check.pattern);
      return res(!!re && state.session.history.some((h) => re.test(h)), "command not used yet");
    }
    case "command_output": {
      const clone = structuredClone(state);
      const env = new LinuxEnvironment(clone);
      let result: { output: string; exitCode: number };
      if (check.asUser && check.asUser !== "root") {
        if (!clone.users.some((u) => u.username === check.asUser)) return res(false, `user ${check.asUser} does not exist`);
        clone.session.userStack.push({ user: check.asUser, cwd: findUser(clone, check.asUser)!.home, login: true });
        const r = env.execute(check.command, { now, noHistory: true, maxSteps: 5000 });
        result = { output: r.needsInput ? r.output : r.output, exitCode: r.exitCode };
      } else result = env.runAsRoot(check.command, { now });
      const out = stripAnsi(result.output);
      if (check.exitCode !== undefined && result.exitCode !== check.exitCode) return res(false, `exit code ${result.exitCode}`);
      if (check.equals !== undefined && out.trim() !== check.equals.trim()) return res(false, "output differs from expected");
      if (check.contains !== undefined && !out.includes(check.contains)) return res(false, "expected output not found");
      return res(true);
    }
  }
}

export function evaluateChecks(state: EnvState, checks: Check[], now = Date.now()): CheckResult[] {
  return checks.map((c) => {
    try {
      return evaluateCheck(state, c, now);
    } catch (e) {
      return { id: c.id, description: c.description, passed: false, detail: `check failed: ${(e as Error).message}` };
    }
  });
}
