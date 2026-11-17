import { canAccess, R, X } from "../permissions";
import { memoryStats } from "../processes";
import { findDisk, mountTable, randomUuid } from "../storage";
import type { FsNode } from "../types";
import { humanSize } from "../util";
import { errMsg, withOpts } from "./helpers";
import type { CommandContext, CommandDef } from "./types";

const fmtSize = (bytes: number, human: boolean, si = false) => (human ? humanSize(bytes, { si }) : String(Math.ceil(bytes / 1024)));

function df(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "hHTaik", withValue: "t", long: { "human-readable": "h", si: "H", "print-type": "T", all: "a", inodes: "i", "type=": "t" } }, (o) => {
    const human = o.flags.has("h") || o.flags.has("H");
    let entries = mountTable(ctx.state, ctx.fs);
    if (o.values.t) entries = entries.filter((e) => e.fstype === o.values.t);
    if (o.operands.length) {
      const wanted: typeof entries = [];
      for (const p of o.operands) {
        const node = ctx.fs.tryLookup(p, ctx.cwd, ctx.who);
        if (!node) {
          ctx.err(`df: ${p}: No such file or directory\n`);
          continue;
        }
        const abs = ctx.fs.pathOf(node);
        const best = entries.filter((e) => abs === e.target || abs.startsWith(e.target === "/" ? "/" : e.target + "/")).sort((a, b) => b.target.length - a.target.length)[0];
        if (best && !wanted.includes(best)) wanted.push(best);
      }
      entries = wanted;
    }
    const rows: string[][] = [["Filesystem", ...(o.flags.has("T") ? ["Type"] : []), human ? "Size" : "1K-blocks", "Used", human ? "Avail" : "Available", "Use%", "Mounted on"]];
    for (const e of entries) {
      const avail = Math.max(0, e.size - e.used - (e.fstype === "ext4" ? e.size * 0.05 : 0));
      const pct = e.size ? Math.ceil((e.used / (e.used + avail || 1)) * 100) : 0;
      rows.push([e.source, ...(o.flags.has("T") ? [e.fstype] : []), fmtSize(e.size, human, o.flags.has("H")), fmtSize(e.used, human, o.flags.has("H")), fmtSize(avail, human, o.flags.has("H")), `${pct}%`, e.target]);
    }
    const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
    const typeOffset = o.flags.has("T") ? 1 : 0;
    for (const r of rows) {
      ctx.out(
        r
          .map((c, i) => {
            if (i === r.length - 1) return c;
            const rightAlign = i >= 1 + typeOffset && i <= 4 + typeOffset;
            return rightAlign ? c.padStart(widths[i]) : c.padEnd(widths[i]);
          })
          .join(" ") + "\n",
      );
    }
    return 0;
  });
}

function du(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "shacbkmx", withValue: "d", long: { summarize: "s", "human-readable": "h", all: "a", total: "c", "max-depth=": "d", "apparent-size": "apparent" } }, (o) => {
    const human = o.flags.has("h");
    const maxDepth = o.flags.has("s") ? 0 : o.values.d !== undefined ? Number(o.values.d) : Infinity;
    const fmt = (kb: number) => (human ? (kb === 0 ? "0" : humanSize(kb * 1024)) : o.flags.has("m") ? String(Math.ceil(kb / 1024)) : String(kb));
    let total = 0;
    let status = 0;
    const blocks = (n: FsNode) => (n.type === "dir" ? 4 : n.type === "file" ? Math.ceil(ctx.fs.sizeOf(n) / 4096) * 4 : 0);
    const visit = (n: FsNode, label: string, depth: number): number => {
      if (n.type !== "dir") {
        const b = blocks(n);
        if ((o.flags.has("a") || depth === 0) && depth <= maxDepth) ctx.out(`${fmt(b)}\t${label}\n`);
        return b;
      }
      let sum = 4;
      if (!canAccess(n, ctx.who, R | X)) {
        ctx.err(`du: cannot read directory '${label}': Permission denied\n`);
        status = 1;
      } else {
        for (const k of ctx.fs.list(n).sort((a, b) => a.name.localeCompare(b.name))) {
          if (k.type === "symlink") continue;
          sum += visit(k, label === "/" ? `/${k.name}` : `${label}/${k.name}`, depth + 1);
        }
      }
      if (depth <= maxDepth) ctx.out(`${fmt(sum)}\t${label}\n`);
      return sum;
    };
    for (const p of o.operands.length ? o.operands : ["."]) {
      try {
        const node = ctx.fs.lookup(p, ctx.cwd, ctx.who);
        total += visit(node, p.length > 1 ? p.replace(/\/+$/, "") : p, 0);
      } catch (e) {
        ctx.err(`du: cannot access '${p}': ${errMsg(e)}\n`);
        status = 1;
      }
    }
    if (o.flags.has("c")) ctx.out(`${fmt(total)}\ttotal\n`);
    return status;
  });
}

