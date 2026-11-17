import { PACKAGE_INDEX } from "../packages";
import { loadAverage, memoryStats } from "../processes";
import type { SimProcess } from "../types";
import { findUser } from "../users";
import { hhmm } from "../util";
import { withOpts } from "./helpers";
import type { CommandContext, CommandDef } from "./types";

export const SIGNALS: Record<string, number> = {
  HUP: 1, INT: 2, QUIT: 3, ILL: 4, TRAP: 5, ABRT: 6, BUS: 7, FPE: 8, KILL: 9, USR1: 10, SEGV: 11, USR2: 12, PIPE: 13, ALRM: 14, TERM: 15, STKFLT: 16, CHLD: 17, CONT: 18, STOP: 19, TSTP: 20, TTIN: 21, TTOU: 22,
};

function cpuTime(p: SimProcess, now: number, long = false): string {
  const secs = Math.floor(((now - p.startedAt) / 1000) * (p.cpu / 100));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (long) return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function statOf(p: SimProcess): string {
  let s = p.state;
  if (p.nice < 0) s += "<";
  else if (p.nice > 0) s += "N";
  if (p.pid === 1 || p.command === "bash" || p.args.includes("master")) s += "s";
  if (p.tty.startsWith("pts") && p.command !== "bash") s += "+";
  return s;
}

/** Process list including a transient entry for the running command itself. */
function snapshot(ctx: CommandContext, selfCmd: string): SimProcess[] {
  const self: SimProcess = {
    pid: ctx.state.nextPid,
    ppid: ctx.state.processes.find((p) => p.command === "bash" && p.user === ctx.state.session.userStack[0].user)?.pid ?? 1,
    user: ctx.who.username,
    command: selfCmd.split(" ")[0],
    args: selfCmd,
    state: "R",
    nice: 0,
    startedAt: ctx.now,
    tty: "pts/0",
    cpu: 0,
    mem: 0.1,
    vsz: 11712,
    rss: 4352,
  };
  return [...ctx.state.processes, self].sort((a, b) => a.pid - b.pid);
}

function ps(ctx: CommandContext): number {
  const args = ctx.args;
  const bsd = args.some((a) => /^[a-z]*a[a-z]*$/.test(a) && !a.startsWith("-")) || args.includes("aux") || args.includes("ax");
  const full = args.includes("-ef") || args.includes("-f") || args.includes("-eF");
  const all = bsd || args.includes("-e") || args.includes("-A") || args.includes("-ef") || args.includes("-eF");
  let filterUser: string | undefined;
  let filterPids: number[] | undefined;
  let format: string[] | undefined;
  let sortKey: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-u" || a === "-U" || a === "--user") filterUser = args[++i];
    else if (a === "-p" || a === "--pid") filterPids = (args[++i] ?? "").split(",").map(Number);
    else if (a === "-o" || a === "--format") format = (args[++i] ?? "").split(",");
    else if (a.startsWith("--sort=")) sortKey = a.slice(7);
    else if (a === "--sort") sortKey = args[++i];
    else if (/^-[A-Za-z]+$/.test(a) && !/^-[efFAuopaxlj]+$/.test(a)) {
      ctx.err(`error: unsupported option (BSD syntax)\n\nUsage:\n ps [options]\n\n Try 'ps --help <simple|list|output|threads|misc|all>'\n  or 'ps --help <s|l|o|t|m|a>'\n for additional help text.\n\nFor more details see ps(1).\n`);
      return 1;
    }
  }
  let procs = snapshot(ctx, ["ps", ...args].join(" "));
  if (filterUser) {
    const u = findUser(ctx.state, filterUser);
    procs = procs.filter((p) => p.user === (u?.username ?? filterUser));
  } else if (filterPids) procs = procs.filter((p) => filterPids!.includes(p.pid));
  else if (!all) procs = procs.filter((p) => p.tty === "pts/0" && p.user === ctx.who.username);
  if (sortKey) {
    const desc = sortKey.startsWith("-");
    const k = sortKey.replace(/^[-+]/, "");
    const val = (p: SimProcess): number | string => (k === "%cpu" || k === "pcpu" ? p.cpu : k === "%mem" || k === "pmem" ? p.mem : k === "rss" ? p.rss : k === "vsz" ? p.vsz : k === "user" ? p.user : p.pid);
    procs.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return desc ? -r : r;
    });
  }
  const now = ctx.now;
  if (format) {
    const cols: Record<string, { h: string; w: number; right: boolean; v: (p: SimProcess) => string }> = {
      pid: { h: "PID", w: 7, right: true, v: (p) => String(p.pid) },
      ppid: { h: "PPID", w: 7, right: true, v: (p) => String(p.ppid) },
      user: { h: "USER", w: 8, right: false, v: (p) => p.user },
      uid: { h: "UID", w: 5, right: true, v: (p) => String(findUser(ctx.state, p.user)?.uid ?? 0) },
      comm: { h: "COMMAND", w: 15, right: false, v: (p) => p.command },
      cmd: { h: "CMD", w: 0, right: false, v: (p) => p.args },
      args: { h: "COMMAND", w: 0, right: false, v: (p) => p.args },
      "%cpu": { h: "%CPU", w: 4, right: true, v: (p) => p.cpu.toFixed(1) },
      pcpu: { h: "%CPU", w: 4, right: true, v: (p) => p.cpu.toFixed(1) },
      "%mem": { h: "%MEM", w: 4, right: true, v: (p) => p.mem.toFixed(1) },
      pmem: { h: "%MEM", w: 4, right: true, v: (p) => p.mem.toFixed(1) },
      stat: { h: "STAT", w: 4, right: false, v: statOf },
      ni: { h: "NI", w: 3, right: true, v: (p) => String(p.nice) },
      tty: { h: "TT", w: 8, right: false, v: (p) => p.tty },
      rss: { h: "RSS", w: 6, right: true, v: (p) => String(p.rss) },
      vsz: { h: "VSZ", w: 7, right: true, v: (p) => String(p.vsz) },
      etime: { h: "ELAPSED", w: 11, right: true, v: (p) => cpuTime({ ...p, cpu: 100 }, now, true) },
    };
    for (const f of format) {
      if (!cols[f.toLowerCase()]) {
        ctx.err(`error: unknown user-defined format specifier "${f}"\n`);
        return 1;
      }
    }
    const sel = format.map((f) => cols[f.toLowerCase()]);
    const row = (vals: string[]) => vals.map((v, i) => (i === vals.length - 1 && !sel[i].right ? v : sel[i].right ? v.padStart(sel[i].w) : v.padEnd(sel[i].w))).join(" ");
    ctx.out(row(sel.map((c) => c.h)) + "\n");
    for (const p of procs) ctx.out(row(sel.map((c) => c.v(p))) + "\n");
    return 0;
  }
  if (bsd) {
    ctx.out("USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n");
    for (const p of procs) {
      ctx.out(`${p.user.slice(0, 8).padEnd(8)} ${String(p.pid).padStart(7)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${String(p.vsz).padStart(6)} ${String(p.rss).padStart(5)} ${p.tty.padEnd(8)} ${statOf(p).padEnd(4)} ${hhmm(p.startedAt)}   ${cpuTime(p, now)} ${p.args}\n`);
    }
    return 0;
  }
  if (full) {
    ctx.out("UID          PID    PPID  C STIME TTY          TIME CMD\n");
    for (const p of procs) ctx.out(`${p.user.slice(0, 8).padEnd(8)} ${String(p.pid).padStart(7)} ${String(p.ppid).padStart(7)}  ${Math.round(p.cpu)} ${hhmm(p.startedAt)} ${p.tty.padEnd(8)} ${cpuTime(p, now, true)} ${p.args}\n`);
    return 0;
  }
  ctx.out("    PID TTY          TIME CMD\n");
  for (const p of procs) ctx.out(`${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} ${cpuTime(p, now, true)} ${p.command}\n`);
  return 0;
}

