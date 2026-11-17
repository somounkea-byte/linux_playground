import { basename, dirname, FsError, normalizePath } from "../filesystem";
import { BINARY_MARKER } from "../interpreter";
import { PACKAGE_INDEX, REPOSITORY } from "../packages";
import { canAccess, R, W, X } from "../permissions";
import { baseProcesses, startServiceProcesses, stopServiceProcesses } from "../processes";
import type { FsNode } from "../types";
import { findUser, groupsOf } from "../users";
import { DAYS, MONTHS, syslogDate } from "../util";
import { errMsg, lines, readInputs, resolve, withOpts } from "./helpers";
import { serviceOwner } from "./packages";
import type { CommandContext, CommandDef } from "./types";

const KERNEL = "6.8.0-45-generic";

// --------------------------------------------------------------- man/which

function man(ctx: CommandContext): number {
  const name = ctx.args.filter((a) => !a.startsWith("-") && !/^\d$/.test(a))[0];
  if (!name) {
    ctx.err("What manual page do you want?\nFor example, try 'man man'.\n");
    return 1;
  }
  const def = ctx.shell.registry.get(name);
  if (!def || def.hidden) {
    ctx.err(`No manual entry for ${name}\n`);
    return 16;
  }
  const b = (s: string) => (ctx.stdoutIsTTY ? `\x1b[1m${s}\x1b[0m` : s);
  const u = (s: string) => (ctx.stdoutIsTTY ? `\x1b[4m${s}\x1b[0m` : s);
  const title = `${name.toUpperCase()}(${def.builtin ? "1" : def.category === "users" || def.binDir === "/usr/sbin" ? "8" : "1"})`;
  const header = `${title}${" ".repeat(Math.max(1, 78 - title.length * 2 - 16))}User Commands${" ".repeat(4)}${title}`;
  let out = `${header}\n\n${b("NAME")}\n       ${name} - ${def.description.replace(/\.$/, "")}\n\n${b("SYNOPSIS")}\n       ${b(def.syntax.split(" ")[0])} ${def.syntax.split(" ").slice(1).map((w) => (/^[A-Z]/.test(w.replace(/[[\].]/g, "")) ? u(w) : w)).join(" ")}\n\n${b("DESCRIPTION")}\n       ${def.description}\n`;
  if (def.builtin) out += `\n       ${name} is a shell builtin; see also: help ${name}\n`;
  if (def.options?.length) {
    out += `\n${b("OPTIONS")}\n`;
    for (const o of def.options) out += `       ${b(o.flag)}\n              ${o.description}\n\n`;
  }
  if (def.examples?.length) {
    out += `${b("EXAMPLES")}\n`;
    for (const e of def.examples) out += `       ${e.command}\n              ${e.description}\n\n`;
  }
  if (def.permissions) out += `${b("PERMISSIONS")}\n       ${def.permissions}\n\n`;
  out += `${b("SEE ALSO")}\n       Linux Playground command reference\n\nLinux Playground${" ".repeat(30)}2024${" ".repeat(26)}${title}\n`;
  ctx.out(out);
  return 0;
}

function which(ctx: CommandContext): number {
  const all = ctx.args.includes("-a");
  let status = 0;
  for (const n of ctx.args.filter((a) => !a.startsWith("-"))) {
    if (n.includes("/")) {
      const node = ctx.fs.tryLookup(n, ctx.cwd, ctx.who);
      if (node && node.type === "file" && canAccess(node, ctx.who, X)) ctx.out(n + "\n");
      else status = 1;
      continue;
    }
    const path = ctx.shell.getVar("PATH") ?? "";
    let found = false;
    for (const dir of path.split(":")) {
      const node = ctx.fs.tryLookup(`${dir}/${n}`, "/", ctx.who);
      if (node && node.type === "file" && canAccess(node, ctx.who, X)) {
        ctx.out(`${dir}/${n}\n`);
        found = true;
        if (!all) break;
      }
    }
    if (!found) status = 1;
  }
  return status;
}

function whereis(ctx: CommandContext): number {
  for (const n of ctx.args.filter((a) => !a.startsWith("-"))) {
    const found = ctx.shell.searchPath(n);
    const def = ctx.shell.registry.get(n);
    const manSection = def?.binDir === "/usr/sbin" ? 8 : 1;
    ctx.out(`${n}:${found ? ` ${found.path}` : ""}${def && !def.hidden ? ` /usr/share/man/man${manSection}/${n}.${manSection}.gz` : ""}\n`);
  }
  return 0;
}

function whatis(ctx: CommandContext): number {
  let status = 0;
  for (const n of ctx.args) {
    const def = ctx.shell.registry.get(n);
    if (!def) {
      ctx.out(`${n}: nothing appropriate.\n`);
      status = 16;
      continue;
    }
    ctx.out(`${`${n} (1)`.padEnd(21)}- ${def.description.replace(/\.$/, "")}\n`);
  }
  return status;
}

function apropos(ctx: CommandContext): number {
  const term = ctx.args[0];
  if (!term) {
    ctx.err("apropos what?\n");
    return 1;
  }
  const re = new RegExp(term, "i");
  const matches = [...new Set(ctx.shell.registry.values())].filter((d) => !d.hidden && (re.test(d.name) || re.test(d.description)));
  if (!matches.length) {
    ctx.out(`${term}: nothing appropriate.\n`);
    return 16;
  }
  for (const d of matches.sort((a, b) => a.name.localeCompare(b.name))) ctx.out(`${`${d.name} (1)`.padEnd(21)}- ${d.description.replace(/\.$/, "")}\n`);
  return 0;
}

// ------------------------------------------------------------- date/uname

function strftime(fmt: string, ts: number): string {
  const d = new Date(ts);
  const two = (n: number) => String(n).padStart(2, "0");
  const map: Record<string, () => string> = {
    Y: () => String(d.getUTCFullYear()),
    y: () => two(d.getUTCFullYear() % 100),
    m: () => two(d.getUTCMonth() + 1),
    d: () => two(d.getUTCDate()),
    e: () => String(d.getUTCDate()).padStart(2, " "),
    H: () => two(d.getUTCHours()),
    I: () => two(d.getUTCHours() % 12 || 12),
    M: () => two(d.getUTCMinutes()),
    S: () => two(d.getUTCSeconds()),
    p: () => (d.getUTCHours() < 12 ? "AM" : "PM"),
    A: () => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getUTCDay()],
    a: () => DAYS[d.getUTCDay()],
    B: () => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getUTCMonth()],
    b: () => MONTHS[d.getUTCMonth()],
    h: () => MONTHS[d.getUTCMonth()],
    j: () => String(Math.floor((ts - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1).padStart(3, "0"),
    s: () => String(Math.floor(ts / 1000)),
    u: () => String(d.getUTCDay() || 7),
    w: () => String(d.getUTCDay()),
    Z: () => "UTC",
    z: () => "+0000",
    F: () => `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`,
    T: () => `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`,
    R: () => `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`,
    D: () => `${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())}/${two(d.getUTCFullYear() % 100)}`,
    n: () => "\n",
    t: () => "\t",
    "%": () => "%",
  };
  return fmt.replace(/%([A-Za-z%])/g, (m, k: string) => (map[k] ? map[k]() : m));
}

function date(ctx: CommandContext): number {
  let ts = ctx.now;
  let fmt: string | undefined;
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a.startsWith("+")) fmt = a.slice(1);
    else if (a === "-d" || a === "--date") {
      const v = ctx.args[++i] ?? "";
      const rel = /^([+-]?\d+)\s*(day|days|hour|hours|minute|minutes|week|weeks)\s*(ago)?$/i.exec(v.trim());
      if (v === "yesterday") ts -= 86400000;
      else if (v === "tomorrow") ts += 86400000;
      else if (rel) {
        const n = Number(rel[1]) * (rel[3] ? -1 : 1);
        const unit = rel[2].toLowerCase().replace(/s$/, "");
        ts += n * ({ day: 86400000, hour: 3600000, minute: 60000, week: 604800000 } as Record<string, number>)[unit];
      } else {
        const parsed = Date.parse(v);
        if (Number.isNaN(parsed)) {
          ctx.err(`date: invalid date ‘${v}’\n`);
          return 1;
        }
        ts = parsed;
      }
    } else if (a === "-u" || a === "--utc") continue;
    else if (a === "-s" || a === "--set") {
      ctx.err("date: cannot set date: Operation not permitted\n");
      return 1;
    }
  }
  ctx.out((fmt !== undefined ? strftime(fmt, ts) : strftime("%a %b %e %H:%M:%S %Z %Y", ts)) + "\n");
  return 0;
}

function cal(ctx: CommandContext): number {
  const d = new Date(ctx.now);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const title = `${names[month]} ${year}`;
  let out = " ".repeat(Math.floor((20 - title.length) / 2)) + title + "\nSu Mo Tu We Th Fr Sa\n";
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let line = "   ".repeat(first);
  for (let day = 1; day <= days; day++) {
    const s = String(day).padStart(2);
    line += day === d.getUTCDate() && ctx.stdoutIsTTY ? `\x1b[7m${s}\x1b[0m` : s;
    if ((first + day) % 7 === 0) {
      out += line + "\n";
      line = "";
    } else line += " ";
  }
  if (line.trim()) out += line.trimEnd() + "\n";
  ctx.out(out + "\n");
  return 0;
}

function uname(ctx: CommandContext): number {
  const f = ctx.args.join("").replace(/-/g, "");
  const host = ctx.state.hostname;
  const parts: Record<string, string> = { s: "Linux", n: host, r: KERNEL, v: "#45-Ubuntu SMP PREEMPT_DYNAMIC Fri Aug 30 12:02:04 UTC 2024", m: "x86_64", p: "x86_64", i: "x86_64", o: "GNU/Linux" };
  if (ctx.args.some((a) => /^-[^snrvmpioa-]|^--(?!all|kernel-name|nodename|kernel-release|kernel-version|machine|operating-system)/.test(a))) {
    ctx.err(`uname: invalid option -- '${f.replace(/[snrvmpioa]/g, "")[0]}'\nTry 'uname --help' for more information.\n`);
    return 1;
  }
  if (!f || f === "s" || ctx.args.includes("--kernel-name")) {
    ctx.out("Linux\n");
    return 0;
  }
  const keys = f.includes("a") || ctx.args.includes("--all") ? ["s", "n", "r", "v", "m", "p", "i", "o"] : ["s", "n", "r", "v", "m", "p", "i", "o"].filter((k) => f.includes(k));
  ctx.out(keys.map((k) => parts[k]).join(" ") + "\n");
  return 0;
}