function free(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "hmgbkwt", long: { human: "h", mega: "m", giga: "g", total: "t" } }, (o) => {
    const m = memoryStats(ctx.state, ctx.now);
    const unit = (kb: number) => {
      if (o.flags.has("h")) {
        const b = kb * 1024;
        if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)}Gi`;
        if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)}Mi`;
        return `${Math.round(b / 1024)}Ki`;
      }
      if (o.flags.has("m")) return String(Math.floor(kb / 1024));
      if (o.flags.has("g")) return String(Math.floor(kb / 1024 / 1024));
      return String(kb);
    };
    const w = o.flags.has("h") ? 11 : 12;
    const row = (label: string, vals: string[]) => label.padEnd(7) + vals.map((v) => v.padStart(w)).join("") + "\n";
    ctx.out(" ".repeat(7) + ["total", "used", "free", "shared", "buff/cache", "available"].map((h) => h.padStart(w)).join("") + "\n");
    ctx.out(row("Mem:", [m.total, m.used, m.free, m.shared, m.buffCache, m.available].map(unit)));
    ctx.out(row("Swap:", [m.swapTotal, m.swapUsed, m.swapFree].map(unit)));
    if (o.flags.has("t")) ctx.out(row("Total:", [m.total + m.swapTotal, m.used, m.free + m.swapFree].map(unit)));
    return 0;
  });
}

function lsblk(ctx: CommandContext): number {
  const showFs = ctx.args.includes("-f") || ctx.args.includes("--fs");
  const disks = ctx.state.disks;
  const top = disks.filter((d) => d.type === "disk");
  const sizeStr = (b: number) => {
    const g = b / 1024 ** 3;
    if (g >= 1) return `${Number.isInteger(g) ? g : g.toFixed(1)}G`;
    return `${Math.round(b / 1024 ** 2)}M`;
  };
  if (showFs) {
    ctx.out("NAME   FSTYPE FSVER LABEL UUID                                 FSAVAIL FSUSE% MOUNTPOINTS\n");
    for (const d of top) {
      ctx.out(`${d.name.padEnd(6)} ${(d.fstype ?? "").padEnd(6)} ${d.fstype === "ext4" ? "1.0  " : "     "} ${"".padEnd(5)} ${(d.uuid ?? "").padEnd(36)} ${"".padEnd(7)} ${"".padEnd(6)} ${d.mountpoint ?? ""}\n`);
      const parts = disks.filter((p) => p.parent === d.name);
      parts.forEach((p, i) => {
        const prefix = i === parts.length - 1 ? "└─" : "├─";
        ctx.out(`${(prefix + p.name).padEnd(6)} ${(p.fstype ?? "").padEnd(6)} ${p.fstype === "ext4" ? "1.0  " : p.fstype === "vfat" ? "FAT32" : "     "} ${"".padEnd(5)} ${(p.uuid ?? "").padEnd(36)} ${(p.mountpoint ? sizeStr(p.size * 0.6) : "").padEnd(7)} ${(p.mountpoint ? "27%" : "").padEnd(6)} ${p.mountpoint ?? ""}\n`);
      });
    }
    return 0;
  }
  ctx.out("NAME   MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\n");
  const majmin: Record<string, string> = { sda: "8:0", sda1: "8:1", sda2: "8:2", sdb: "8:16", sdb1: "8:17", sdb2: "8:18", sr0: "11:0" };
  for (const d of top) {
    const rm = d.name === "sr0" ? "1" : "0";
    ctx.out(`${d.name.padEnd(6)} ${(majmin[d.name] ?? "8:32").padStart(7)} ${rm.padStart(2)} ${sizeStr(d.size).padStart(5)}  0 ${d.name === "sr0" ? "rom " : "disk"} ${d.mountpoint ?? ""}\n`);
    const parts = disks.filter((p) => p.parent === d.name);
    parts.forEach((p, i) => {
      const prefix = i === parts.length - 1 ? "└─" : "├─";
      ctx.out(`${(prefix + p.name).padEnd(6)} ${(majmin[p.name] ?? "8:33").padStart(7)}  0 ${sizeStr(p.size).padStart(5)}  0 part ${p.mountpoint ?? ""}\n`);
    });
  }
  return 0;
}

