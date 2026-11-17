import { PACKAGE_INDEX } from "./packages";
import type { EnvState, SimProcess } from "./types";
import { seeded } from "./util";

export const TOTAL_MEM_KB = 4013252; // ~4 GiB
export const TOTAL_SWAP_KB = 2097148;

function proc(state: EnvState, p: Partial<SimProcess> & { command: string; args: string; user: string }, now: number): SimProcess {
  const pid = p.pid ?? state.nextPid++;
  const r = seeded(pid);
  return {
    pid,
    ppid: p.ppid ?? 1,
    user: p.user,
    command: p.command,
    args: p.args,
    state: p.state ?? "S",
    nice: p.nice ?? 0,
    startedAt: p.startedAt ?? now,
    endsAt: p.endsAt ?? null,
    tty: p.tty ?? "?",
    cpu: p.cpu ?? Math.round(r * 5) / 10,
    mem: p.mem ?? Math.round(r * 8) / 10,
    vsz: p.vsz ?? 10000 + Math.floor(r * 200000),
    rss: p.rss ?? 2000 + Math.floor(r * 20000),
    service: p.service,
    kernel: p.kernel,
  };
}

/** Kernel threads and core daemons present on every boot. */
export function baseProcesses(state: EnvState, now: number): SimProcess[] {
  const boot = state.bootTime;
  const list: SimProcess[] = [
    proc(state, { pid: 1, ppid: 0, user: "root", command: "systemd", args: "/sbin/init splash", startedAt: boot, cpu: 0.1, mem: 0.3, vsz: 167748, rss: 13012 }, now),
    proc(state, { pid: 2, ppid: 0, user: "root", command: "kthreadd", args: "[kthreadd]", startedAt: boot, kernel: true, cpu: 0, mem: 0, vsz: 0, rss: 0 }, now),
    proc(state, { pid: 3, ppid: 2, user: "root", command: "pool_workqueue_release", args: "[pool_workqueue_release]", startedAt: boot, kernel: true, cpu: 0, mem: 0, vsz: 0, rss: 0, state: "S" }, now),
    proc(state, { pid: 4, ppid: 2, user: "root", command: "kworker/R-rcu_g", args: "[kworker/R-rcu_g]", startedAt: boot, kernel: true, cpu: 0, mem: 0, vsz: 0, rss: 0, state: "I", nice: -20 }, now),
    proc(state, { pid: 13, ppid: 2, user: "root", command: "ksoftirqd/0", args: "[ksoftirqd/0]", startedAt: boot, kernel: true, cpu: 0, mem: 0, vsz: 0, rss: 0 }, now),
    proc(state, { pid: 14, ppid: 2, user: "root", command: "rcu_preempt", args: "[rcu_preempt]", startedAt: boot, kernel: true, cpu: 0, mem: 0, vsz: 0, rss: 0, state: "I" }, now),
    proc(state, { pid: 287, ppid: 1, user: "root", command: "systemd-journal", args: "/usr/lib/systemd/systemd-journald", startedAt: boot, cpu: 0, mem: 0.4, vsz: 50140, rss: 16384, service: "systemd-journald" }, now),
    proc(state, { pid: 342, ppid: 1, user: "root", command: "systemd-udevd", args: "/usr/lib/systemd/systemd-udevd", startedAt: boot, cpu: 0, mem: 0.2, vsz: 25912, rss: 7040, service: "systemd-udevd" }, now),
    proc(state, { pid: 512, ppid: 1, user: "systemd-network", command: "systemd-network", args: "/usr/lib/systemd/systemd-networkd", startedAt: boot, cpu: 0, mem: 0.2, vsz: 18788, rss: 8448, service: "systemd-networkd" }, now),
    proc(state, { pid: 518, ppid: 1, user: "systemd-resolve", command: "systemd-resolve", args: "/usr/lib/systemd/systemd-resolved", startedAt: boot, cpu: 0, mem: 0.3, vsz: 21452, rss: 12672, service: "systemd-resolved" }, now),
    proc(state, { pid: 601, ppid: 1, user: "root", command: "cron", args: "/usr/sbin/cron -f -P", startedAt: boot, cpu: 0, mem: 0.1, vsz: 6824, rss: 2688, service: "cron" }, now),
    proc(state, { pid: 603, ppid: 1, user: "messagebus", command: "dbus-daemon", args: "@dbus-daemon --system --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only", startedAt: boot, cpu: 0, mem: 0.1, vsz: 9772, rss: 5376, service: "dbus" }, now),
    proc(state, { pid: 618, ppid: 1, user: "syslog", command: "rsyslogd", args: "/usr/sbin/rsyslogd -n -iNONE", startedAt: boot, cpu: 0, mem: 0.1, vsz: 222508, rss: 5632, service: "rsyslog" }, now),
    proc(state, { pid: 622, ppid: 1, user: "root", command: "systemd-logind", args: "/usr/lib/systemd/systemd-logind", startedAt: boot, cpu: 0, mem: 0.2, vsz: 17964, rss: 8320, service: "systemd-logind" }, now),
    proc(state, { pid: 705, ppid: 1, user: "root", command: "agetty", args: "/sbin/agetty -o -p -- \\u --noclear - linux", startedAt: boot, tty: "tty1", cpu: 0, mem: 0, vsz: 6176, rss: 1920 }, now),
  ];
  return list;
}