function top(ctx: CommandContext): number {
  const s = ctx.state;
  const now = ctx.now;
  const procs = snapshot(ctx, "top");
  const mem = memoryStats(s, now);
  const [l1, l5, l15] = loadAverage(now);
  const running = procs.filter((p) => p.state === "R").length;
  const stopped = procs.filter((p) => p.state === "T").length;
  const t = new Date(now);
  const time = `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}:${String(t.getUTCSeconds()).padStart(2, "0")}`;
  const users = new Set(s.logins.filter((l) => !l.logoutAt).map((l) => l.user)).size;
  const mib = (kb: number) => (kb / 1024).toFixed(1).padStart(8);
  const header = ctx.name === "htop" ? "" : "";
  void header;
  ctx.out(`top - ${time} up ${ctx.shell.uptimeText()},  ${users} user${users === 1 ? "" : "s"},  load average: ${l1.toFixed(2)}, ${l5.toFixed(2)}, ${l15.toFixed(2)}\n`);
  ctx.out(`Tasks: ${String(procs.length + 96).padStart(3)} total,   ${running} running, ${procs.length + 96 - running - stopped} sleeping,   ${stopped} stopped,   0 zombie\n`);
  ctx.out(`%Cpu(s):  1.3 us,  0.7 sy,  0.0 ni, 97.9 id,  0.0 wa,  0.0 hi,  0.1 si,  0.0 st\n`);
  ctx.out(`MiB Mem : ${mib(mem.total)} total, ${mib(mem.free)} free, ${mib(mem.used)} used, ${mib(mem.buffCache)} buff/cache\n`);
  ctx.out(`MiB Swap: ${mib(mem.swapTotal)} total, ${mib(mem.swapFree)} free, ${mib(mem.swapUsed)} used. ${mib(mem.available)} avail Mem\n\n`);
  ctx.out(`${ctx.stdoutIsTTY ? "\x1b[7m" : ""}    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND${ctx.stdoutIsTTY ? "\x1b[0m" : ""}\n`);
  const sorted = [...procs].sort((a, b) => b.cpu - a.cpu || a.pid - b.pid).slice(0, 25);
  for (const p of sorted) {
    const pr = p.kernel && p.nice === -20 ? "0" : String(20 + p.nice);
    const secs = ((now - p.startedAt) / 1000) * (p.cpu / 100);
    const tplus = `${Math.floor(secs / 60)}:${(secs % 60).toFixed(2).padStart(5, "0")}`;
    ctx.out(`${String(p.pid).padStart(7)} ${p.user.slice(0, 8).padEnd(8)}  ${pr.padStart(2)} ${String(p.nice).padStart(3)} ${String(p.vsz).padStart(7)} ${String(p.rss).padStart(6)} ${String(Math.floor(p.rss * 0.6)).padStart(6)} ${p.state} ${p.cpu.toFixed(1).padStart(5)} ${p.mem.toFixed(1).padStart(5)} ${tplus.padStart(9)} ${p.command}\n`);
  }
  if (ctx.stdoutIsTTY) ctx.out("\x1b[2m(Linux Playground shows a single snapshot of top. Run it again to refresh.)\x1b[0m\n");
  return 0;
}