function mount(ctx: CommandContext): number {
  const ops = ctx.args.filter((a) => !a.startsWith("-"));
  const tIdx = ctx.args.indexOf("-t");
  const fsType = tIdx !== -1 ? ctx.args[tIdx + 1] : undefined;
  const operands = ops.filter((a) => a !== fsType);
  if (!operands.length) {
    for (const e of mountTable(ctx.state, ctx.fs)) ctx.out(`${e.source} on ${e.target} type ${e.fstype} (${e.options})\n`);
    ctx.out("proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)\nsysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)\n");
    return 0;
  }
  if (ctx.who.uid !== 0) {
    ctx.err("mount: only root can do that\n");
    return 1;
  }
  const [dev, target] = operands;
  if (!target) {
    ctx.err(`mount: ${dev}: can't find in /etc/fstab.\n`);
    return 1;
  }
  const disk = findDisk(ctx.state, dev);
  if (!disk) {
    ctx.err(`mount: ${target}: special device ${dev} does not exist.\n`);
    return 32;
  }
  const dir = ctx.fs.tryLookup(target, ctx.cwd, ctx.who);
  if (!dir) {
    ctx.err(`mount: ${target}: mount point does not exist.\n`);
    return 32;
  }
  if (dir.type !== "dir") {
    ctx.err(`mount: ${target}: mount point is not a directory.\n`);
    return 32;
  }
  if (!disk.fstype) {
    ctx.err(`mount: ${target}: wrong fs type, bad option, bad superblock on ${dev}, missing codepage or helper program, or other error.\n       dmesg(1) may have more information after failed mount system call.\n`);
    return 32;
  }
  if (disk.type === "disk" && ctx.state.disks.some((p) => p.parent === disk.name)) {
    ctx.err(`mount: ${target}: wrong fs type, bad option, bad superblock on ${dev}, missing codepage or helper program, or other error.\n`);
    return 32;
  }
  const abs = ctx.fs.pathOf(dir);
  if (disk.mountpoint) {
    ctx.err(`mount: ${abs}: ${dev} already mounted on ${disk.mountpoint}.\n`);
    return 32;
  }
  if (ctx.state.disks.some((d) => d.mountpoint === abs)) {
    ctx.err(`mount: ${abs}: target is busy.\n`);
    return 32;
  }
  disk.mountpoint = abs;
  disk.baseUsed = disk.baseUsed ?? 24 * 1024 * 1024;
  ctx.shell.log("syslog", "kernel", `EXT4-fs (${disk.name}): mounted filesystem ${disk.uuid} r/w with ordered data mode. Quota mode: none.`);
  return 0;
}

