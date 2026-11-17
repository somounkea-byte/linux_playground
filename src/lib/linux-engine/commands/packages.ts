import type { VirtualFileSystem } from "../filesystem";
import { BINARY_MARKER } from "../interpreter";
import { availableVersion, PACKAGE_INDEX, REPOSITORY, resolveInstall, type RepoPackage } from "../packages";
import { startServiceProcesses, stopServiceProcesses } from "../processes";
import type { EnvState } from "../types";
import { addUser, findGroup, findUser, syncEtcFiles } from "../users";
import type { CommandContext, CommandDef } from "./types";

const ARCH = "amd64";

function fmtKb(kb: number): string {
  return kb >= 1000 ? `${(kb / 1000).toFixed(kb >= 10000 ? 0 : 1)} MB` : `${kb} kB`;
}

function fmtThousands(kb: number): string {
  return kb.toLocaleString("en-US");
}

function upgradable(state: EnvState): RepoPackage[] {
  if (!state.packages.lastUpdate) return [];
  return Object.entries(state.packages.installed)
    .map(([name, info]) => ({ pkg: PACKAGE_INDEX.get(name), info }))
    .filter((x) => x.pkg?.newVersion && x.info.version !== x.pkg.newVersion)
    .map((x) => x.pkg!);
}

/** Install a package into the environment (files, binaries, users, services). */
export function installPackage(state: EnvState, fs: VirtualFileSystem, pkg: RepoPackage, now: number, auto: boolean, log?: (file: "syslog", src: string, msg: string) => void) {
  const version = availableVersion(pkg, !!state.packages.lastUpdate);
  state.packages.installed[pkg.name] = { version, installedAt: now, auto };
  if (pkg.systemUser && !findUser(state, pkg.systemUser.name)) {
    addUser(state, fs, { username: pkg.systemUser.name, system: true, home: pkg.systemUser.home, shell: "/bin/false", gecos: pkg.systemUser.gecos, createHome: false, now });
  }
  for (const bin of pkg.binaries) {
    fs.writeFileAt(`${pkg.binDir ?? "/usr/bin"}/${bin}`, BINARY_MARKER + bin, { uid: 0, gid: 0, mode: 0o755, size: 40000 + bin.length * 1371, now });
  }
  for (const f of pkg.files ?? []) {
    if (fs.tryLookup(f.path, "/")) continue; // keep existing config
    const owner = f.owner ? findUser(state, f.owner) : undefined;
    fs.writeFileAt(f.path, f.content, { uid: owner?.uid ?? 0, gid: owner ? (findGroup(state, owner.gid)?.gid ?? 0) : 0, mode: f.mode ?? 0o644, now });
  }
  fs.mkdirp(`/usr/share/doc/${pkg.name}`, { uid: 0, gid: 0 }, 0o755, now);
  if (pkg.service) {
    const unit = pkg.service.unit;
    state.services[unit] = { name: unit, enabled: pkg.service.enableOnInstall, active: true, since: now };
    // two web servers cannot both bind port 80
    const conflict = pkg.service.ports.some((p) => Object.values(state.services).some((s) => s.active && s.name !== unit && PACKAGE_INDEX.get(serviceOwner(s.name) ?? "")?.service?.ports.some((q) => q.port === p.port)));
    if (conflict) {
      state.services[unit].active = false;
      log?.("syslog", "systemd[1]", `Failed to start ${unit}.service - ${pkg.service.description}.`);
    } else {
      startServiceProcesses(state, unit, now);
      log?.("syslog", "systemd[1]", `Started ${unit}.service - ${pkg.service.description}.`);
    }
  }
}

export function serviceOwner(unit: string): string | undefined {
  return REPOSITORY.find((p) => p.service?.unit === unit)?.name;
}