function parseSignal(spec: string): number | null {
  const s = spec.replace(/^-/, "").toUpperCase().replace(/^SIG/, "");
  if (/^\d+$/.test(s)) return Number(s) <= 64 ? Number(s) : null;
  return SIGNALS[s] ?? null;
}

/** Deliver a signal. Returns an error message or null. */
export function signalProcess(ctx: CommandContext, pid: number, sig: number): string | null {
  const s = ctx.state;
  const p = s.processes.find((x) => x.pid === pid);
  if (!p) return "No such process";
  const owner = findUser(s, p.user);
  if (ctx.who.uid !== 0 && owner?.uid !== ctx.who.uid) return "Operation not permitted";
  if (sig === 0) return null;
  if (p.pid === 1 || p.kernel) return null; // init and kernel threads ignore signals
  if (p.command === "bash" && p.tty === "pts/0" && (sig === 15 || sig === 2 || sig === 1)) return null; // interactive bash ignores TERM/INT
  if (sig === 19 || sig === 20) {
    p.state = "T";
    const job = s.session.jobs.find((j) => j.pid === pid);
    if (job) job.state = "Stopped";
    return null;
  }
  if (sig === 18) {
    if (p.state === "T") p.state = "S";
    const job = s.session.jobs.find((j) => j.pid === pid);
    if (job) job.state = "Running";
    return null;
  }
  if (sig === 1 && p.service) {
    ctx.shell.log("syslog", "systemd[1]", `Reloading ${p.service}.service...`);
    return null;
  }
  if (sig === 10 || sig === 12 || sig === 17 || sig === 28) return null;
  // terminate
  if (p.service) {
    const unit = p.service;
    const isMaster = !s.processes.some((x) => x.service === unit && x.pid < p.pid);
    if (isMaster) {
      s.processes = s.processes.filter((x) => x.service !== unit);
      const svc = s.services[unit];
      if (svc) {
        svc.active = false;
        svc.since = ctx.now;
      }
      ctx.shell.log("syslog", "systemd[1]", `${unit}.service: Main process exited, code=killed, status=${sig}/${Object.keys(SIGNALS).find((k) => SIGNALS[k] === sig) ?? sig}`);
      return null;
    }
  }
  if (p.command === "bash" && p.tty === "pts/0" && sig === 9) {
    // killing your own shell: the terminal restarts
    ctx.shell.actions.push({ type: "reset-terminal" });
    return null;
  }
  s.processes = s.processes.filter((x) => x.pid !== pid);
  const job = s.session.jobs.find((j) => j.pid === pid);
  if (job) {
    s.session.jobs = s.session.jobs.filter((j) => j !== job);
    ctx.shell.jobNotices.push(`[${job.id}]+  ${sig === 9 ? "Killed" : "Terminated"}              ${job.command}`);
  }
  return null;
}