/** The interactive bash process of the logged-in user. */
export function shellProcess(state: EnvState, user: string, now: number): SimProcess {
  return proc(state, { user, command: "bash", args: "-bash", tty: "pts/0", ppid: 1001, startedAt: now, cpu: 0, mem: 0.1, vsz: 11268, rss: 5248, state: "S" }, now);
}

/** Start the processes of a service unit. */
export function startServiceProcesses(state: EnvState, unit: string, now: number) {
  stopServiceProcesses(state, unit);
  const pkg = [...PACKAGE_INDEX.values()].find((p) => p.service?.unit === unit);
  if (!pkg?.service) return;
  let master: number | undefined;
  for (const sp of pkg.service.processes) {
    const p = proc(state, { user: sp.user, command: sp.command, args: sp.args, ppid: master ?? 1, service: unit, startedAt: now }, now);
    if (master === undefined) master = p.pid;
    state.processes.push(p);
  }
}

export function stopServiceProcesses(state: EnvState, unit: string) {
  state.processes = state.processes.filter((p) => p.service !== unit);
}

export function findProcess(state: EnvState, pid: number): SimProcess | undefined {
  return state.processes.find((p) => p.pid === pid);
}

/**
 * Remove background processes whose time has elapsed and mark their jobs
 * as done. Returns finished job notices (`[1]+  Done   sleep 5`).
 */
export function reapProcesses(state: EnvState, now: number): string[] {
  const notices: string[] = [];
  const finished = state.processes.filter((p) => p.endsAt && p.endsAt <= now && p.state !== "T");
  if (finished.length === 0) {
    // drop jobs whose process disappeared (killed)
    const before = state.session.jobs.length;
    state.session.jobs = state.session.jobs.filter((j) => state.processes.some((p) => p.pid === j.pid));
    void before;
    return notices;
  }
  const ids = new Set(finished.map((p) => p.pid));
  state.processes = state.processes.filter((p) => !ids.has(p.pid));
  const jobs = state.session.jobs;
  for (const job of jobs) {
    if (ids.has(job.pid)) {
      const marker = job === jobs[jobs.length - 1] ? "+" : job === jobs[jobs.length - 2] ? "-" : " ";
      notices.push(`[${job.id}]${marker}  Done                    ${job.command}`);
    }
  }
  state.session.jobs = jobs.filter((j) => !ids.has(j.pid) && state.processes.some((p) => p.pid === j.pid));
  return notices;
}

/** Simulated, gently fluctuating memory figures in KiB. */
export function memoryStats(state: EnvState, now: number) {
  const procKb = state.processes.reduce((sum, p) => sum + p.rss, 0);
  const wobble = Math.floor(seeded(Math.floor(now / 5000)) * 40000);
  const used = 612000 + procKb + wobble;
  const buffCache = 1102400 + Math.floor(wobble / 2);
  const shared = 4128;
  const free = TOTAL_MEM_KB - used - buffCache;
  const available = free + buffCache - 120000;
  return { total: TOTAL_MEM_KB, used, free, shared, buffCache, available, swapTotal: TOTAL_SWAP_KB, swapUsed: 0, swapFree: TOTAL_SWAP_KB };
}

export function loadAverage(now: number): [number, number, number] {
  const r = seeded(Math.floor(now / 60000));
  return [Math.round(r * 30) / 100, Math.round(r * 22) / 100, Math.round(r * 15) / 100];
}

export function uptimeString(state: EnvState, now: number): string {
  const secs = Math.max(0, Math.floor((now - state.bootTime) / 1000));
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const hm = hours > 0 ? `${hours}:${String(mins).padStart(2, "0")}` : `${mins} min`;
  return days > 0 ? `${days} day${days > 1 ? "s" : ""}, ${hm}` : hm;
}