function umount(ctx: CommandContext): number {
  const target = ctx.args.find((a) => !a.startsWith("-"));
  if (!target) {
    ctx.err("Usage:\n umount [-hV]\n umount -a [options]\n umount [options] <source> | <directory>\n");
    return 1;
  }
  if (ctx.who.uid !== 0) {
    ctx.err(`umount: ${target}: must be superuser to unmount.\n`);
    return 32;
  }
  const node = ctx.fs.tryLookup(target, ctx.cwd);
  const abs = node ? ctx.fs.pathOf(node) : target;
  const disk = ctx.state.disks.find((d) => d.mountpoint === abs || `/dev/${d.name}` === target);
  if (!disk || !disk.mountpoint) {
    ctx.err(`umount: ${target}: not mounted.\n`);
    return 32;
  }
  if (disk.mountpoint === "/" || disk.mountpoint === "/boot/efi") {
    ctx.err(`umount: ${disk.mountpoint}: target is busy.\n`);
    return 32;
  }
  if (ctx.cwd === disk.mountpoint || ctx.cwd.startsWith(disk.mountpoint + "/")) {
    ctx.err(`umount: ${disk.mountpoint}: target is busy.\n`);
    return 32;
  }
  delete disk.mountpoint;
  return 0;
}

function mkfs(ctx: CommandContext): number {
  const dev = ctx.args.find((a) => a.startsWith("/dev/"));
  const type = ctx.name.includes(".") ? ctx.name.split(".")[1] : (ctx.args[ctx.args.indexOf("-t") + 1] ?? "ext2");
  if (!dev) {
    ctx.err(`Usage: ${ctx.name} [-c|-l filename] [-b block-size] [-C cluster-size]\n\t[-i bytes-per-inode] [-I inode-size] [-J journal-options]\n\t[-L volume-label] [-m reserved-blocks-percentage] device [fs-size]\n`);
    return 1;
  }
  if (ctx.who.uid !== 0) {
    ctx.err(`${ctx.name}: Permission denied while trying to determine filesystem size\n`);
    return 1;
  }
  const disk = findDisk(ctx.state, dev);
  if (!disk) {
    ctx.err(`The file ${dev} does not exist and no size was specified.\n`);
    return 1;
  }
  if (disk.mountpoint) {
    ctx.err(`${ctx.name}: ${dev} contains a ${disk.fstype} file system\n\tis mounted on ${disk.mountpoint}; will not make a filesystem here!\n`);
    return 1;
  }
  if (disk.name === "sda" || disk.parent === "sda") {
    ctx.err(`${ctx.name}: ${dev} is apparently in use by the system; will not make a filesystem here!\n`);
    return 1;
  }
  const blocks = Math.floor(disk.size / 4096);
  disk.fstype = type;
  disk.uuid = randomUuid(dev + ctx.now);
  disk.baseUsed = 24 * 1024 * 1024;
  ctx.out(`mke2fs 1.47.0 (5-Feb-2023)\nCreating filesystem with ${blocks} 4k blocks and ${Math.floor(blocks / 4)} inodes\nFilesystem UUID: ${disk.uuid}\nSuperblock backups stored on blocks: \n\t32768, 98304, 163840, 229376, 294912, 819200, 884736, 1605632\n\nAllocating group tables: done                            \nWriting inode tables: done                            \nCreating journal (16384 blocks): done\nWriting superblocks and filesystem accounting information: done   \n\n`);
  return 0;
}

function fdisk(ctx: CommandContext): number {
  if (!ctx.args.includes("-l")) {
    ctx.err("fdisk: interactive partitioning is not available in Linux Playground. Use 'sudo fdisk -l' to list partitions, or 'sudo mkfs.ext4 /dev/sdb' to format the spare disk.\n");
    return 1;
  }
  if (ctx.who.uid !== 0) {
    ctx.err("fdisk: cannot open /dev/sda: Permission denied\n");
    return 1;
  }
  for (const d of ctx.state.disks.filter((x) => x.type === "disk" && x.name !== "sr0")) {
    const sectors = Math.floor(d.size / 512);
    ctx.out(`Disk /dev/${d.name}: ${(d.size / 1024 ** 3).toFixed(0)} GiB, ${d.size} bytes, ${sectors} sectors\nDisk model: ${d.model ?? "VBOX HARDDISK"}\nUnits: sectors of 1 * 512 = 512 bytes\nSector size (logical/physical): 512 bytes / 512 bytes\nI/O size (minimum/optimal): 512 bytes / 512 bytes\n`);
    const parts = ctx.state.disks.filter((p) => p.parent === d.name);
    if (parts.length) {
      ctx.out(`Disklabel type: gpt\nDisk identifier: 2B4C1E8A-91F2-4C3D-A1B2-7E6F5D4C3B2A\n\nDevice       Start      End  Sectors Size Type\n`);
      let start = 2048;
      for (const p of parts) {
        const sec = Math.floor(p.size / 512);
        ctx.out(`/dev/${p.name.padEnd(7)} ${String(start).padStart(7)} ${String(start + sec - 1).padStart(8)} ${String(sec).padStart(8)} ${(p.size / 1024 ** 3 >= 1 ? `${Math.round(p.size / 1024 ** 3)}G` : `${Math.round(p.size / 1024 ** 2)}M`).padStart(4)} ${p.fstype === "vfat" ? "EFI System" : "Linux filesystem"}\n`);
        start += sec;
      }
    }
    ctx.out("\n\n");
  }
  return 0;
}