export function removePackage(state: EnvState, fs: VirtualFileSystem, pkg: RepoPackage, purge: boolean, now: number) {
  delete state.packages.installed[pkg.name];
  for (const bin of pkg.binaries) {
    const n = fs.tryLookup(`${pkg.binDir ?? "/usr/bin"}/${bin}`, "/", null, false);
    if (n) fs.remove(n, now);
  }
  if (purge) {
    for (const f of pkg.files ?? []) {
      if (f.path.startsWith("/var/www")) continue; // web content is user data
      const n = fs.tryLookup(f.path, "/", null, false);
      if (n) fs.remove(n, now);
    }
  }
  const doc = fs.tryLookup(`/usr/share/doc/${pkg.name}`, "/", null, false);
  if (doc) fs.remove(doc, now);
  if (pkg.service) {
    stopServiceProcesses(state, pkg.service.unit);
    delete state.services[pkg.service.unit];
  }
}

function lockError(ctx: CommandContext, kind: "lists" | "dpkg"): number {
  if (kind === "lists") ctx.err("Reading package lists... Done\nE: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\nE: Unable to lock directory /var/lib/apt/lists/\nW: Problem unlinking the file /var/cache/apt/pkgcache.bin - RemoveCaches (13: Permission denied)\nW: Problem unlinking the file /var/cache/apt/srcpkgcache.bin - RemoveCaches (13: Permission denied)\n");
  else ctx.err("E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n");
  return 100;
}

function readingLists(ctx: CommandContext) {
  ctx.out("Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n");
}

function wrapList(names: string[]): string {
  const lines: string[] = [];
  let cur = " ";
  for (const n of names) {
    if (cur.length + n.length + 1 > 79) {
      lines.push(cur);
      cur = " ";
    }
    cur += " " + n;
  }
  lines.push(cur);
  return lines.join("\n") + "\n";
}

function aptLog(ctx: CommandContext, action: string, pkgs: string[]) {
  const ts = new Date(ctx.now).toISOString().replace("T", " ").slice(0, 19);
  const hist = ctx.fs.tryLookup("/var/log/apt/history.log", "/");
  const entry = `\nStart-Date: ${ts}\nCommandline: apt ${ctx.args.join(" ")}\nRequested-By: ${ctx.state.session.userStack[0].user} (${findUser(ctx.state, ctx.state.session.userStack[0].user)?.uid ?? 1000})\n${action}: ${pkgs.join(", ")}\nEnd-Date: ${ts}\n`;
  try {
    if (hist) ctx.fs.writeContent(hist, entry, true, ctx.now);
    else ctx.fs.writeFileAt("/var/log/apt/history.log", entry, { uid: 0, gid: 0, mode: 0o644, now: ctx.now });
    const dpkg = ctx.fs.tryLookup("/var/log/dpkg.log", "/");
    const lines = pkgs.map((p) => `${ts} status installed ${p}:${ARCH} ${ctx.state.packages.installed[p]?.version ?? ""}\n`).join("");
    if (dpkg) ctx.fs.writeContent(dpkg, lines, true, ctx.now);
  } catch {
    /* logs are best effort */
  }
}

