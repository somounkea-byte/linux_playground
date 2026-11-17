import "server-only";
import { z } from "zod";
import { formatMode, listeningSockets, memoryStats, modeToOctal, mountTable, REPOSITORY } from "@/lib/linux-engine";
import { canAccess } from "@/lib/linux-engine/permissions";
import type { LinuxEnvironment } from "@/lib/linux-engine";
import { addGroup, addUser, addUserToGroup, deleteGroup, deleteUser, groupsOf, identityFor, removeUserFromGroup, syncEtcFiles, UserError, validateName } from "@/lib/linux-engine/users";
import { hashPassword } from "@/lib/linux-engine/util";
import { badRequest } from "../http";

const nameSchema = z.string().min(1).max(32).regex(/^[a-z_][a-z0-9_-]*$/, "Use lowercase letters, digits, - and _");
const pathSchema = z.string().min(1).max(1024);

/** Quote a value for the simulated shell. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function userErr(e: unknown): never {
  if (e instanceof UserError) throw badRequest(e.message);
  throw e;
}

// ---------------------------------------------------------------- users

export function listUsersAndGroups(env: LinuxEnvironment) {
  const s = env.state;
  return {
    users: s.users.map((u) => ({
      username: u.username,
      uid: u.uid,
      gid: u.gid,
      gecos: u.gecos,
      primaryGroup: s.groups.find((g) => g.gid === u.gid)?.name ?? String(u.gid),
      groups: groupsOf(s, u.username)
        .map((g) => g.name)
        .filter((g) => g !== s.groups.find((x) => x.gid === u.gid)?.name),
      home: u.home,
      shell: u.shell,
      locked: u.locked,
      hasPassword: u.passwordHash.startsWith("$"),
      system: u.uid > 0 && u.uid < 1000 || u.uid === 65534,
    })),
    groups: s.groups.map((g) => ({ name: g.name, gid: g.gid, members: g.members, system: g.gid < 1000 || g.gid === 65534, primaryOf: s.users.filter((u) => u.gid === g.gid).map((u) => u.username) })),
  };
}

export const userActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), username: nameSchema, fullName: z.string().max(100).optional(), shell: z.enum(["/bin/bash", "/bin/sh", "/usr/sbin/nologin"]).default("/bin/bash"), createHome: z.boolean().default(true), groups: z.array(nameSchema).max(20).default([]), password: z.string().min(1).max(100).optional() }),
  z.object({ action: z.literal("delete"), username: nameSchema, removeHome: z.boolean().default(false) }),
  z.object({ action: z.literal("lock"), username: nameSchema }),
  z.object({ action: z.literal("unlock"), username: nameSchema }),
  z.object({ action: z.literal("password"), username: nameSchema, password: z.string().min(1).max(100) }),
  z.object({ action: z.literal("shell"), username: nameSchema, shell: z.enum(["/bin/bash", "/bin/sh", "/usr/sbin/nologin"]) }),
  z.object({ action: z.literal("setGroups"), username: nameSchema, groups: z.array(nameSchema).max(30) }),
]);

export function applyUserAction(env: LinuxEnvironment, a: z.infer<typeof userActionSchema>) {
  const s = env.state;
  const now = Date.now();
  const log = (msg: string) => s.logs.push({ ts: now, file: "auth", source: "linux-playground-gui", message: msg });
  try {
    switch (a.action) {
      case "create": {
        if (!validateName(a.username)) throw badRequest("Invalid user name");
        const { user } = addUser(s, env.fs, { username: a.username, createHome: a.createHome, shell: a.shell, gecos: a.fullName ? `${a.fullName},,,` : "", groups: a.groups, now });
        if (a.password) user.passwordHash = hashPassword(a.password);
        log(`new user: name=${a.username}, UID=${user.uid}, GID=${user.gid}, home=${user.home}, shell=${user.shell} (graphical tool)`);
        break;
      }
      case "delete":
        if (s.users.find((u) => u.username === a.username)?.uid === 0) throw badRequest("You cannot delete root.");
        if (a.username === "student") throw badRequest("You cannot delete the account you are logged in with.");
        deleteUser(s, env.fs, a.username, a.removeHome, now);
        log(`delete user '${a.username}' (graphical tool)`);
        break;
      case "lock":
      case "unlock": {
        const u = s.users.find((x) => x.username === a.username);
        if (!u) throw badRequest(`user '${a.username}' does not exist`);
        u.locked = a.action === "lock";
        break;
      }
      case "password": {
        const u = s.users.find((x) => x.username === a.username);
        if (!u) throw badRequest(`user '${a.username}' does not exist`);
        u.passwordHash = hashPassword(a.password);
        u.lastChange = Math.floor(now / 86400000);
        log(`password changed for ${a.username} (graphical tool)`);
        break;
      }
      case "shell": {
        const u = s.users.find((x) => x.username === a.username);
        if (!u) throw badRequest(`user '${a.username}' does not exist`);
        u.shell = a.shell;
        break;
      }
      case "setGroups": {
        const u = s.users.find((x) => x.username === a.username);
        if (!u) throw badRequest(`user '${a.username}' does not exist`);
        for (const g of a.groups) if (!s.groups.some((x) => x.name === g)) throw badRequest(`group '${g}' does not exist`);
        for (const g of s.groups) {
          if (g.gid === u.gid) continue;
          const want = a.groups.includes(g.name);
          const has = g.members.includes(u.username);
          if (want && !has) addUserToGroup(s, u.username, g.name);
          if (!want && has) removeUserFromGroup(s, u.username, g.name);
        }
        break;
      }
    }
  } catch (e) {
    userErr(e);
  }
  syncEtcFiles(s, env.fs, now);
}

export const groupActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: nameSchema }),
  z.object({ action: z.literal("delete"), name: nameSchema }),
  z.object({ action: z.literal("addMember"), name: nameSchema, username: nameSchema }),
  z.object({ action: z.literal("removeMember"), name: nameSchema, username: nameSchema }),
]);

export function applyGroupAction(env: LinuxEnvironment, a: z.infer<typeof groupActionSchema>) {
  const s = env.state;
  try {
    if (a.action === "create") addGroup(s, a.name);
    else if (a.action === "delete") deleteGroup(s, a.name);
    else if (a.action === "addMember") addUserToGroup(s, a.username, a.name);
    else removeUserFromGroup(s, a.username, a.name);
  } catch (e) {
    userErr(e);
  }
  syncEtcFiles(s, env.fs, Date.now());
}

// ---------------------------------------------------------------- files

export function listDirectory(env: LinuxEnvironment, path: string) {
  const s = env.state;
  const frame = s.session.userStack[0];
  const who = identityFor(s, frame.user);
  const node = env.fs.tryLookup(path, frame.cwd, who);
  if (!node) throw badRequest(`${path}: No such file or directory`);
  const dir = node.type === "dir" ? node : null;
  if (!dir) throw badRequest(`${path}: Not a directory`);
  const abs = env.fs.pathOf(dir);
  const name = (uid: number) => s.users.find((u) => u.uid === uid)?.username ?? String(uid);
  const group = (gid: number) => s.groups.find((g) => g.gid === gid)?.name ?? String(gid);
  const readable = canAccess(dir, who, 4) && canAccess(dir, who, 1);
  const entries = readable
    ? env.fs
        .list(dir)
        .sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1) || a.name.localeCompare(b.name))
        .map((n) => ({
          name: n.name,
          path: abs === "/" ? `/${n.name}` : `${abs}/${n.name}`,
          type: n.type,
          mode: modeToOctal(n.mode, n.mode > 0o777 ? 4 : 3),
          symbolic: formatMode(n),
          owner: name(n.uid),
          group: group(n.gid),
          size: env.fs.sizeOf(n),
          mtime: n.mtime,
          target: n.target ?? null,
        }))
    : [];
  return { path: abs, readable, writable: canAccess(dir, who, 3), entries, user: frame.user };
}

export const fileActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mkdir"), path: pathSchema, sudo: z.boolean().default(false) }),
  z.object({ action: z.literal("touch"), path: pathSchema, sudo: z.boolean().default(false) }),
  z.object({ action: z.literal("delete"), path: pathSchema, sudo: z.boolean().default(false) }),
  z.object({ action: z.literal("rename"), path: pathSchema, to: pathSchema, sudo: z.boolean().default(false) }),
  z.object({ action: z.literal("chmod"), path: pathSchema, mode: z.string().regex(/^[0-7]{3,4}$/), recursive: z.boolean().default(false), sudo: z.boolean().default(false) }),
  z.object({ action: z.literal("chown"), path: pathSchema, owner: nameSchema.optional(), group: nameSchema.optional(), recursive: z.boolean().default(false), sudo: z.boolean().default(true) }),
  z.object({ action: z.literal("write"), path: pathSchema, content: z.string().max(200_000), executable: z.boolean().default(false), sudo: z.boolean().default(false) }),
]);

/** Translate a GUI action into the equivalent shell command, so it obeys the same rules. */
export function fileActionCommand(a: z.infer<typeof fileActionSchema>): string {
  const p = shellQuote(a.path);
  switch (a.action) {
    case "mkdir":
      return `mkdir -p ${p}`;
    case "touch":
      return `touch ${p}`;
    case "delete":
      return `rm -rf ${p}`;
    case "rename":
      return `mv ${p} ${shellQuote(a.to)}`;
    case "chmod":
      return `chmod ${a.recursive ? "-R " : ""}${a.mode} ${p}`;
    case "chown": {
      if (!a.owner && !a.group) throw badRequest("Choose an owner or a group.");
      const spec = `${a.owner ?? ""}${a.group ? `:${a.group}` : ""}`;
      return `chown ${a.recursive ? "-R " : ""}${spec} ${p}`;
    }
    case "write": {
      let delim = "LP_EOF";
      while (a.content.split("\n").includes(delim)) delim += "_X";
      const body = a.content.endsWith("\n") ? a.content : a.content + "\n";
      return `cat > ${p} <<'${delim}'\n${body}${delim}${a.executable ? `\nchmod +x ${p}` : ""}`;
    }
  }
}