function kill(ctx: CommandContext): number {
  const args = [...ctx.args];
  if (args[0] === "-l" || args[0] === "-L") {
    if (args[1]) {
      const n = Number(args[1]);
      const name = Object.keys(SIGNALS).find((k) => SIGNALS[k] === n);
      ctx.out((name ?? "") + "\n");
      return name ? 0 : 1;
    }
    const entries = Object.entries(SIGNALS).map(([k, v]) => `${String(v).padStart(2)}) SIG${k}`.padEnd(15));
    for (let i = 0; i < entries.length; i += 5) ctx.out(entries.slice(i, i + 5).join("\t").trimEnd() + "\n");
    return 0;
  }
  let sig = 15;
  if (args[0] === "-s" || args[0] === "-n") {
    const s = parseSignal(args[1] ?? "");
    if (s === null) {
      ctx.err(`${ctx.shell.errPrefix()}: kill: ${args[1]}: invalid signal specification\n`);
      return 1;
    }
    sig = s;
    args.splice(0, 2);
  } else if (args[0]?.startsWith("-") && args[0] !== "--") {
    const s = parseSignal(args[0]);
    if (s === null) {
      ctx.err(`${ctx.shell.errPrefix()}: kill: ${args[0].slice(1)}: invalid signal specification\n`);
      return 1;
    }
    sig = s;
    args.shift();
  }
  if (!args.length) {
    ctx.err(`kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n`);
    return 2;
  }
  let status = 0;
  for (const a of args) {
    let pid: number;
    if (a.startsWith("%")) {
      const job = ctx.state.session.jobs.find((j) => j.id === Number(a.slice(1)));
      if (!job) {
        ctx.err(`${ctx.shell.errPrefix()}: kill: ${a}: no such job\n`);
        status = 1;
        continue;
      }
      pid = job.pid;
    } else if (/^-?\d+$/.test(a)) pid = Number(a);
    else {
      ctx.err(`${ctx.shell.errPrefix()}: kill: ${a}: arguments must be process or job IDs\n`);
      status = 1;
      continue;
    }
    const err = signalProcess(ctx, pid, sig);
    if (err) {
      ctx.err(`${ctx.shell.errPrefix()}: kill: (${pid}) - ${err}\n`);
      status = 1;
    }
  }
  return status;
}

function matching(ctx: CommandContext, pattern: string, exact: boolean, full = false, user?: string): SimProcess[] {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    re = /$^/;
  }
  return ctx.state.processes.filter((p) => {
    if (p.kernel && !exact) return false;
    if (user && p.user !== user) return false;
    if (exact) return p.command === pattern || p.args.split(" ")[0].split("/").pop() === pattern;
    return re.test(full ? p.args : p.command);
  });
}

function killall(ctx: CommandContext): number {
  let sig = 15;
  const names: string[] = [];
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === "-s" || a === "--signal") sig = parseSignal(ctx.args[++i] ?? "") ?? 15;
    else if (a.startsWith("-") && parseSignal(a) !== null) sig = parseSignal(a)!;
    else names.push(a);
  }
  if (!names.length) {
    ctx.err("Usage: killall [OPTION]... [--] NAME...\n");
    return 1;
  }
  let status = 0;
  for (const n of names) {
    const procs = matching(ctx, n, true);
    if (!procs.length) {
      ctx.err(`${n}: no process found\n`);
      status = 1;
      continue;
    }
    for (const p of [...procs].sort((a, b) => b.pid - a.pid)) {
      const err = signalProcess(ctx, p.pid, sig);
      if (err) {
        ctx.err(`${n}(${p.pid}): ${err}\n`);
        status = 1;
      }
    }
  }
  return status;
}