function apt(ctx: CommandContext): number {
  const isGet = ctx.name === "apt-get";
  const args = ctx.args;
  const yes = args.some((a) => a === "-y" || a === "--yes" || a === "--assume-yes" || a === "-qy" || a === "-yq");
  const quiet = args.some((a) => /^-q+y?$|^-yq+$/.test(a));
  const operands = args.filter((a) => !a.startsWith("-"));
  const sub = operands[0];
  const names = operands.slice(1);
  const s = ctx.state;
  const isRoot = ctx.who.uid === 0;
  const updated = !!s.packages.lastUpdate;
  const netUp = s.network.interfaces.some((i) => i.name !== "lo" && i.up);
  const say = (t: string) => {
    if (!quiet) ctx.out(t);
  };

  if (!sub) {
    ctx.out(`apt 2.7.14 (${ARCH})\nUsage: apt [options] command\n\napt is a commandline package manager and provides commands for\nsearching and managing as well as querying information about packages.\n\nMost used commands:\n  list - list packages based on package names\n  search - search in package descriptions\n  show - show package details\n  install - install packages\n  remove - remove packages\n  autoremove - automatically remove all unused packages\n  update - update list of available packages\n  upgrade - upgrade the system by installing/upgrading packages\n  full-upgrade - upgrade the system by removing/installing/upgrading packages\n\nSee apt(8) for more information about the available commands.\n                                        This APT has Super Cow Powers.\n`);
    return 0;
  }

  switch (sub) {
    case "update": {
      if (!isRoot) return lockError(ctx, "lists");
      if (!netUp) {
        say("Ign:1 http://archive.ubuntu.com/ubuntu noble InRelease\nErr:1 http://archive.ubuntu.com/ubuntu noble InRelease\n  Temporary failure resolving 'archive.ubuntu.com'\n");
        readingLists(ctx);
        ctx.err("W: Failed to fetch http://archive.ubuntu.com/ubuntu/dists/noble/InRelease  Temporary failure resolving 'archive.ubuntu.com'\nW: Some index files failed to download. They have been ignored, or old ones used instead.\n");
        return 0;
      }
      say(
        `Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease\nGet:2 http://archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]\nGet:3 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]\nHit:4 http://archive.ubuntu.com/ubuntu noble-backports InRelease\nGet:5 http://archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages [712 kB]\nFetched 964 kB in 1s (781 kB/s)\n`,
      );
      s.packages.lastUpdate = ctx.now;
      say("Reading package lists... Done\n");
      if (!isGet) {
        say("Building dependency tree... Done\nReading state information... Done\n");
        const n = upgradable(s).length;
        say(n ? `${n} package${n > 1 ? "s" : ""} can be upgraded. Run 'apt list --upgradable' to see ${n > 1 ? "them" : "it"}.\n` : "All packages are up to date.\n");
      }
      return 0;
    }
    case "install":
    case "reinstall": {
      if (!names.length) {
        if (!isRoot) return lockError(ctx, "dpkg");
        readingLists(ctx);
        ctx.out(`0 upgraded, 0 newly installed, 0 to remove and ${upgradable(s).length} not upgraded.\n`);
        return 0;
      }
      if (!isRoot) return lockError(ctx, "dpkg");
      readingLists(ctx);
      const wanted = names.map((n) => n.replace(/=.*$/, ""));
      for (const n of wanted) {
        if (n.endsWith(".deb")) {
          ctx.err(`E: Unsupported file ${n} given on commandline\n`);
          return 100;
        }
        if (!PACKAGE_INDEX.has(n)) {
          ctx.err(`E: Unable to locate package ${n}\n`);
          return 100;
        }
      }
      const already = wanted.filter((n) => s.packages.installed[n] && sub !== "reinstall");
      for (const n of already) {
        ctx.out(`${n} is already the newest version (${s.packages.installed[n].version}).\n`);
        // a manual install marks the package as manually installed
        s.packages.installed[n].auto = false;
      }
      const { order } = resolveInstall(wanted.filter((n) => !already.includes(n)), sub === "reinstall" ? {} : s.packages.installed);
      if (!order.length) {
        ctx.out(`0 upgraded, 0 newly installed, 0 to remove and ${upgradable(s).length} not upgraded.\n`);
        return 0;
      }
      if (!netUp) {
        ctx.err(`E: Failed to fetch http://archive.ubuntu.com/ubuntu/pool/main/${order[0][0]}/${order[0]}/${order[0]}_${PACKAGE_INDEX.get(order[0])!.version}_${ARCH}.deb  Temporary failure resolving 'archive.ubuntu.com'\nE: Unable to fetch some archives, maybe run apt-get update or try with --fix-missing?\n`);
        return 100;
      }
      const extra = order.filter((n) => !wanted.includes(n));
      const pkgs = order.map((n) => PACKAGE_INDEX.get(n)!);
      if (extra.length) ctx.out("The following additional packages will be installed:\n" + wrapList(extra));
      ctx.out("The following NEW packages will be installed:\n" + wrapList(order));
      const download = pkgs.reduce((a, p) => a + p.downloadSizeKb, 0);
      const size = pkgs.reduce((a, p) => a + p.installedSizeKb, 0);
      ctx.out(`0 upgraded, ${order.length} newly installed, 0 to remove and ${upgradable(s).length} not upgraded.\nNeed to get ${fmtKb(download)} of archives.\nAfter this operation, ${fmtThousands(size)} kB of additional disk space will be used.\n`);
      if (extra.length && !yes) {
        const ans = ctx.shell.readInput("Do you want to continue? [Y/n] ", false);
        if (ans.trim() && !/^y/i.test(ans.trim())) {
          ctx.out("Abort.\n");
          return 1;
        }
      }
      pkgs.forEach((p, i) => {
        const v = availableVersion(p, updated);
        ctx.out(`Get:${i + 1} http://archive.ubuntu.com/ubuntu noble${p.newVersion && updated ? "-updates" : ""}/main ${ARCH} ${p.name} ${ARCH} ${v} [${fmtKb(p.downloadSizeKb)}]\n`);
      });
      ctx.out(`Fetched ${fmtKb(download)} in 1s (${fmtKb(download)}/s)\n`);
      let files = 74235;
      for (const p of pkgs) {
        const v = availableVersion(p, updated);
        ctx.out(`Selecting previously unselected package ${p.name}.\n(Reading database ... ${files} files and directories currently installed.)\nPreparing to unpack .../${p.name}_${v}_${ARCH}.deb ...\nUnpacking ${p.name} (${v}) ...\n`);
        files += 23;
      }
      for (const p of pkgs) {
        installPackage(s, ctx.fs, p, ctx.now, !wanted.includes(p.name), (f, src, msg) => ctx.shell.log(f, src, msg));
        ctx.out(`Setting up ${p.name} (${availableVersion(p, updated)}) ...\n`);
        if (p.service) {
          if (p.service.enableOnInstall) ctx.out(`Created symlink /etc/systemd/system/multi-user.target.wants/${p.service.unit}.service → /usr/lib/systemd/system/${p.service.unit}.service.\n`);
          if (!s.services[p.service.unit]?.active) ctx.out(`Job for ${p.service.unit}.service failed because the control process exited with error code.\nSee "systemctl status ${p.service.unit}.service" and "journalctl -xeu ${p.service.unit}.service" for details.\n`);
        }
      }
      ctx.out("Processing triggers for man-db (2.12.0-4build2) ...\n");
      syncEtcFiles(s, ctx.fs, ctx.now);
      aptLog(ctx, "Install", order);
      return 0;
    }
    case "remove":
    case "purge":
    case "autoremove": {
      if (!isRoot) return lockError(ctx, "dpkg");
      readingLists(ctx);
      const purge = sub === "purge" || args.includes("--purge");
      let targets: string[];
      if (sub === "autoremove") {
        const needed = new Set<string>();
        const visit = (n: string) => {
          if (needed.has(n)) return;
          needed.add(n);
          PACKAGE_INDEX.get(n)?.depends.forEach(visit);
        };
        Object.entries(s.packages.installed)
          .filter(([, i]) => !i.auto)
          .forEach(([n]) => visit(n));
        targets = Object.entries(s.packages.installed)
          .filter(([n, i]) => i.auto && !needed.has(n))
          .map(([n]) => n);
        if (!targets.length) {
          ctx.out(`0 upgraded, 0 newly installed, 0 to remove and ${upgradable(s).length} not upgraded.\n`);
          return 0;
        }
      } else {
        if (!names.length) {
          ctx.out(`0 upgraded, 0 newly installed, 0 to remove and ${upgradable(s).length} not upgraded.\n`);
          return 0;
        }
        for (const n of names) {
          if (!PACKAGE_INDEX.has(n)) {
            ctx.err(`E: Unable to locate package ${n}\n`);
            return 100;
          }
        }
        const notInstalled = names.filter((n) => !s.packages.installed[n]);
        for (const n of notInstalled) ctx.out(`Package '${n}' is not installed, so not removed\n`);
        targets = names.filter((n) => s.packages.installed[n]);
        const essential = targets.filter((n) => PACKAGE_INDEX.get(n)?.essential);
        if (essential.length) {
          ctx.err(`WARNING: The following essential packages will be removed.\nThis should NOT be done unless you know exactly what you are doing!\n  ${essential.join(" ")}\nE: Removing essential system-critical packages is not permitted. This might break the system.\n`);
          return 100;
        }
        if (!targets.length) {
          ctx.out(`0 upgraded, 0 newly installed, 0 to remove and ${upgradable(s).length} not upgraded.\n`);
          return 0;
        }
        // dependencies left behind
        const orphans = Object.entries(s.packages.installed)
          .filter(([n, i]) => i.auto && !targets.includes(n) && targets.some((t) => PACKAGE_INDEX.get(t)?.depends.includes(n)))
          .map(([n]) => n);
        if (orphans.length) ctx.out(`The following package${orphans.length > 1 ? "s were" : " was"} automatically installed and ${orphans.length > 1 ? "are" : "is"} no longer required:\n${wrapList(orphans)}Use 'sudo apt autoremove' to remove ${orphans.length > 1 ? "them" : "it"}.\n`);
      }
      ctx.out(`The following packages will be REMOVED:\n${wrapList(targets.map((t) => (purge ? `${t}*` : t)))}`);
      const freed = targets.reduce((a, n) => a + (PACKAGE_INDEX.get(n)?.installedSizeKb ?? 0), 0);
      ctx.out(`0 upgraded, 0 newly installed, ${targets.length} to remove and ${upgradable(s).length} not upgraded.\nAfter this operation, ${fmtThousands(freed)} kB disk space will be freed.\n`);
      if (!yes) {
        const ans = ctx.shell.readInput("Do you want to continue? [Y/n] ", false);
        if (ans.trim() && !/^y/i.test(ans.trim())) {
          ctx.out("Abort.\n");
          return 1;
        }
      }
      ctx.out(`(Reading database ... 74312 files and directories currently installed.)\n`);
      for (const n of targets) {
        const p = PACKAGE_INDEX.get(n)!;
        ctx.out(`Removing ${n} (${s.packages.installed[n].version}) ...\n`);
        removePackage(s, ctx.fs, p, purge, ctx.now);
        if (p.service) ctx.shell.log("syslog", "systemd[1]", `Stopped ${p.service.unit}.service - ${p.service.description}.`);
      }
      if (purge) for (const n of targets) ctx.out(`Purging configuration files for ${n} ...\n`);
      ctx.out("Processing triggers for man-db (2.12.0-4build2) ...\n");
      aptLog(ctx, purge ? "Purge" : "Remove", targets);
      return 0;
    }
    case "upgrade":
    case "full-upgrade":
    case "dist-upgrade": {
      if (!isRoot) return lockError(ctx, "dpkg");
      readingLists(ctx);
      ctx.out("Calculating upgrade... Done\n");
      const ups = upgradable(s);
      if (!ups.length) {
        ctx.out("0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n");
        return 0;
      }
      ctx.out(`The following packages will be upgraded:\n${wrapList(ups.map((p) => p.name))}`);
      const dl = ups.reduce((a, p) => a + p.downloadSizeKb, 0);
      ctx.out(`${ups.length} upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\nNeed to get ${fmtKb(dl)} of archives.\nAfter this operation, 12.3 kB of additional disk space will be used.\n`);
      if (!yes) {
        const ans = ctx.shell.readInput("Do you want to continue? [Y/n] ", false);
        if (ans.trim() && !/^y/i.test(ans.trim())) {
          ctx.out("Abort.\n");
          return 1;
        }
      }
      ups.forEach((p, i) => ctx.out(`Get:${i + 1} http://archive.ubuntu.com/ubuntu noble-updates/main ${ARCH} ${p.name} ${ARCH} ${p.newVersion} [${fmtKb(p.downloadSizeKb)}]\n`));
      ctx.out(`Fetched ${fmtKb(dl)} in 1s (${fmtKb(dl)}/s)\n`);
      for (const p of ups) {
        const old = s.packages.installed[p.name].version;
        ctx.out(`Preparing to unpack .../${p.name}_${p.newVersion}_${ARCH}.deb ...\nUnpacking ${p.name} (${p.newVersion}) over (${old}) ...\n`);
      }
      for (const p of ups) {
        s.packages.installed[p.name].version = p.newVersion!;
        ctx.out(`Setting up ${p.name} (${p.newVersion}) ...\n`);
      }
      ctx.out("Processing triggers for man-db (2.12.0-4build2) ...\n");
      aptLog(ctx, "Upgrade", ups.map((p) => p.name));
      return 0;
    }
    case "list": {
      const installedOnly = args.includes("--installed");
      const upgradableOnly = args.includes("--upgradable");
      if (!isGet) ctx.out("Listing... Done\n");
      const pattern = names[0] ? new RegExp("^" + names[0].replace(/\*/g, ".*") + "$") : null;
      const ups = new Set(upgradable(s).map((p) => p.name));
      for (const p of [...REPOSITORY].sort((a, b) => a.name.localeCompare(b.name))) {
        const inst = s.packages.installed[p.name];
        if (installedOnly && !inst) continue;
        if (upgradableOnly && !ups.has(p.name)) continue;
        if (pattern && !pattern.test(p.name)) continue;
        const v = availableVersion(p, updated);
        const status = inst ? (ups.has(p.name) ? `[upgradable from: ${inst.version}]` : inst.auto ? "[installed,automatic]" : "[installed]") : "";
        const shown = ctx.stdoutIsTTY ? `\x1b[32m${p.name}\x1b[0m` : p.name;
        ctx.out(`${shown}/noble-updates ${v} ${ARCH} ${status}\n`.replace(/ \n$/, "\n"));
      }
      return 0;
    }
    case "search": {
      const term = names[0];
      if (!term) {
        ctx.err("E: You must give at least one search pattern\n");
        return 100;
      }
      if (!isGet) ctx.out("Sorting... Done\nFull Text Search... Done\n");
      const re = new RegExp(term, "i");
      for (const p of REPOSITORY.filter((x) => re.test(x.name) || re.test(x.description)).sort((a, b) => a.name.localeCompare(b.name))) {
        const inst = s.packages.installed[p.name];
        const shown = ctx.stdoutIsTTY ? `\x1b[32m${p.name}\x1b[0m` : p.name;
        ctx.out(`${shown}/noble ${availableVersion(p, updated)} ${ARCH}${inst ? " [installed]" : ""}\n  ${p.description}\n\n`);
      }
      return 0;
    }
    case "show":
    case "policy": {
      const n = names[0];
      const p = n ? PACKAGE_INDEX.get(n) : undefined;
      if (!p) {
        if (n) ctx.err(`N: Unable to locate package ${n}\nE: No packages found\n`);
        return 100;
      }
      const inst = s.packages.installed[p.name];
      if (sub === "policy") {
        ctx.out(`${p.name}:\n  Installed: ${inst?.version ?? "(none)"}\n  Candidate: ${availableVersion(p, updated)}\n  Version table:\n     ${availableVersion(p, updated)} 500\n        500 http://archive.ubuntu.com/ubuntu noble-updates/main ${ARCH} Packages\n`);
        return 0;
      }
      ctx.out(`Package: ${p.name}\nVersion: ${availableVersion(p, updated)}\nPriority: optional\nSection: ${p.section}\nOrigin: Ubuntu\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nInstalled-Size: ${p.installedSizeKb} kB\n${p.depends.length ? `Depends: ${p.depends.join(", ")}\n` : ""}Download-Size: ${fmtKb(p.downloadSizeKb)}\nAPT-Manual-Installed: ${inst ? (inst.auto ? "no" : "yes") : "no"}\nAPT-Sources: http://archive.ubuntu.com/ubuntu noble/main ${ARCH} Packages\nDescription: ${p.description}\n${p.longDescription ? ` ${p.longDescription}\n` : ""}\n`);
      return 0;
    }
    default:
      ctx.err(`E: Invalid operation ${sub}\n`);
      return 100;
  }
}