function hostnamectl(ctx: CommandContext): number {
  const [sub, value] = ctx.args;
  if (sub === "set-hostname" || sub === "hostname") {
    if (!value) {
      ctx.out(ctx.state.hostname + "\n");
      return 0;
    }
    if (ctx.who.uid !== 0) {
      ctx.err("Could not set static hostname: Access denied\n");
      return 1;
    }
    ctx.state.hostname = value;
    try {
      ctx.fs.writeFileAt("/etc/hostname", value + "\n", { uid: 0, gid: 0, mode: 0o644, now: ctx.now });
    } catch {
      /* ignore */
    }
    return 0;
  }
  ctx.out(` Static hostname: ${ctx.state.hostname}\n       Icon name: computer-vm\n         Chassis: vm 🖴\n      Machine ID: 4f3c1a2b9d8e4f6a8b7c6d5e4f3a2b1c\n         Boot ID: 9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b\n  Virtualization: oracle\nOperating System: Ubuntu 24.04.1 LTS\n          Kernel: Linux ${KERNEL}\n    Architecture: x86-64\n Hardware Vendor: innotek GmbH\n  Hardware Model: VirtualBox\nFirmware Version: VirtualBox\n   Firmware Date: Fri 2006-12-01\n    Firmware Age: 19y 11month 1w 4d\n`);
  return 0;
}

function envCmd(ctx: CommandContext): number {
  // env VAR=x cmd  → run cmd with extra environment
  const assigns: string[] = [];
  let i = 0;
  while (i < ctx.args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ctx.args[i])) assigns.push(ctx.args[i++]);
  if (i < ctx.args.length && ctx.name === "env") {
    const saved: [string, string | undefined][] = assigns.map((a) => [a.split("=")[0], ctx.state.session.vars[a.split("=")[0]]]);
    for (const a of assigns) {
      const k = a.split("=")[0];
      ctx.shell.setVar(k, a.slice(k.length + 1));
      ctx.shell.exportVar(k);
    }
    try {
      return ctx.shell.runArgv(ctx.args.slice(i), ctx.shell.ioFromContext(ctx));
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete ctx.state.session.vars[k];
        else ctx.state.session.vars[k] = v;
      }
    }
  }
  const env = ctx.shell.environment();
  for (const a of assigns) env[a.split("=")[0]] = a.slice(a.indexOf("=") + 1);
  if (ctx.name === "printenv" && ctx.args.length) {
    let status = 0;
    for (const k of ctx.args) {
      if (env[k] !== undefined) ctx.out(env[k] + "\n");
      else status = 1;
    }
    return status;
  }
  for (const k of Object.keys(env).sort()) ctx.out(`${k}=${env[k]}\n`);
  return 0;
}

// --------------------------------------------------------------- services

const BASE_SERVICES: Record<string, { description: string; command: string; args: string; user: string; docs: string }> = {
  cron: { description: "Regular background program processing daemon", command: "cron", args: "/usr/sbin/cron -f -P", user: "root", docs: "man:cron(8)" },
  rsyslog: { description: "System Logging Service", command: "rsyslogd", args: "/usr/sbin/rsyslogd -n -iNONE", user: "syslog", docs: "man:rsyslogd(8)" },
  "systemd-journald": { description: "Journal Service", command: "systemd-journal", args: "/usr/lib/systemd/systemd-journald", user: "root", docs: "man:systemd-journald.service(8)" },
  "systemd-networkd": { description: "Network Configuration", command: "systemd-network", args: "/usr/lib/systemd/systemd-networkd", user: "systemd-network", docs: "man:systemd-networkd.service(8)" },
  "systemd-resolved": { description: "Network Name Resolution", command: "systemd-resolve", args: "/usr/lib/systemd/systemd-resolved", user: "systemd-resolve", docs: "man:systemd-resolved.service(8)" },
  "systemd-logind": { description: "User Login Management", command: "systemd-logind", args: "/usr/lib/systemd/systemd-logind", user: "root", docs: "man:sd-login(3)" },
  dbus: { description: "D-Bus System Message Bus", command: "dbus-daemon", args: "@dbus-daemon --system --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only", user: "messagebus", docs: "man:dbus-daemon(1)" },
  ufw: { description: "Uncomplicated firewall", command: "", args: "", user: "root", docs: "man:ufw(8)" },
};

function unitInfo(ctx: CommandContext, unit: string) {
  const name = unit.replace(/\.service$/, "");
  const pkgName = serviceOwner(name);
  const pkg = pkgName ? PACKAGE_INDEX.get(pkgName) : undefined;
  const installed = pkg ? !!ctx.state.packages.installed[pkg.name] : false;
  const base = BASE_SERVICES[name];
  if (!base && !installed) return null;
  const state = ctx.state.services[name];
  return { name, description: base?.description ?? pkg!.service!.description, docs: base?.docs ?? `man:${name}(8)`, state, pkg: installed ? pkg : undefined, base };
}