function pgrep(ctx: CommandContext, kill: boolean): number {
  return withOpts(ctx, { flags: "lafxn", withValue: "uU", long: { "list-name": "l", "list-full": "a", full: "f", exact: "x", "signal=": "signal" } }, (o) => {
    const pattern = o.operands[0];
    if (!pattern) {
      ctx.err(`Usage:\n ${ctx.name} [options] <pattern>\n`);
      return 2;
    }
    let procs = matching(ctx, pattern, o.flags.has("x"), o.flags.has("f"), o.values.u ?? o.values.U);
    if (o.flags.has("n")) procs = procs.slice(-1);
    if (!procs.length) return 1;
    if (kill) {
      const sig = o.values.signal ? (parseSignal(o.values.signal) ?? 15) : 15;
      let status = 0;
      for (const p of procs) {
        const err = signalProcess(ctx, p.pid, sig);
        if (err) {
          ctx.err(`pkill: killing pid ${p.pid} failed: ${err}\n`);
          status = 1;
        }
      }
      return status;
    }
    for (const p of procs) ctx.out(o.flags.has("a") ? `${p.pid} ${p.args}\n` : o.flags.has("l") ? `${p.pid} ${p.command}\n` : `${p.pid}\n`);
    return 0;
  });
}

function pidof(ctx: CommandContext): number {
  const pids = ctx.args.flatMap((n) => matching(ctx, n, true).map((p) => p.pid)).sort((a, b) => b - a);
  if (!pids.length) return 1;
  ctx.out(pids.join(" ") + "\n");
  return 0;
}

function renice(ctx: CommandContext): number {
  let n: number | null = null;
  const pids: number[] = [];
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === "-n" || a === "--priority") n = Number(ctx.args[++i]);
    else if (a === "-p") continue;
    else if (/^[+-]?\d+$/.test(a) && n === null) n = Number(a);
    else if (/^\d+$/.test(a)) pids.push(Number(a));
  }
  if (n === null || !pids.length) {
    ctx.err(" renice [-n] <priority> [-p|--pid] <pid>...\n");
    return 1;
  }
  let status = 0;
  for (const pid of pids) {
    const p = ctx.state.processes.find((x) => x.pid === pid);
    if (!p) {
      ctx.err(`renice: failed to get priority for ${pid} (process ID): No such process\n`);
      status = 1;
      continue;
    }
    const isOwner = findUser(ctx.state, p.user)?.uid === ctx.who.uid;
    if (ctx.who.uid !== 0 && (!isOwner || n < p.nice)) {
      ctx.err(`renice: failed to set priority for ${pid} (process ID): Permission denied\n`);
      status = 1;
      continue;
    }
    const old = p.nice;
    p.nice = Math.max(-20, Math.min(19, n));
    ctx.out(`${pid} (process ID) old priority ${old}, new priority ${p.nice}\n`);
  }
  return status;
}

function nice(ctx: CommandContext): number {
  let n = 10;
  let i = 0;
  if (ctx.args[0] === "-n") {
    n = Number(ctx.args[1]);
    i = 2;
  } else if (/^-\d+$/.test(ctx.args[0] ?? "")) {
    n = Number(ctx.args[0].slice(1));
    i = 1;
  }
  const cmd = ctx.args.slice(i);
  if (!cmd.length) {
    ctx.out("0\n");
    return 0;
  }
  if (n < 0 && ctx.who.uid !== 0) ctx.err("nice: cannot set niceness: Permission denied\n");
  return ctx.shell.runArgv(cmd, ctx.shell.ioFromContext(ctx));
}