function aptCache(ctx: CommandContext): number {
  const [sub, ...rest] = ctx.args;
  if (sub === "search" || sub === "show" || sub === "policy") {
    if (sub === "search") {
      const re = new RegExp(rest[0] ?? "", "i");
      for (const p of REPOSITORY.filter((x) => re.test(x.name) || re.test(x.description)).sort((a, b) => a.name.localeCompare(b.name))) ctx.out(`${p.name} - ${p.description}\n`);
      return 0;
    }
    return apt({ ...ctx, name: "apt-get", args: [sub, ...rest] });
  }
  ctx.err("E: No packages found\n");
  return 100;
}

function dpkg(ctx: CommandContext): number {
  const [flag, ...rest] = ctx.args;
  const s = ctx.state;
  switch (flag) {
    case "-l":
    case "--list": {
      const pattern = rest[0] ? new RegExp("^" + rest[0].replace(/\*/g, ".*") + "$") : null;
      const rows = Object.entries(s.packages.installed)
        .filter(([n]) => !pattern || pattern.test(n))
        .sort(([a], [b]) => a.localeCompare(b));
      if (pattern && !rows.length) {
        ctx.err(`dpkg-query: no packages found matching ${rest[0]}\n`);
        return 1;
      }
      const nameW = Math.max(14, ...rows.map(([n]) => n.length));
      const verW = Math.max(12, ...rows.map(([, i]) => i.version.length));
      ctx.out(`Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n||/ ${"Name".padEnd(nameW)} ${"Version".padEnd(verW)} Architecture Description\n+++-${"=".repeat(nameW)}-${"=".repeat(verW)}-============-${"=".repeat(40)}\n`);
      for (const [n, i] of rows) ctx.out(`ii  ${n.padEnd(nameW)} ${i.version.padEnd(verW)} ${ARCH.padEnd(12)} ${PACKAGE_INDEX.get(n)?.description ?? ""}\n`);
      return 0;
    }
    case "-s":
    case "--status": {
      const n = rest[0];
      const inst = n ? s.packages.installed[n] : undefined;
      const p = n ? PACKAGE_INDEX.get(n) : undefined;
      if (!inst || !p) {
        ctx.err(`dpkg-query: package '${n}' is not installed and no information is available\nUse dpkg --info (= dpkg-deb --info) to examine archive files.\n`);
        return 1;
      }
      ctx.out(`Package: ${n}\nStatus: install ok installed\nPriority: optional\nSection: ${p.section}\nInstalled-Size: ${p.installedSizeKb}\nArchitecture: ${ARCH}\nVersion: ${inst.version}\n${p.depends.length ? `Depends: ${p.depends.join(", ")}\n` : ""}Description: ${p.description}\n`);
      return 0;
    }
    case "-L":
    case "--listfiles": {
      const n = rest[0];
      const p = n ? PACKAGE_INDEX.get(n) : undefined;
      if (!p || !s.packages.installed[n]) {
        ctx.err(`dpkg-query: package '${n}' is not installed\n`);
        return 1;
      }
      ctx.out(`/.\n/usr\n/usr/share\n/usr/share/doc\n/usr/share/doc/${n}\n`);
      for (const b of p.binaries) ctx.out(`${p.binDir ?? "/usr/bin"}/${b}\n`);
      for (const f of p.files ?? []) ctx.out(f.path + "\n");
      return 0;
    }
    case "-S":
    case "--search": {
      const path = rest[0] ?? "";
      const owner = REPOSITORY.find((p) => s.packages.installed[p.name] && (p.binaries.some((b) => `${p.binDir ?? "/usr/bin"}/${b}` === path || b === path) || p.files?.some((f) => f.path === path)));
      if (!owner) {
        ctx.err(`dpkg-query: no path found matching pattern ${path}\n`);
        return 1;
      }
      ctx.out(`${owner.name}: ${path}\n`);
      return 0;
    }
    case "-i":
    case "--install":
      if (ctx.who.uid !== 0) {
        ctx.err("dpkg: error: requested operation requires superuser privilege\n");
        return 2;
      }
      ctx.err(`dpkg: error: cannot access archive '${rest[0] ?? ""}': No such file or directory\n`);
      return 2;
    case "--get-selections":
      for (const n of Object.keys(s.packages.installed).sort()) ctx.out(`${n.padEnd(48)}install\n`);
      return 0;
    default:
      ctx.err("dpkg: error: need an action option\n\nType dpkg --help for help about installing and deinstalling packages [*];\nUse 'apt' or 'aptitude' for user-friendly package management;\nType dpkg -Dhelp for a list of dpkg debug flag values;\nType dpkg --force-help for a list of forcing options;\nType dpkg-deb --help for help about manipulating *.deb files;\n\nOptions marked [*] produce a lot of output - pipe it through 'less' or 'more' !\n");
      return 2;
  }
}