function ago(ms: number): string {
  const s = Math.max(1, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min ago`;
}

function startUnit(ctx: CommandContext, name: string) {
  const s = ctx.state;
  const st = (s.services[name] ??= { name, enabled: false, active: false, since: ctx.now });
  if (st.active) return true;
  if (BASE_SERVICES[name]) {
    const tpl = BASE_SERVICES[name];
    if (tpl.command) {
      const existing = baseProcesses({ ...s, nextPid: s.nextPid }, ctx.now).find((p) => p.service === name);
      s.processes.push({ ...(existing ?? { pid: 0, ppid: 1, state: "S", nice: 0, tty: "?", cpu: 0, mem: 0.1, vsz: 10000, rss: 4000 }), pid: s.nextPid++, ppid: 1, user: tpl.user, command: tpl.command, args: tpl.args, startedAt: ctx.now, service: name } as never);
    }
  } else {
    // port conflicts (apache2 vs nginx)
    const pkg = PACKAGE_INDEX.get(serviceOwner(name) ?? "");
    const ports = pkg?.service?.ports.map((p) => p.port) ?? [];
    const conflict = Object.values(s.services).find((o) => o.active && o.name !== name && PACKAGE_INDEX.get(serviceOwner(o.name) ?? "")?.service?.ports.some((p) => ports.includes(p.port)));
    if (conflict) {
      st.active = false;
      st.since = ctx.now;
      ctx.shell.log("syslog", `${name}[${s.nextPid}]`, `bind() to 0.0.0.0:${ports[0]} failed (98: Address already in use)`);
      ctx.shell.log("syslog", "systemd[1]", `${name}.service: Failed with result 'exit-code'.`);
      return false;
    }
    startServiceProcesses(s, name, ctx.now);
  }
  st.active = true;
  st.since = ctx.now;
  ctx.shell.log("syslog", "systemd[1]", `Started ${name}.service - ${unitInfo(ctx, name)?.description ?? name}.`, name);
  return true;
}

function stopUnit(ctx: CommandContext, name: string) {
  const st = ctx.state.services[name];
  if (!st) return;
  if (st.active) {
    ctx.shell.log("syslog", "systemd[1]", `Stopping ${name}.service - ${unitInfo(ctx, name)?.description ?? name}...`, name);
    ctx.shell.log("syslog", "systemd[1]", `${name}.service: Deactivated successfully.`, name);
  }
  stopServiceProcesses(ctx.state, name);
  st.active = false;
  st.since = ctx.now;
}

function systemctl(ctx: CommandContext): number {
  const args = ctx.args.filter((a) => !a.startsWith("--no-pager") && a !== "--now" && a !== "-l" && a !== "--quiet" && a !== "-q");
  const now = ctx.args.includes("--now");
  const quiet = ctx.args.includes("--quiet") || ctx.args.includes("-q");
  const [sub, ...units] = args;
  if (!sub || sub === "list-units" || sub.startsWith("--type")) {
    const rows = Object.values(ctx.state.services)
      .filter((s) => unitInfo(ctx, s.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    ctx.out("  UNIT                         LOAD   ACTIVE SUB     DESCRIPTION\n");
    for (const s of rows) {
      const info = unitInfo(ctx, s.name)!;
      const sub2 = s.active ? (s.name === "ufw" ? "exited " : "running") : "dead   ";
      ctx.out(`  ${(s.name + ".service").padEnd(28)} loaded ${(s.active ? "active" : "inactive").padEnd(6)} ${sub2} ${info.description}\n`);
    }
    ctx.out(`\nLegend: LOAD   → Reflects whether the unit definition was properly loaded.\n        ACTIVE → The high-level unit activation state, i.e. generalization of SUB.\n        SUB    → The low-level unit activation state, values depend on unit type.\n\n${rows.length} loaded units listed.\n`);
    return 0;
  }
  if (sub === "list-unit-files") {
    ctx.out("UNIT FILE                    STATE   PRESET\n");
    for (const s of Object.values(ctx.state.services).sort((a, b) => a.name.localeCompare(b.name))) ctx.out(`${(s.name + ".service").padEnd(28)} ${(s.enabled ? "enabled" : "disabled").padEnd(7)} enabled\n`);
    return 0;
  }
  if (sub === "daemon-reload") {
    if (ctx.who.uid !== 0) {
      ctx.err("Failed to reload daemon: Interactive authentication required.\n");
      return 1;
    }
    return 0;
  }
  if (["reboot", "poweroff", "halt"].includes(sub)) return powerCmd({ ...ctx, name: sub });
  if (!units.length) {
    ctx.err(`Too few arguments.\n`);
    return 1;
  }
  let status = 0;
  for (const u of units) {
    const info = unitInfo(ctx, u);
    const name = u.replace(/\.service$/, "");
    if (!info) {
      if (sub === "status") ctx.err(`Unit ${name}.service could not be found.\n`);
      else if (sub === "is-active") ctx.out("inactive\n");
      else if (sub === "is-enabled") ctx.err(`Failed to get unit file state for ${name}.service: No such file or directory\n`);
      else ctx.err(`Failed to ${sub} ${name}.service: Unit ${name}.service not found.\n`);
      status = sub === "status" ? 4 : sub === "is-active" ? 3 : 1;
      continue;
    }
    const st = (ctx.state.services[name] ??= { name, enabled: false, active: false, since: ctx.now });
    const needRoot = ["start", "stop", "restart", "reload", "enable", "disable", "mask", "unmask", "try-restart", "reload-or-restart"].includes(sub);
    if (needRoot && ctx.who.uid !== 0) {
      ctx.err(`Failed to ${sub} ${name}.service: Interactive authentication required.\nSee system logs and 'systemctl status ${name}.service' for details.\n`);
      status = 1;
      continue;
    }
    switch (sub) {
      case "status": {
        const dot = st.active ? (ctx.stdoutIsTTY ? "\x1b[0;1;32m●\x1b[0m" : "●") : "○";
        const procs = ctx.state.processes.filter((p) => p.service === name);
        const since = new Date(st.since);
        const sinceStr = `${DAYS[since.getUTCDay()]} ${since.toISOString().slice(0, 10)} ${since.toISOString().slice(11, 19)} UTC`;
        const active = st.active ? (name === "ufw" ? "active (exited)" : "active (running)") : "inactive (dead)";
        const activeColored = st.active && ctx.stdoutIsTTY ? `\x1b[0;1;32m${active}\x1b[0m` : active;
        ctx.out(`${dot} ${name}.service - ${info.description}\n     Loaded: loaded (/usr/lib/systemd/system/${name}.service; ${st.enabled ? "enabled" : "disabled"}; preset: enabled)\n     Active: ${activeColored}${st.active || st.since ? ` since ${sinceStr}; ${ago(ctx.now - st.since)}` : ""}\n       Docs: ${info.docs}\n`);
        if (procs.length) {
          ctx.out(`   Main PID: ${procs[0].pid} (${procs[0].command})\n      Tasks: ${procs.length} (limit: 4614)\n     Memory: ${(procs.reduce((a, p) => a + p.rss, 0) / 1024).toFixed(1)}M\n        CPU: ${20 + procs.length * 7}ms\n     CGroup: /system.slice/${name}.service\n`);
          procs.forEach((p, i) => ctx.out(`             ${i === procs.length - 1 ? "└─" : "├─"}${p.pid} "${p.args}"\n`));
        }
        const logs = ctx.state.logs.filter((l) => l.unit === name || l.source.startsWith(name) || l.message.includes(`${name}.service`)).slice(-10);
        if (logs.length) {
          ctx.out("\n");
          for (const l of logs) ctx.out(`${syslogDate(l.ts)} ${ctx.state.hostname} ${l.source}: ${l.message}\n`);
        }
        if (!st.active) status = 3;
        break;
      }
      case "start":
        if (!startUnit(ctx, name)) {
          ctx.err(`Job for ${name}.service failed because the control process exited with error code.\nSee "systemctl status ${name}.service" and "journalctl -xeu ${name}.service" for details.\n`);
          status = 1;
        }
        break;
      case "stop":
        stopUnit(ctx, name);
        break;
      case "restart":
      case "try-restart":
      case "reload-or-restart":
        stopUnit(ctx, name);
        if (!startUnit(ctx, name)) {
          ctx.err(`Job for ${name}.service failed because the control process exited with error code.\nSee "systemctl status ${name}.service" and "journalctl -xeu ${name}.service" for details.\n`);
          status = 1;
        }
        break;
      case "reload":
        if (!st.active) {
          ctx.err(`${name}.service is not active, cannot reload.\n`);
          status = 1;
        } else ctx.shell.log("syslog", "systemd[1]", `Reloaded ${name}.service - ${info.description}.`, name);
        break;
      case "enable":
        if (!st.enabled) ctx.err(`Synchronizing state of ${name}.service with SysV service script with /usr/lib/systemd/systemd-sysv-install.\nExecuting: /usr/lib/systemd/systemd-sysv-install enable ${name}\nCreated symlink /etc/systemd/system/multi-user.target.wants/${name}.service → /usr/lib/systemd/system/${name}.service.\n`);
        st.enabled = true;
        if (now) startUnit(ctx, name);
        break;
      case "disable":
        if (st.enabled) ctx.err(`Synchronizing state of ${name}.service with SysV service script with /usr/lib/systemd/systemd-sysv-install.\nExecuting: /usr/lib/systemd/systemd-sysv-install disable ${name}\nRemoved "/etc/systemd/system/multi-user.target.wants/${name}.service".\n`);
        st.enabled = false;
        if (now) stopUnit(ctx, name);
        break;
      case "is-active":
        if (!quiet) ctx.out(st.active ? "active\n" : "inactive\n");
        if (!st.active) status = 3;
        break;
      case "is-enabled":
        if (!quiet) ctx.out(st.enabled ? "enabled\n" : "disabled\n");
        if (!st.enabled) status = 1;
        break;
      default:
        ctx.err(`Unknown command verb '${sub}'.\n`);
        return 1;
    }
  }
  return status;
}

function service(ctx: CommandContext): number {
  if (ctx.args[0] === "--status-all") {
    for (const s of Object.values(ctx.state.services).sort((a, b) => a.name.localeCompare(b.name))) ctx.out(` [ ${s.active ? "+" : "-"} ]  ${s.name}\n`);
    return 0;
  }
  const [unit, action] = ctx.args;
  if (!unit || !action) {
    ctx.err("Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]\n");
    return 1;
  }
  return systemctl({ ...ctx, args: [action, unit] });
}

function journalctl(ctx: CommandContext): number {
  let unit: string | undefined;
  let n: number | undefined;
  let reverse = false;
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === "-u" || a === "--unit") unit = ctx.args[++i]?.replace(/\.service$/, "");
    else if (a.startsWith("-u") && a.length > 2) unit = a.slice(2).replace(/\.service$/, "");
    else if (a === "-n" || a === "--lines") n = Number(ctx.args[++i]);
    else if (a.startsWith("-n") && a.length > 2) n = Number(a.slice(2));
    else if (a === "-r" || a === "--reverse") reverse = true;
    else if (a === "-xe" || a === "-e" || a === "-f" || a === "--follow") n = n ?? 10;
    else if (/^-[xeu]+$/.test(a) && a.includes("u")) unit = ctx.args[++i]?.replace(/\.service$/, "");
  }
  const allowed = ctx.who.uid === 0 || groupsOf(ctx.state, ctx.who.username).some((g) => g.name === "adm" || g.name === "systemd-journal");
  if (!allowed) {
    ctx.out("Hint: You are currently not seeing messages from other users and the system.\n      Users in groups 'adm', 'systemd-journal' can see all messages.\n      Pass -q to turn off this notice.\n-- No entries --\n");
    return 0;
  }
  let logs = ctx.state.logs.filter((l) => !unit || l.unit === unit || l.source.startsWith(`${unit}[`) || l.source.startsWith(unit === "ssh" ? "sshd" : unit) || l.message.includes(`${unit}.service`));
  if (n !== undefined) logs = logs.slice(-n);
  if (reverse) logs = [...logs].reverse();
  if (!logs.length) {
    ctx.out("-- No entries --\n");
    return 0;
  }
  for (const l of logs) ctx.out(`${syslogDate(l.ts)} ${ctx.state.hostname} ${l.source}: ${l.message}\n`);
  return 0;
}

// ------------------------------------------------------------------- ufw

const UFW_SERVICES: Record<string, string> = { ssh: "22/tcp", OpenSSH: "22/tcp", http: "80/tcp", https: "443/tcp", "Nginx HTTP": "80/tcp", "Nginx HTTPS": "443/tcp", "Nginx Full": "80,443/tcp", "Apache": "80/tcp", mysql: "3306/tcp", dns: "53" };

function ufw(ctx: CommandContext): number {
  if (ctx.who.uid !== 0) {
    ctx.err("ERROR: You need to be root to run this script\n");
    return 1;
  }
  const fw = ctx.state.firewall;
  const [sub, ...rest] = ctx.args;
  const describe = (r: (typeof fw.rules)[number], v6: boolean) => {
    const to = r.port === "Anywhere" ? `Anywhere${v6 ? " (v6)" : ""}` : `${r.port}${r.proto ? `/${r.proto}` : ""}${v6 ? " (v6)" : ""}`;
    const from = r.from === "Anywhere" ? `Anywhere${v6 ? " (v6)" : ""}` : r.from;
    return { to, action: r.action.toUpperCase(), from };
  };
  const listRules = (numbered: boolean) => {
    const rows: { to: string; action: string; from: string }[] = [];
    for (const r of fw.rules) rows.push(describe(r, false));
    for (const r of fw.rules) if (r.from === "Anywhere") rows.push(describe(r, true));
    if (!rows.length) return;
    ctx.out(`\n${numbered ? "     " : ""}To                         Action      From\n${numbered ? "     " : ""}--                         ------      ----\n`);
    rows.forEach((row, i) => ctx.out(`${numbered ? `[${String(i + 1).padStart(2)}] ` : ""}${row.to.padEnd(26)} ${(row.action + " IN").replace(/ IN$/, numbered ? " IN" : "").padEnd(11)} ${row.from}\n`));
    ctx.out("\n");
  };
  switch (sub) {
    case "status": {
      if (!fw.enabled) {
        ctx.out("Status: inactive\n");
        return 0;
      }
      ctx.out("Status: active\n");
      if (rest[0] === "verbose") ctx.out("Logging: on (low)\nDefault: deny (incoming), allow (outgoing), disabled (routed)\nNew profiles: skip\n");
      listRules(rest[0] === "numbered");
      return 0;
    }
    case "enable": {
      const ans = ctx.shell.readInput("Command may disrupt existing ssh connections. Proceed with operation (y|n)? ", false);
      if (!/^y/i.test(ans.trim())) {
        ctx.out("Aborted\n");
        return 0;
      }
      fw.enabled = true;
      ctx.state.services.ufw = { name: "ufw", enabled: true, active: true, since: ctx.now };
      ctx.shell.log("syslog", "kernel", "[UFW] firewall enabled");
      ctx.out("Firewall is active and enabled on system startup\n");
      return 0;
    }
    case "disable":
      fw.enabled = false;
      if (ctx.state.services.ufw) ctx.state.services.ufw.active = false;
      ctx.out("Firewall stopped and disabled on system startup\n");
      return 0;
    case "reset": {
      const ans = ctx.shell.readInput("Resetting all rules to installed defaults. Proceed with operation (y|n)? ", false);
      if (!/^y/i.test(ans.trim())) {
        ctx.out("Aborted\n");
        return 0;
      }
      fw.enabled = false;
      fw.rules = [];
      ctx.out("Backing up 'user.rules' to '/etc/ufw/user.rules.20261112_083000'\nBacking up 'user6.rules' to '/etc/ufw/user6.rules.20261112_083000'\n");
      return 0;
    }
    case "default":
      ctx.out(`Default ${rest[1] ?? "incoming"} policy changed to '${rest[0] ?? "deny"}'\n(be sure to update your rules accordingly)\n`);
      return 0;
    case "app":
      if (rest[0] === "list") {
        ctx.out("Available applications:\n");
        const apps = ["OpenSSH"];
        if (ctx.state.packages.installed.nginx) apps.push("Nginx Full", "Nginx HTTP", "Nginx HTTPS");
        if (ctx.state.packages.installed.apache2) apps.push("Apache", "Apache Full", "Apache Secure");
        for (const a of apps.sort()) ctx.out(`  ${a}\n`);
        return 0;
      }
      ctx.err("ERROR: Invalid syntax\n");
      return 1;
    case "allow":
    case "deny":
    case "reject":
    case "limit": {
      let from = "Anywhere";
      let spec: string | undefined;
      if (rest[0] === "from") {
        from = rest[1] ?? "Anywhere";
        const portIdx = rest.indexOf("port");
        spec = portIdx !== -1 ? rest[portIdx + 1] : "Anywhere";
        if (rest.includes("proto") && spec !== "Anywhere") spec += `/${rest[rest.indexOf("proto") + 1]}`;
      } else spec = rest.join(" ");
      if (!spec) {
        ctx.err("ERROR: Invalid syntax\n");
        return 1;
      }
      const resolved = UFW_SERVICES[spec] ?? spec;
      const m = /^(\d+(?:[:,]\d+)*|Anywhere)(?:\/(tcp|udp))?$/.exec(resolved);
      if (!m) {
        ctx.err(`ERROR: Could not find a profile matching '${spec}'\n`);
        return 1;
      }
      const rule = { action: sub as "allow" | "deny" | "reject" | "limit", port: m[1], proto: m[2] as "tcp" | "udp" | undefined, from };
      const exists = fw.rules.some((r) => r.action === rule.action && r.port === rule.port && r.proto === rule.proto && r.from === rule.from);
      if (exists) {
        ctx.out(from === "Anywhere" ? "Skipping adding existing rule\nSkipping adding existing rule (v6)\n" : "Skipping adding existing rule\n");
        return 0;
      }
      fw.rules = fw.rules.filter((r) => !(r.port === rule.port && r.proto === rule.proto && r.from === rule.from));
      fw.rules.push(rule);
      ctx.out(from === "Anywhere" ? "Rule added\nRule added (v6)\n" : "Rule added\n");
      return 0;
    }
    case "delete": {
      if (/^\d+$/.test(rest[0] ?? "")) {
        const idx = Number(rest[0]) - 1;
        const v4 = fw.rules;
        const v6 = fw.rules.filter((r) => r.from === "Anywhere");
        const target = idx < v4.length ? v4[idx] : v6[idx - v4.length];
        if (!target) {
          ctx.err("ERROR: Could not find rule '" + rest[0] + "'\n");
          return 1;
        }
        const d = describe(target, false);
        const ans = ctx.shell.readInput(`Deleting:\n allow ${d.to}\nProceed with operation (y|n)? `, false);
        if (!/^y/i.test(ans.trim())) {
          ctx.out("Aborted\n");
          return 0;
        }
        fw.rules = fw.rules.filter((r) => r !== target);
        ctx.out("Rule deleted\n");
        return 0;
      }
      const [action, ...specParts] = rest;
      const resolved = UFW_SERVICES[specParts.join(" ")] ?? specParts.join(" ");
      const m = /^(\d+(?:[:,]\d+)*)(?:\/(tcp|udp))?$/.exec(resolved);
      const before = fw.rules.length;
      if (m) fw.rules = fw.rules.filter((r) => !(r.action === action && r.port === m[1] && (r.proto ?? undefined) === (m[2] ?? undefined)));
      if (fw.rules.length === before) {
        ctx.out("Could not delete non-existent rule\nCould not delete non-existent rule (v6)\n");
        return 0;
      }
      ctx.out("Rule deleted\nRule deleted (v6)\n");
      return 0;
    }
    case "reload":
      ctx.out(fw.enabled ? "Firewall reloaded\n" : "Firewall not enabled (skipping reload)\n");
      return 0;
    default:
      ctx.err("ERROR: Invalid syntax\n\nUsage: ufw COMMAND\n\nCommands:\n enable                          enables the firewall\n disable                         disables the firewall\n default ARG                     set default policy\n allow ARGS                      add allow rule\n deny ARGS                       add deny rule\n reject ARGS                     add reject rule\n limit ARGS                      add limit rule\n delete RULE|NUM                 delete RULE\n reset                           reset firewall\n status                          show firewall status\n status numbered                 show firewall status as numbered list of RULES\n status verbose                  show verbose firewall status\n app list                        list application profiles\n");
      return 1;
  }
}

// ---------------------------------------------------------------- editors

function editor(ctx: CommandContext): number {
  const file = ctx.args.filter((a) => !a.startsWith("-") && !a.startsWith("+")).pop();
  if (!file) {
    ctx.err(`${ctx.name}: please give a file name, for example: ${ctx.name} notes.txt\n`);
    return 1;
  }
  const abs = normalizePath(file, ctx.cwd);
  let readOnly = false;
  try {
    const node = ctx.fs.lookup(abs, "/", ctx.who);
    if (node.type === "dir") {
      ctx.err(`${ctx.name}: ${file}: Is a directory\n`);
      return 1;
    }
    if (!canAccess(node, ctx.who, R)) {
      ctx.err(`${ctx.name}: ${file}: Permission denied\n`);
      return 1;
    }
    readOnly = !canAccess(node, ctx.who, W);
  } catch (e) {
    if (!(e instanceof FsError) || e.code !== "ENOENT") {
      ctx.err(`${ctx.name}: ${file}: ${errMsg(e)}\n`);
      return 1;
    }
    const parent = ctx.fs.tryLookup(dirname(abs), "/", ctx.who);
    if (!parent || parent.type !== "dir") {
      ctx.err(`${ctx.name}: Directory '${dirname(abs)}' does not exist\n`);
      return 1;
    }
    readOnly = !canAccess(parent, ctx.who, W | X);
  }
  const session = ctx.state.session;
  session.editGrants = (session.editGrants ?? []).filter((g) => g.expires > ctx.now && !(g.path === abs && g.user === ctx.who.username));
  session.editGrants.push({ path: abs, user: ctx.who.username, expires: ctx.now + 4 * 3600 * 1000, readOnly });
  ctx.shell.actions.push({ type: "edit", path: abs, editor: ctx.name, readOnly, user: ctx.who.username });
  return 0;
}

// --------------------------------------------------------- archives (tar)

const TAR_MAGIC = "SIMTAR1\n";
const GZ_MAGIC = "\u001f\u008bSIMGZ\n";

interface TarEntry {
  path: string;
  type: "file" | "dir" | "symlink";
  mode: number;
  uid: number;
  gid: number;
  mtime: number;
  content?: string;
  target?: string;
}

function tar(ctx: CommandContext): number {
  const args = [...ctx.args];
  if (args[0] && !args[0].startsWith("-") && /^[cxtvzjfCpr]+$/.test(args[0])) args[0] = "-" + args[0];
  let mode: "c" | "x" | "t" | null = null;
  let file: string | undefined;
  let verbose = false;
  let gzip = false;
  let dir: string | undefined;
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-C" || a === "--directory") {
      dir = args[++i];
      continue;
    }
    if (a.startsWith("--file=")) {
      file = a.slice(7);
      continue;
    }
    if (a === "--create") mode = "c";
    else if (a === "--extract") mode = "x";
    else if (a === "--list") mode = "t";
    else if (a === "--gzip") gzip = true;
    else if (a === "--verbose") verbose = true;
    else if (a.startsWith("-") && !a.startsWith("--")) {
      for (let j = 1; j < a.length; j++) {
        const f = a[j];
        if (f === "c" || f === "x" || f === "t") mode = f;
        else if (f === "v") verbose = true;
        else if (f === "z" || f === "j" || f === "J") gzip = true;
        else if (f === "f") {
          file = a.slice(j + 1) || args[++i];
          break;
        } else if (f === "C") {
          dir = a.slice(j + 1) || args[++i];
          break;
        } else if (f !== "p") {
          ctx.err(`tar: invalid option -- '${f}'\nTry 'tar --help' or 'tar --usage' for more information.\n`);
          return 2;
        }
      }
    } else operands.push(a);
  }
  if (!mode) {
    ctx.err("tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options\nTry 'tar --help' or 'tar --usage' for more information.\n");
    return 2;
  }
  if (!file) {
    ctx.err("tar: Refusing to read archive contents from terminal (missing -f option?)\ntar: Error is not recoverable: exiting now\n");
    return 2;
  }
  const baseDir = dir ? normalizePath(dir, ctx.cwd) : ctx.cwd;
  if (mode === "c") {
    if (!operands.length) {
      ctx.err("tar: Cowardly refusing to create an empty archive\nTry 'tar --help' or 'tar --usage' for more information.\n");
      return 2;
    }
    const entries: TarEntry[] = [];
    let status = 0;
    for (const op of operands) {
      let node: FsNode;
      try {
        node = ctx.fs.lookup(op, baseDir, ctx.who, false);
      } catch (e) {
        ctx.err(`tar: ${op}: Cannot stat: ${errMsg(e)}\n`);
        status = 2;
        continue;
      }
      const rootPath = ctx.fs.pathOf(node);
      const prefix = op.replace(/^\/+/, "").replace(/\/+$/, "");
      if (op.startsWith("/")) ctx.err("tar: Removing leading `/' from member names\n");
      ctx.fs.walk(node, (n, p) => {
        const rel = prefix + p.slice(rootPath.length);
        if (n.type === "dir" && !canAccess(n, ctx.who, R | X)) {
          ctx.err(`tar: ${rel}: Cannot open: Permission denied\n`);
          status = 2;
          return false;
        }
        if (n.type === "file" && !canAccess(n, ctx.who, R)) {
          ctx.err(`tar: ${rel}: Cannot open: Permission denied\n`);
          status = 2;
          return;
        }
        if (n.type === "chardev" || n.type === "blockdev") return;
        entries.push({ path: n.type === "dir" ? rel + "/" : rel, type: n.type as TarEntry["type"], mode: n.mode, uid: n.uid, gid: n.gid, mtime: n.mtime, content: n.type === "file" ? ctx.shell.readFileContent(n) : undefined, target: n.target });
        if (verbose) ctx.out((n.type === "dir" ? rel + "/" : rel) + "\n");
      });
    }
    let data = TAR_MAGIC + JSON.stringify(entries);
    if (gzip) data = GZ_MAGIC + data;
    try {
      ctx.shell.openForWrite(file, false).write(data);
    } catch (e) {
      ctx.err(`tar: ${file}: Cannot open: ${errMsg(e).replace(/^.*: /, "")}\ntar: Error is not recoverable: exiting now\n`);
      return 2;
    }
    if (status) ctx.err("tar: Exiting with failure status due to previous errors\n");
    return status;
  }
  let raw: string;
  try {
    const node = resolve(ctx, file);
    if (!ctx.shell.canRead(node)) throw new FsError("EACCES");
    raw = ctx.shell.readFileContent(node);
  } catch (e) {
    ctx.err(`tar: ${file}: Cannot open: ${errMsg(e)}\ntar: Error is not recoverable: exiting now\n`);
    return 2;
  }
  if (raw.startsWith(GZ_MAGIC)) raw = raw.slice(GZ_MAGIC.length);
  else if (gzip) {
    ctx.err("\ngzip: stdin: not in gzip format\ntar: Child returned status 1\ntar: Error is not recoverable: exiting now\n");
    return 2;
  }
  if (!raw.startsWith(TAR_MAGIC)) {
    ctx.err("tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n");
    return 2;
  }
  const entries = JSON.parse(raw.slice(TAR_MAGIC.length)) as TarEntry[];
  if (mode === "t") {
    for (const e of entries) {
      if (verbose) {
        const m = (e.type === "dir" ? "d" : e.type === "symlink" ? "l" : "-") + ["r", "w", "x", "r", "w", "x", "r", "w", "x"].map((c, i) => (e.mode & (1 << (8 - i)) ? c : "-")).join("");
        const owner = `${findUser(ctx.state, e.uid)?.username ?? e.uid}/${ctx.state.groups.find((g) => g.gid === e.gid)?.name ?? e.gid}`;
        ctx.out(`${m} ${owner} ${String(e.content?.length ?? 0).padStart(8)} ${new Date(e.mtime).toISOString().slice(0, 16).replace("T", " ")} ${e.path}\n`);
      } else ctx.out(e.path + "\n");
    }
    return 0;
  }
  let status = 0;
  for (const e of entries) {
    const target = `${baseDir === "/" ? "" : baseDir}/${e.path.replace(/\/$/, "")}`;
    if (operands.length && !operands.some((o) => e.path.startsWith(o))) continue;
    try {
      if (e.type === "dir") {
        const existing = ctx.fs.tryLookup(target, "/");
        if (!existing) {
          const { parent, name } = ctx.fs.lookupParent(target, "/", ctx.who);
          ctx.fs.assertWritableDir(parent, ctx.who);
          ctx.fs.create(parent, name, "dir", { uid: ctx.who.uid === 0 ? e.uid : ctx.who.uid, gid: ctx.who.uid === 0 ? e.gid : ctx.who.gid, mode: e.mode, now: e.mtime });
        }
      } else {
        const { parent, name } = ctx.fs.lookupParent(target, "/", ctx.who);
        ctx.fs.assertWritableDir(parent, ctx.who);
        const existing = ctx.fs.child(parent, name);
        if (existing) ctx.fs.remove(existing, ctx.now);
        ctx.fs.create(parent, name, e.type, { uid: ctx.who.uid === 0 ? e.uid : ctx.who.uid, gid: ctx.who.uid === 0 ? e.gid : ctx.who.gid, mode: e.mode, content: e.content ?? "", target: e.target, now: e.mtime });
      }
      if (verbose) ctx.out(e.path + "\n");
    } catch (err) {
      ctx.err(`tar: ${e.path}: Cannot open: ${errMsg(err)}\n`);
      status = 2;
    }
  }
  return status;
}

function gzipCmd(ctx: CommandContext): number {
  const decompress = ctx.name === "gunzip" || ctx.args.includes("-d");
  const keep = ctx.args.includes("-k");
  const files = ctx.args.filter((a) => !a.startsWith("-"));
  if (ctx.name === "zcat") {
    for (const { content } of readInputs(ctx, files, (f, e) => ctx.err(`gzip: ${f}: ${errMsg(e)}\n`))) ctx.out(content.startsWith(GZ_MAGIC) ? content.slice(GZ_MAGIC.length) : content);
    return 0;
  }
  let status = 0;
  for (const f of files) {
    try {
      const node = resolve(ctx, f);
      if (node.type === "dir") {
        ctx.err(`gzip: ${f} is a directory -- ignored\n`);
        status = 2;
        continue;
      }
      if (!ctx.shell.canRead(node)) throw new FsError("EACCES");
      const parent = ctx.fs.get(node.parentId!)!;
      ctx.fs.assertWritableDir(parent, ctx.who);
      if (decompress) {
        if (!f.endsWith(".gz")) {
          ctx.err(`gzip: ${f}: unknown suffix -- ignored\n`);
          status = 2;
          continue;
        }
        if (!node.content.startsWith(GZ_MAGIC)) {
          ctx.err(`gzip: ${f}: not in gzip format\n`);
          status = 1;
          continue;
        }
        const name = basename(f).slice(0, -3);
        if (ctx.fs.child(parent, name)) {
          ctx.err(`gzip: ${name} already exists; not overwritten\n`);
          status = 2;
          continue;
        }
        ctx.fs.create(parent, name, "file", { uid: node.uid, gid: node.gid, mode: node.mode, content: node.content.slice(GZ_MAGIC.length), now: node.mtime });
      } else {
        if (f.endsWith(".gz")) {
          ctx.err(`gzip: ${f} already has .gz suffix -- unchanged\n`);
          status = 2;
          continue;
        }
        ctx.fs.create(parent, basename(f) + ".gz", "file", { uid: node.uid, gid: node.gid, mode: node.mode, content: GZ_MAGIC + node.content, now: node.mtime });
      }
      if (!keep) ctx.fs.remove(node, ctx.now);
    } catch (e) {
      ctx.err(`gzip: ${f}: ${errMsg(e)}\n`);
      status = 1;
    }
  }
  return status;
}

// -------------------------------------------------------------------- expr

function exprCmd(ctx: CommandContext): number {
  const a = ctx.args;
  const isInt = (s: string) => /^-?\d+$/.test(s);
  try {
    let result: string;
    if (a[0] === "length") result = String((a[1] ?? "").length);
    else if (a[0] === "substr") result = (a[1] ?? "").substr(Number(a[2]) - 1, Number(a[3]));
    else if (a[0] === "index") result = String([...(a[1] ?? "")].findIndex((c) => (a[2] ?? "").includes(c)) + 1);
    else if (a.length === 1) result = a[0];
    else if (a.length === 3) {
      const [l, op, r] = a;
      const num = ["+", "-", "*", "/", "%"].includes(op);
      if (num && (!isInt(l) || !isInt(r))) {
        ctx.err("expr: non-integer argument\n");
        return 2;
      }
      const L = Number(l);
      const Rn = Number(r);
      switch (op) {
        case "+":
          result = String(L + Rn);
          break;
        case "-":
          result = String(L - Rn);
          break;
        case "*":
          result = String(L * Rn);
          break;
        case "/":
          if (Rn === 0) {
            ctx.err("expr: division by zero\n");
            return 2;
          }
          result = String(Math.trunc(L / Rn));
          break;
        case "%":
          result = String(L % Rn);
          break;
        case "=":
        case "==":
          result = l === r ? "1" : "0";
          break;
        case "!=":
          result = l !== r ? "1" : "0";
          break;
        case "<":
        case ">":
        case "<=":
        case ">=": {
          const cmp = isInt(l) && isInt(r) ? L - Rn : l < r ? -1 : l > r ? 1 : 0;
          result = (op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : cmp >= 0) ? "1" : "0";
          break;
        }
        case ":": {
          const m = new RegExp("^" + r).exec(l);
          result = m ? (m[1] ?? String(m[0].length)) : "0";
          break;
        }
        default:
          ctx.err(`expr: syntax error: unexpected argument ‘${op}’\n`);
          return 2;
      }
    } else {
      ctx.err(a.length ? "expr: syntax error: missing argument after ‘" + a[a.length - 1] + "’\n" : "expr: missing operand\nTry 'expr --help' for more information.\n");
      return 2;
    }
    ctx.out(result + "\n");
    return result === "0" || result === "" ? 1 : 0;
  } catch {
    ctx.err("expr: syntax error\n");
    return 2;
  }
}

// --------------------------------------------------------------- fun/misc

function neofetch(ctx: CommandContext): number {
  const s = ctx.state;
  const user = ctx.who.username;
  const pkgs = Object.keys(s.packages.installed).length + 512;
  const c = (t: string) => (ctx.stdoutIsTTY ? `\x1b[1;31m${t}\x1b[0m` : t);
  const logo = ["      .-/+oossssoo+/-.     ", "  `:+ssssssssssssssssss+:`  ", " -+ssssssssssssssssssyyssss+- ", ".ossssssssssssssssss    ssso.", "/ssssssssss  ssssss  ssssssss/", "+sssssssss    ssss    ssssssss+", "ossssssss   linux   playground o", "+sssssssss    ssss    ssssssss+", "/ssssssssss  ssssss  ssssssss/", ".ossssssssssssssssss    ssso.", " -+ssssssssssssssssssyyssss+- ", "  `:+ssssssssssssssssss+:`  ", "      .-/+oossssoo+/-.     "];
  const mem = Math.round(s.processes.reduce((a, p) => a + p.rss, 0) / 1024 + 600);
  const info = [`${c(user)}@${c(s.hostname)}`, "-".repeat(user.length + s.hostname.length + 1), `${c("OS")}: Ubuntu 24.04.1 LTS x86_64`, `${c("Host")}: Linux Playground VM`, `${c("Kernel")}: ${KERNEL}`, `${c("Uptime")}: ${ctx.shell.uptimeText()}`, `${c("Packages")}: ${pkgs} (dpkg)`, `${c("Shell")}: bash 5.2.21`, `${c("Terminal")}: /dev/pts/0`, `${c("CPU")}: Virtual CPU (2) @ 2.400GHz`, `${c("Memory")}: ${mem}MiB / 3919MiB`];
  for (let i = 0; i < Math.max(logo.length, info.length); i++) ctx.out(`${c((logo[i] ?? "").padEnd(32))} ${info[i] ?? ""}\n`);
  return 0;
}

function cowsay(ctx: CommandContext): number {
  const text = ctx.args.join(" ") || ctx.readAllStdin().trim() || "Moo!";
  const width = Math.min(40, text.length);
  const wrapped: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = wrapped[wrapped.length - 1];
    if (last !== undefined && (last + " " + word).length <= width) wrapped[wrapped.length - 1] = last + " " + word;
    else wrapped.push(word);
  }
  const w = Math.max(...wrapped.map((l) => l.length));
  let out = ` ${"_".repeat(w + 2)}\n`;
  if (wrapped.length === 1) out += `< ${wrapped[0]} >\n`;
  else wrapped.forEach((l, i) => (out += `${i === 0 ? "/" : i === wrapped.length - 1 ? "\\" : "|"} ${l.padEnd(w)} ${i === 0 ? "\\" : i === wrapped.length - 1 ? "/" : "|"}\n`));
  out += ` ${"-".repeat(w + 2)}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||\n`;
  ctx.out(out);
  return 0;
}

const FONT: Record<string, string[]> = {
  A: [" ## ", "#  #", "####", "#  #", "#  #"], B: ["### ", "#  #", "### ", "#  #", "### "], C: [" ###", "#   ", "#   ", "#   ", " ###"], D: ["### ", "#  #", "#  #", "#  #", "### "],
  E: ["####", "#   ", "### ", "#   ", "####"], F: ["####", "#   ", "### ", "#   ", "#   "], G: [" ###", "#   ", "# ##", "#  #", " ###"], H: ["#  #", "#  #", "####", "#  #", "#  #"],
  I: ["###", " # ", " # ", " # ", "###"], J: ["  ##", "   #", "   #", "#  #", " ## "], K: ["#  #", "# # ", "##  ", "# # ", "#  #"], L: ["#   ", "#   ", "#   ", "#   ", "####"],
  M: ["#   #", "## ##", "# # #", "#   #", "#   #"], N: ["#   #", "##  #", "# # #", "#  ##", "#   #"], O: [" ## ", "#  #", "#  #", "#  #", " ## "], P: ["### ", "#  #", "### ", "#   ", "#   "],
  Q: [" ## ", "#  #", "#  #", "# ##", " ###"], R: ["### ", "#  #", "### ", "# # ", "#  #"], S: [" ###", "#   ", " ## ", "   #", "### "], T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#  #", "#  #", "#  #", "#  #", " ## "], V: ["#   #", "#   #", "#   #", " # # ", "  #  "], W: ["#   #", "#   #", "# # #", "## ##", "#   #"], X: ["#   #", " # # ", "  #  ", " # # ", "#   #"],
  Y: ["#   #", " # # ", "  #  ", "  #  ", "  #  "], Z: ["####", "   #", "  # ", " #  ", "####"], " ": ["  ", "  ", "  ", "  ", "  "], "!": ["#", "#", "#", " ", "#"],
  "0": [" ## ", "#  #", "#  #", "#  #", " ## "], "1": [" # ", "## ", " # ", " # ", "###"], "2": ["### ", "   #", " ## ", "#   ", "####"], "3": ["### ", "   #", " ## ", "   #", "### "],
  "4": ["#  #", "#  #", "####", "   #", "   #"], "5": ["####", "#   ", "### ", "   #", "### "], "6": [" ## ", "#   ", "### ", "#  #", " ## "], "7": ["####", "   #", "  # ", " #  ", " #  "],
  "8": [" ## ", "#  #", " ## ", "#  #", " ## "], "9": [" ## ", "#  #", " ###", "   #", " ## "], "-": ["    ", "    ", "####", "    ", "    "], ".": [" ", " ", " ", " ", "#"],
};

function figlet(ctx: CommandContext): number {
  const text = (ctx.args.join(" ") || ctx.readAllStdin().trim()).toUpperCase();
  const rows = ["", "", "", "", ""];
  for (const ch of text) {
    const g = FONT[ch] ?? FONT[" "];
    for (let r = 0; r < 5; r++) rows[r] += g[r] + " ";
  }
  ctx.out(rows.map((r) => r.trimEnd()).join("\n") + "\n\n");
  return 0;
}

function git(ctx: CommandContext): number {
  const [sub, ...rest] = ctx.args;
  if (sub === "--version" || sub === "version") {
    ctx.out("git version 2.43.0\n");
    return 0;
  }
  const findRepo = (): FsNode | null => {
    let p = ctx.cwd;
    for (;;) {
      const n = ctx.fs.tryLookup(`${p === "/" ? "" : p}/.git`, "/");
      if (n?.type === "dir") return n;
      if (p === "/") return null;
      p = dirname(p);
    }
  };
  switch (sub) {
    case "init": {
      const target = normalizePath(rest[0] ?? ".", ctx.cwd);
      try {
        const dir = ctx.fs.tryLookup(target, "/", ctx.who) ?? ctx.fs.mkdirp(target, { uid: ctx.who.uid, gid: ctx.who.gid }, 0o775, ctx.now);
        if (!canAccess(dir, ctx.who, W | X)) throw new FsError("EACCES");
        const existed = !!ctx.fs.child(dir, ".git");
        const own = { uid: ctx.who.uid, gid: ctx.who.gid };
        const base = `${target === "/" ? "" : target}/.git`;
        ctx.fs.mkdirp(base, own, 0o775, ctx.now);
        for (const d of ["objects/info", "objects/pack", "refs/heads", "refs/tags", "hooks", "info", "branches"]) ctx.fs.mkdirp(`${base}/${d}`, own, 0o775, ctx.now);
        ctx.fs.writeFileAt(`${base}/HEAD`, "ref: refs/heads/master\n", { ...own, mode: 0o664, now: ctx.now });
        ctx.fs.writeFileAt(`${base}/config`, "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n", { ...own, mode: 0o664, now: ctx.now });
        ctx.fs.writeFileAt(`${base}/description`, "Unnamed repository; edit this file 'description' to name the repository.\n", { ...own, mode: 0o664, now: ctx.now });
        if (!existed) ctx.err("hint: Using 'master' as the name for the initial branch. This default branch name\nhint: is subject to change. To configure the initial branch name to use in all\nhint: of your new repositories, which will suppress this warning, call:\nhint:\nhint: \tgit config --global init.defaultBranch <name>\n");
        ctx.out(`${existed ? "Reinitialized existing" : "Initialized empty"} Git repository in ${base}/\n`);
        return 0;
      } catch (e) {
        ctx.err(`fatal: cannot mkdir ${target}: ${errMsg(e)}\n`);
        return 128;
      }
    }
    case "status": {
      const repo = findRepo();
      if (!repo) {
        ctx.err("fatal: not a git repository (or any of the parent directories): .git\n");
        return 128;
      }
      const root = ctx.fs.get(repo.parentId!)!;
      const untracked = ctx.fs.list(root).filter((n) => n.name !== ".git").map((n) => n.name + (n.type === "dir" ? "/" : "")).sort();
      ctx.out(`On branch master\n\nNo commits yet\n\n`);
      if (untracked.length) ctx.out(`Untracked files:\n  (use "git add <file>..." to include in what will be committed)\n${untracked.map((u) => `\t${ctx.stdoutIsTTY ? `\x1b[31m${u}\x1b[0m` : u}`).join("\n")}\n\nnothing added to commit but untracked files present (use "git add" to track)\n`);
      else ctx.out(`nothing to commit (create/copy files and use "git add" to track)\n`);
      return 0;
    }
    case "config": {
      const global = rest.includes("--global");
      const kv = rest.filter((r) => !r.startsWith("--"));
      const me = findUser(ctx.state, ctx.who.uid)!;
      const path = global ? `${me.home}/.gitconfig` : null;
      if (!path) {
        ctx.err("fatal: not in a git directory\n");
        return 128;
      }
      const node = ctx.fs.tryLookup(path, "/");
      const content = node?.content ?? "";
      if (kv.length === 1 || rest.includes("--list")) {
        const key = kv[0];
        const lines_ = lines(content);
        let section = "";
        for (const l of lines_) {
          const sm = /^\[(\w+)\]$/.exec(l.trim());
          if (sm) {
            section = sm[1];
            continue;
          }
          const m = /^\s*(\w+)\s*=\s*(.*)$/.exec(l);
          if (m && (!key || `${section}.${m[1]}` === key)) ctx.out(key ? m[2] + "\n" : `${section}.${m[1]}=${m[2]}\n`);
        }
        return 0;
      }
      const [key, value] = kv;
      const [section, name] = key.split(".");
      const sections: Record<string, Record<string, string>> = {};
      let cur = "";
      for (const l of lines(content)) {
        const sm = /^\[(\w+)\]$/.exec(l.trim());
        if (sm) {
          cur = sm[1];
          sections[cur] ??= {};
          continue;
        }
        const m = /^\s*(\w+)\s*=\s*(.*)$/.exec(l);
        if (m && cur) sections[cur][m[1]] = m[2];
      }
      (sections[section] ??= {})[name] = value;
      const text = Object.entries(sections).map(([s, kvs]) => `[${s}]\n${Object.entries(kvs).map(([k, v]) => `\t${k} = ${v}`).join("\n")}\n`).join("");
      ctx.fs.writeFileAt(path, text, { uid: me.uid, gid: me.gid, mode: 0o664, now: ctx.now });
      return 0;
    }
    default:
      if (!sub) {
        ctx.out("usage: git [-v | --version] [-h | --help] [-C <path>] [-c <name>=<value>]\n           <command> [<args>]\n");
        return 1;
      }
      ctx.err(`git: '${sub}' is not available in Linux Playground (supported: init, status, config, --version).\n`);
      return 1;
  }
}

function powerCmd(ctx: CommandContext): number {
  if (ctx.who.uid !== 0) {
    ctx.err(`Call to ${ctx.name === "reboot" ? "Reboot" : "PowerOff"} failed: Interactive authentication required.\n`);
    return 1;
  }
  ctx.out(`\x1b[33mLinux Playground: the virtual machine cannot be ${ctx.name === "reboot" ? "rebooted" : "powered off"}. Your environment keeps running.\nUse "Reset environment" in the terminal toolbar to start over.\x1b[0m\n`);
  return 0;
}

function stub(name: string, opts: Partial<CommandDef> & { run: CommandDef["run"] }): CommandDef {
  return { name, category: "system", description: `${name} (simulated)`, syntax: name, ...opts };
}

export const systemCommands: CommandDef[] = [
  { name: "clear", category: "basics", description: "Clear the terminal screen.", syntax: "clear", examples: [{ command: "clear", description: "Clear the screen (or press Ctrl+L)" }], run: (ctx) => (ctx.shell.actions.push({ type: "clear" }), 0) },
  { name: "reset", category: "basics", description: "Reinitialize the terminal.", syntax: "reset", run: (ctx) => (ctx.shell.actions.push({ type: "clear" }), 0) },
  {
    name: "man",
    category: "basics",
    description: "An interface to the system reference manuals.",
    syntax: "man COMMAND",
    examples: [{ command: "man ls", description: "Read the manual for ls" }],
    run: man,
  },
  { name: "which", category: "basics", description: "Locate a command in PATH.", syntax: "which [-a] COMMAND...", examples: [{ command: "which ls", description: "Where is the ls program?" }], run: which },
  { name: "whereis", category: "basics", description: "Locate the binary and manual page for a command.", syntax: "whereis COMMAND", run: whereis },
  { name: "whatis", category: "basics", description: "Display one-line manual page descriptions.", syntax: "whatis COMMAND", run: whatis },
  { name: "apropos", category: "basics", description: "Search the manual page names and descriptions.", syntax: "apropos KEYWORD", examples: [{ command: "apropos user", description: "Commands related to users" }], run: apropos },
  { name: "env", category: "scripting", description: "Print the environment or run a command in a modified environment.", syntax: "env [NAME=VALUE]... [COMMAND]", run: envCmd },
  { name: "printenv", category: "scripting", description: "Print all or part of the environment.", syntax: "printenv [VARIABLE]", examples: [{ command: "printenv HOME", description: "Print one variable" }], run: envCmd },
  { name: "date", category: "system", description: "Print the system date and time.", syntax: "date [+FORMAT]", examples: [{ command: "date", description: "Current date and time" }, { command: 'date +"%Y-%m-%d"', description: "Custom format" }], run: date },
  { name: "cal", category: "system", description: "Display a calendar.", syntax: "cal", run: cal },
  { name: "uname", category: "system", description: "Print system information.", syntax: "uname [-a] [-r] [-m]", examples: [{ command: "uname -a", description: "Kernel and architecture" }], run: uname },
  { name: "hostnamectl", category: "system", description: "Query or change the system hostname.", syntax: "hostnamectl [set-hostname NAME]", run: hostnamectl },
  {
    name: "lsb_release",
    category: "system",
    description: "Print distribution-specific information.",
    syntax: "lsb_release -a",
    run: (ctx) => {
      ctx.err("No LSB modules are available.\n");
      ctx.out("Distributor ID:\tUbuntu\nDescription:\tUbuntu 24.04.1 LTS\nRelease:\t24.04\nCodename:\tnoble\n");
      return 0;
    },
  },
  {
    name: "systemctl",
    category: "system",
    description: "Control the systemd system and service manager.",
    syntax: "systemctl [status|start|stop|restart|enable|disable|is-active|list-units] [UNIT]",
    options: [
      { flag: "status UNIT", description: "show whether a service is running" },
      { flag: "start / stop / restart UNIT", description: "control a service (root)" },
      { flag: "enable / disable UNIT", description: "start at boot or not (root)" },
      { flag: "list-units --type=service", description: "list services" },
    ],
    examples: [
      { command: "systemctl status ssh", description: "Is the SSH server running?" },
      { command: "sudo systemctl restart nginx", description: "Restart nginx" },
    ],
    permissions: "Changing service state requires root.",
    run: systemctl,
  },
  { name: "service", binDir: "/usr/sbin", category: "system", description: "Run a System V init script (wrapper around systemctl).", syntax: "service NAME start|stop|restart|status", run: service },
  {
    name: "journalctl",
    category: "security",
    description: "Query the systemd journal (system logs).",
    syntax: "journalctl [-u UNIT] [-n N] [-r]",
    examples: [
      { command: "journalctl -u ssh", description: "Logs of the SSH service" },
      { command: "journalctl -n 20", description: "The last 20 entries" },
    ],
    permissions: "Members of adm or systemd-journal (or root) can read all logs.",
    run: journalctl,
  },
  {
    name: "ufw",
    binDir: "/usr/sbin",
    category: "security",
    description: "Uncomplicated Firewall.",
    syntax: "sudo ufw [enable|disable|status|allow|deny|delete|reset] ...",
    options: [
      { flag: "status [verbose|numbered]", description: "show the firewall state and rules" },
      { flag: "allow 22/tcp | allow ssh", description: "permit incoming traffic" },
      { flag: "deny 23", description: "block a port" },
      { flag: "delete allow 80/tcp", description: "remove a rule" },
    ],
    examples: [
      { command: "sudo ufw allow OpenSSH", description: "Never lock yourself out: allow SSH first" },
      { command: "sudo ufw enable", description: "Turn the firewall on" },
      { command: "sudo ufw status verbose", description: "Inspect rules" },
    ],
    permissions: "Requires root.",
    run: ufw,
  },
  {
    name: "nano",
    aliases: ["vim", "vi", "vim.tiny", "editor", "pico"],
    category: "files",
    description: "Edit a text file (opens the Linux Playground editor).",
    syntax: "nano FILE",
    examples: [
      { command: "nano notes.txt", description: "Edit or create a file" },
      { command: "sudo nano /etc/hosts", description: "Edit a system file as root" },
    ],
    permissions: "Saving requires write permission on the file (or its directory for new files).",
    run: editor,
  },
  {
    name: "crontab",
    category: "system",
    description: "Maintain crontab files for individual users.",
    syntax: "crontab [-l | -e | -r]",
    run: (ctx) => {
      const me = ctx.who.username;
      const path = `/var/spool/cron/crontabs/${me}`;
      const node = ctx.fs.tryLookup(path, "/");
      if (ctx.args.includes("-l")) {
        if (!node || !node.content.trim()) {
          ctx.err(`no crontab for ${me}\n`);
          return 1;
        }
        ctx.out(node.content);
        return 0;
      }
      if (ctx.args.includes("-r")) {
        if (node) ctx.fs.remove(node, ctx.now);
        return 0;
      }
      if (ctx.args.includes("-e")) {
        if (!node) {
          const user = findUser(ctx.state, me)!;
          ctx.fs.writeFileAt(path, "# Edit this file to introduce tasks to be run by cron.\n#\n# m h  dom mon dow   command\n", { uid: user.uid, gid: ctx.state.groups.find((g) => g.name === "crontab")?.gid ?? user.gid, mode: 0o600, now: ctx.now });
          ctx.out(`no crontab for ${me} - using an empty one\n`);
        }
        // crontab is setgid in real Ubuntu; the editor grant is scoped to this one file
        return editor({ ...ctx, name: "nano", args: [path], who: { uid: 0, gid: 0, groups: [0], username: "root" } });
      }
      ctx.err("usage:\tcrontab [-u user] file\n\tcrontab [ -u user ] [ -i ] { -e | -l | -r }\n");
      return 1;
    },
  },
  {
    name: "timedatectl",
    category: "system",
    description: "Query the system clock settings.",
    syntax: "timedatectl",
    run: (ctx) => {
      const d = new Date(ctx.now);
      ctx.out(`               Local time: ${DAYS[d.getUTCDay()]} ${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC\n           Universal time: ${DAYS[d.getUTCDay()]} ${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC\n                 RTC time: ${DAYS[d.getUTCDay()]} ${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}\n                Time zone: Etc/UTC (UTC, +0000)\nSystem clock synchronized: yes\n              NTP service: active\n          RTC in local TZ: no\n`);
      return 0;
    },
  },
  {
    name: "dmesg",
    category: "system",
    description: "Print the kernel ring buffer.",
    syntax: "dmesg",
    run: (ctx) => {
      if (ctx.who.uid !== 0) {
        ctx.err("dmesg: read kernel buffer failed: Operation not permitted\n");
        return 1;
      }
      ctx.out(`[    0.000000] Linux version ${KERNEL} (buildd@lcy02-amd64-001) (x86_64-linux-gnu-gcc-13 (Ubuntu 13.2.0-23ubuntu4) 13.2.0) #45-Ubuntu SMP PREEMPT_DYNAMIC\n[    0.000000] Command line: BOOT_IMAGE=/vmlinuz-${KERNEL} root=UUID=8f0e2c41-7a3b-4c55-9d2e-1b6f0a9c3d71 ro quiet splash\n[    0.412345] ata1.00: ATA-6: VBOX HARDDISK, 1.0, max UDMA/133\n[    0.523456] sd 0:0:0:0: [sda] 52428800 512-byte logical blocks: (26.8 GB/25.0 GiB)\n[    0.523789] sd 1:0:0:0: [sdb] 20971520 512-byte logical blocks: (10.7 GB/10.0 GiB)\n[    1.234567] EXT4-fs (sda2): mounted filesystem 8f0e2c41-7a3b-4c55-9d2e-1b6f0a9c3d71 ro with ordered data mode.\n[    2.345678] e1000 0000:00:03.0 eth0: (PCI:33MHz:32-bit) 08:00:27:3a:5c:9e\n`);
      return 0;
    },
  },
  { name: "reboot", binDir: "/usr/sbin", category: "system", description: "Reboot the machine (not possible in the simulator).", syntax: "sudo reboot", run: powerCmd },
  { name: "shutdown", aliases: ["poweroff", "halt"], binDir: "/usr/sbin", category: "system", description: "Power off the machine (not possible in the simulator).", syntax: "sudo shutdown -h now", run: powerCmd },
  {
    name: "tar",
    category: "files",
    description: "Create, list and extract archive files.",
    syntax: "tar -c|-x|-t [-z] [-v] -f ARCHIVE [FILES...] [-C DIR]",
    options: [
      { flag: "-c", description: "create an archive" },
      { flag: "-x", description: "extract an archive" },
      { flag: "-t", description: "list archive contents" },
      { flag: "-z", description: "gzip compression" },
      { flag: "-v", description: "verbose" },
      { flag: "-f FILE", description: "archive file name" },
    ],
    examples: [
      { command: "tar -czvf backup.tar.gz projects/", description: "Back up a directory" },
      { command: "tar -xzvf backup.tar.gz -C /tmp", description: "Restore into /tmp" },
    ],
    run: tar,
  },
  { name: "gzip", aliases: ["gunzip", "zcat"], category: "files", description: "Compress or expand files.", syntax: "gzip [-d] [-k] FILE...", run: gzipCmd },
  { name: "expr", category: "scripting", description: "Evaluate expressions.", syntax: "expr ARG1 OP ARG2", examples: [{ command: "expr 7 + 5", description: "Integer arithmetic" }], run: exprCmd },
  stub("neofetch", { package: "neofetch", description: "Show system information with a logo.", run: neofetch }),
  stub("cowsay", { package: "cowsay", binDir: "/usr/games", description: "A talking cow.", syntax: "cowsay MESSAGE", run: cowsay }),
  stub("figlet", { package: "figlet", description: "Large letter banners.", syntax: "figlet TEXT", run: figlet }),
  stub("git", { package: "git", category: "system", description: "Distributed version control (init/status/config only).", syntax: "git init | git status | git config", run: git }),
  stub("node", {
    package: "nodejs",
    description: "JavaScript runtime (version info only).",
    run: (ctx) => {
      if (ctx.args[0] === "-v" || ctx.args[0] === "--version") {
        ctx.out("v18.19.1\n");
        return 0;
      }
      ctx.err("node: executing JavaScript is not available in Linux Playground (try node --version).\n");
      return 1;
    },
  }),
  stub("python3", {
    aliases: ["python"],
    description: "Python interpreter (version info and print only).",
    run: (ctx) => {
      if (ctx.name === "python") {
        ctx.err("Command 'python' not found, did you mean:\n  command 'python3' from deb python3\n  command 'python' from deb python-is-python3\n");
        return 127;
      }
      if (ctx.args[0] === "-V" || ctx.args[0] === "--version") {
        ctx.out("Python 3.12.3\n");
        return 0;
      }
      if (ctx.args[0] === "-c") {
        const m = /^\s*print\((["'])(.*)\1\)\s*$/.exec(ctx.args[1] ?? "");
        if (m) {
          ctx.out(m[2] + "\n");
          return 0;
        }
      }
      ctx.err("python3: only `python3 --version` and `python3 -c 'print(\"text\")'` are simulated in Linux Playground.\n");
      return 1;
    },
  }),
  stub("nginx", {
    package: "nginx",
    binDir: "/usr/sbin",
    description: "nginx web server control.",
    syntax: "nginx -t | nginx -v | nginx -s reload",
    run: (ctx) => {
      if (ctx.args.includes("-v") || ctx.args.includes("-V")) {
        ctx.err("nginx version: nginx/1.24.0 (Ubuntu)\n");
        return 0;
      }
      if (ctx.who.uid !== 0) {
        ctx.err('nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (13: Permission denied)\n2024/11/12 08:30:00 [emerg] 4321#4321: open() "/run/nginx.pid" failed (13: Permission denied)\n');
        return 1;
      }
      if (ctx.args.includes("-t")) {
        const conf = ctx.fs.tryLookup("/etc/nginx/nginx.conf", "/");
        if (!conf) {
          ctx.err('nginx: [emerg] open() "/etc/nginx/nginx.conf" failed (2: No such file or directory)\nnginx: configuration file /etc/nginx/nginx.conf test failed\n');
          return 1;
        }
        const files = [conf, ...(ctx.fs.tryLookup("/etc/nginx/sites-enabled", "/") ? ctx.fs.list(ctx.fs.lookup("/etc/nginx/sites-enabled", "/")) : [])];
        for (const f of files) {
          if (f.type !== "file" && f.type !== "symlink") continue;
          const node = f.type === "symlink" ? ctx.fs.tryLookup(ctx.fs.pathOf(f), "/") : f;
          if (!node) continue;
          const text = node.content;
          const open = (text.match(/{/g) ?? []).length;
          const close = (text.match(/}/g) ?? []).length;
          if (open !== close) {
            ctx.err(`nginx: [emerg] unexpected ${open > close ? "end of file, expecting \"}\"" : '"}"'} in ${ctx.fs.pathOf(node)}:${text.split("\n").length}\nnginx: configuration file /etc/nginx/nginx.conf test failed\n`);
            return 1;
          }
        }
        ctx.err("nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful\n");
        return 0;
      }
      if (ctx.args.includes("-s")) return 0;
      ctx.err('nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)\nnginx: [emerg] still could not bind()\n');
      return 1;
    },
  }),
  stub("mysql", {
    package: "mysql-server",
    description: "MySQL client (connection test only).",
    run: (ctx) => {
      if (ctx.args.includes("--version") || ctx.args.includes("-V")) {
        ctx.out("mysql  Ver 8.0.39-0ubuntu0.24.04.2 for Linux on x86_64 ((Ubuntu))\n");
        return 0;
      }
      if (!ctx.state.services.mysql?.active) {
        ctx.err("ERROR 2002 (HY000): Can't connect to local MySQL server through socket '/var/run/mysqld/mysqld.sock' (2)\n");
        return 1;
      }
      if (ctx.who.uid !== 0) {
        ctx.err(`ERROR 1045 (28000): Access denied for user '${ctx.who.username}'@'localhost' (using password: NO)\n`);
        return 1;
      }
      ctx.out("Welcome to the MySQL monitor.  Commands end with ; or \\g.\nServer version: 8.0.39-0ubuntu0.24.04.2 (Ubuntu)\n\n(The interactive SQL shell is not part of Linux Playground — the server is running correctly.)\nBye\n");
      return 0;
    },
  }),
  stub("mysqld", { package: "mysql-server", binDir: "/usr/sbin", hidden: true, run: (ctx) => (ctx.err("mysqld: use 'sudo systemctl start mysql' to manage the server.\n"), 1) }),
  stub("apache2", { package: "apache2", binDir: "/usr/sbin", hidden: true, run: (ctx) => (ctx.err("apache2: use 'sudo systemctl start apache2' to manage the server.\n"), 1) }),
  stub("apachectl", { package: "apache2", binDir: "/usr/sbin", description: "Apache control interface.", run: (ctx) => (ctx.args.includes("configtest") || ctx.args.includes("-t") ? (ctx.err("Syntax OK\n"), 0) : (ctx.err("apachectl: use 'sudo systemctl restart apache2'\n"), 1)) }),
  stub("a2ensite", { package: "apache2", binDir: "/usr/sbin", hidden: true, run: (ctx) => (ctx.out(`Site ${ctx.args[0]} already enabled\n`), 0) }),
  stub("a2dissite", { package: "apache2", binDir: "/usr/sbin", hidden: true, run: (ctx) => (ctx.out(`Site ${ctx.args[0]} disabled.\nTo activate the new configuration, you need to run:\n  systemctl reload apache2\n`), 0) }),
  stub("fail2ban-client", {
    package: "fail2ban",
    description: "Configure and control the fail2ban server.",
    run: (ctx) => {
      if (ctx.who.uid !== 0) {
        ctx.err("ERROR  Permission denied to socket: /var/run/fail2ban/fail2ban.sock, (you must be root)\n");
        return 1;
      }
      ctx.out(ctx.args[1] === "sshd" ? "Status for the jail: sshd\n|- Filter\n|  |- Currently failed:\t0\n|  |- Total failed:\t0\n|  `- File list:\t/var/log/auth.log\n`- Actions\n   |- Currently banned:\t0\n   |- Total banned:\t0\n   `- Banned IP list:\t\n" : "Status\n|- Number of jail:\t1\n`- Jail list:\tsshd\n");
      return 0;
    },
  }),
  stub("zip", { package: "zip", hidden: true, run: (ctx) => (ctx.err("zip: use tar -czf in Linux Playground\n"), 1) }),
  stub("unzip", { package: "unzip", hidden: true, run: (ctx) => (ctx.err("unzip: use tar -xzf in Linux Playground\n"), 1) }),
];

export { BINARY_MARKER, REPOSITORY };