function uptime(ctx: CommandContext): number {
  if (ctx.args.includes("-p") || ctx.args.includes("--pretty")) {
    const secs = Math.floor((ctx.now - ctx.state.bootTime) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const parts: string[] = [];
    if (h) parts.push(`${h} hour${h > 1 ? "s" : ""}`);
    parts.push(`${m} minute${m === 1 ? "" : "s"}`);
    ctx.out(`up ${parts.join(", ")}\n`);
    return 0;
  }
  if (ctx.args.includes("-s")) {
    ctx.out(new Date(ctx.state.bootTime).toISOString().replace("T", " ").slice(0, 19) + "\n");
    return 0;
  }
  const t = new Date(ctx.now);
  const [l1, l5, l15] = loadAverage(ctx.now);
  const users = new Set(ctx.state.logins.filter((l) => !l.logoutAt).map((l) => l.user)).size;
  ctx.out(` ${t.toISOString().slice(11, 19)} up ${ctx.shell.uptimeText()},  ${users} user${users === 1 ? "" : "s"},  load average: ${l1.toFixed(2)}, ${l5.toFixed(2)}, ${l15.toFixed(2)}\n`);
  return 0;
}

export const processCommands: CommandDef[] = [
  {
    name: "ps",
    category: "processes",
    description: "Report a snapshot of the current processes.",
    syntax: "ps [aux | -ef | -u USER | -p PID | -o FORMAT]",
    options: [
      { flag: "aux", description: "all processes, BSD style with CPU/MEM usage" },
      { flag: "-ef", description: "all processes, full format with PPID" },
      { flag: "-u USER", description: "processes of a user" },
      { flag: "-o pid,user,cmd", description: "choose columns" },
      { flag: "--sort=-%mem", description: "sort by a column" },
    ],
    examples: [
      { command: "ps", description: "Processes in your terminal" },
      { command: "ps aux", description: "Every process on the system" },
      { command: "ps aux | grep nginx", description: "Find a specific program" },
    ],
    run: ps,
  },
  { name: "top", category: "processes", description: "Display Linux processes (one snapshot in the simulator).", syntax: "top", examples: [{ command: "top", description: "What is using the CPU and memory?" }], run: top },
  { name: "htop", package: "htop", category: "processes", description: "Interactive process viewer (snapshot).", syntax: "htop", run: top },
  {
    name: "kill",
    category: "processes",
    description: "Send a signal to a process.",
    syntax: "kill [-SIGNAL] PID... | kill -l",
    options: [
      { flag: "-15 / -TERM", description: "ask the process to terminate (default)" },
      { flag: "-9 / -KILL", description: "force kill immediately" },
      { flag: "-STOP / -CONT", description: "pause / resume" },
      { flag: "-l", description: "list signal names" },
    ],
    examples: [
      { command: "kill 1234", description: "Politely stop process 1234" },
      { command: "kill -9 1234", description: "Force kill" },
      { command: "kill %1", description: "Kill background job 1" },
    ],
    permissions: "You can only signal your own processes unless you are root.",
    run: kill,
  },
  { name: "killall", category: "processes", description: "Kill processes by name.", syntax: "killall [-SIGNAL] NAME...", examples: [{ command: "sudo killall nginx", description: "Stop every nginx process" }], run: killall },
  { name: "pkill", category: "processes", description: "Signal processes matching a pattern.", syntax: "pkill [-f] [-u USER] PATTERN", run: (ctx) => pgrep(ctx, true) },
  { name: "pgrep", category: "processes", description: "Look up processes by name.", syntax: "pgrep [-l] [-u USER] PATTERN", examples: [{ command: "pgrep -l ssh", description: "PIDs and names of ssh processes" }], run: (ctx) => pgrep(ctx, false) },
  { name: "pidof", category: "processes", description: "Find the process ID of a running program.", syntax: "pidof PROGRAM...", binDir: "/usr/bin", run: pidof },
  { name: "nice", category: "processes", description: "Run a program with modified scheduling priority.", syntax: "nice [-n N] COMMAND [ARG]...", run: nice },
  { name: "renice", category: "processes", description: "Alter priority of running processes.", syntax: "renice -n N -p PID", examples: [{ command: "renice -n 10 -p 1234", description: "Lower a process's priority" }], run: renice },
  {
    name: "sleep",
    category: "processes",
    description: "Delay for a specified amount of time (use & to run it in the background).",
    syntax: "sleep NUMBER[smhd]",
    examples: [
      { command: "sleep 300 &", description: "Start a background job" },
      { command: "jobs", description: "See it running" },
    ],
    run: (ctx) => {
      if (!ctx.args.length) {
        ctx.err("sleep: missing operand\nTry 'sleep --help' for more information.\n");
        return 1;
      }
      for (const a of ctx.args) {
        if (!/^\d+(\.\d+)?[smhd]?$/.test(a)) {
          ctx.err(`sleep: invalid time interval ‘${a}’\nTry 'sleep --help' for more information.\n`);
          return 1;
        }
      }
      return 0;
    },
  },
  { name: "uptime", category: "processes", description: "Tell how long the system has been running.", syntax: "uptime [-p]", run: uptime },
];

export { PACKAGE_INDEX };