export const packageCommands: CommandDef[] = [
  {
    name: "apt",
    category: "packages",
    description: "High-level package manager for Ubuntu (simulated repository).",
    syntax: "apt [update|upgrade|install|remove|purge|autoremove|search|show|list] [PACKAGE...]",
    options: [
      { flag: "update", description: "refresh the list of available packages" },
      { flag: "upgrade", description: "install newer versions of installed packages" },
      { flag: "install PKG", description: "install a package and its dependencies" },
      { flag: "remove PKG", description: "remove a package (keep its configuration)" },
      { flag: "purge PKG", description: "remove a package and its configuration" },
      { flag: "search WORD", description: "search package names and descriptions" },
      { flag: "-y", description: "answer yes to prompts" },
    ],
    examples: [
      { command: "sudo apt update", description: "Refresh package lists" },
      { command: "sudo apt install nginx", description: "Install the nginx web server" },
      { command: "apt search tree", description: "Find a package" },
    ],
    permissions: "Installing, removing and updating requires root (sudo).",
    run: apt,
  },
  { name: "apt-get", category: "packages", description: "APT package handling utility (classic interface).", syntax: "apt-get [update|install|remove|upgrade] [PACKAGE...]", permissions: "Requires root (sudo) for changes.", run: apt },
  { name: "apt-cache", category: "packages", description: "Query the APT package cache.", syntax: "apt-cache [search|show|policy] TERM", run: aptCache },
  {
    name: "dpkg",
    category: "packages",
    description: "Debian package manager (low level).",
    syntax: "dpkg [-l [PATTERN] | -s PKG | -L PKG | -S PATH]",
    examples: [
      { command: "dpkg -l", description: "List installed packages" },
      { command: "dpkg -l | grep nginx", description: "Is nginx installed?" },
      { command: "dpkg -L nginx", description: "Files installed by nginx" },
    ],
    run: dpkg,
  },
];