/** Run a GUI command as the logged-in user (or root when sudo is requested). */
export function runGuiCommand(env: LinuxEnvironment, command: string, sudo: boolean) {
  if (sudo) {
    const r = env.runAsRoot(command);
    return { command: `sudo ${command}`, ...r };
  }
  const stack = env.state.session.userStack;
  const saved = stack.splice(1);
  const savedCwd = stack[0].cwd;
  const savedHistory = [...env.state.session.history];
  try {
    const r = env.execute(command, { noHistory: true });
    return { command, output: r.output, exitCode: r.exitCode };
  } finally {
    stack.push(...saved);
    stack[0].cwd = savedCwd;
    env.state.session.history = savedHistory;
  }
}

// ---------------------------------------------------------------- processes, packages, system

export function listProcesses(env: LinuxEnvironment) {
  return env.state.processes.map((p) => ({ pid: p.pid, ppid: p.ppid, user: p.user, command: p.command, args: p.args, state: p.state, cpu: p.cpu, mem: p.mem, rss: p.rss, nice: p.nice, service: p.service ?? null, kernel: !!p.kernel, startedAt: p.startedAt }));
}

export function listPackages(env: LinuxEnvironment) {
  const installed = env.state.packages.installed;
  return REPOSITORY.map((p) => ({
    name: p.name,
    description: p.description,
    section: p.section,
    version: installed[p.name]?.version ?? (env.state.packages.lastUpdate && p.newVersion ? p.newVersion : p.version),
    installed: !!installed[p.name],
    auto: installed[p.name]?.auto ?? false,
    upgradable: !!installed[p.name] && !!env.state.packages.lastUpdate && !!p.newVersion && installed[p.name].version !== p.newVersion,
    service: p.service?.unit ?? null,
    essential: !!p.essential,
    preinstalled: !!p.preinstalled,
    sizeKb: p.installedSizeKb,
  }));
}

export function systemInfo(env: LinuxEnvironment) {
  const s = env.state;
  const now = Date.now();
  return {
    hostname: s.hostname,
    interfaces: s.network.interfaces,
    gateway: s.network.gateway,
    dns: s.network.dns,
    sockets: listeningSockets(s),
    firewall: s.firewall,
    services: Object.values(s.services).sort((a, b) => a.name.localeCompare(b.name)),
    mounts: mountTable(s, env.fs),
    disks: s.disks,
    memory: memoryStats(s, now),
    uptimeSeconds: Math.floor((now - s.bootTime) / 1000),
    authLog: s.logs.filter((l) => l.file === "auth").slice(-12).reverse(),
  };
}