function blkid(ctx: CommandContext): number {
  if (ctx.who.uid !== 0) return 2;
  for (const d of ctx.state.disks.filter((x) => x.fstype)) {
    ctx.out(`/dev/${d.name}: UUID="${d.uuid}" BLOCK_SIZE="4096" TYPE="${d.fstype}"${d.type === "part" ? ` PARTUUID="${(d.uuid ?? "").slice(0, 8)}-01"` : ""}\n`);
  }
  return 0;
}

export const storageCommands: CommandDef[] = [
  {
    name: "df",
    category: "storage",
    description: "Report file system disk space usage.",
    syntax: "df [-h] [-T] [FILE]...",
    options: [
      { flag: "-h", description: "human readable sizes (K, M, G)" },
      { flag: "-T", description: "print file system type" },
    ],
    examples: [{ command: "df -h", description: "How full are my disks?" }],
    run: df,
  },
  {
    name: "du",
    category: "storage",
    description: "Estimate file space usage.",
    syntax: "du [-sh] [-d N] [PATH]...",
    options: [
      { flag: "-s", description: "only a total for each argument" },
      { flag: "-h", description: "human readable sizes" },
      { flag: "-d N", description: "limit depth" },
    ],
    examples: [
      { command: "du -sh ~", description: "Size of your home directory" },
      { command: "du -h -d 1 /var", description: "Size of each folder in /var" },
    ],
    run: du,
  },
  { name: "free", category: "storage", description: "Display amount of free and used memory.", syntax: "free [-h] [-m]", examples: [{ command: "free -h", description: "Memory usage in human-readable units" }], run: free },
  { name: "lsblk", category: "storage", description: "List block devices (disks and partitions).", syntax: "lsblk [-f]", examples: [{ command: "lsblk", description: "Disks and partitions" }, { command: "lsblk -f", description: "Including file system types and UUIDs" }], run: lsblk },
  {
    name: "mount",
    category: "storage",
    description: "Mount a file system / list mounts.",
    syntax: "mount | sudo mount DEVICE DIR",
    examples: [
      { command: "mount", description: "List mounted file systems" },
      { command: "sudo mount /dev/sdb /mnt/data", description: "Mount the spare disk (format it first)" },
    ],
    permissions: "Mounting requires root.",
    run: mount,
  },
  { name: "umount", category: "storage", description: "Unmount file systems.", syntax: "sudo umount DIR|DEVICE", permissions: "Requires root.", run: umount },
  { name: "mkfs.ext4", aliases: ["mkfs"], binDir: "/usr/sbin", category: "storage", description: "Create an ext4 file system on a device.", syntax: "sudo mkfs.ext4 DEVICE", examples: [{ command: "sudo mkfs.ext4 /dev/sdb", description: "Format the spare 10G disk" }], permissions: "Requires root.", run: mkfs },
  { name: "fdisk", binDir: "/usr/sbin", category: "storage", description: "Manipulate disk partition tables (listing only in the simulator).", syntax: "sudo fdisk -l", permissions: "Requires root.", run: fdisk },
  { name: "blkid", binDir: "/usr/sbin", category: "storage", description: "Locate/print block device attributes.", syntax: "sudo blkid", run: blkid },
];
