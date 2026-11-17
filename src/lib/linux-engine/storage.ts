import type { VirtualFileSystem } from "./filesystem";
import type { Disk, EnvState } from "./types";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

export function defaultDisks(): Disk[] {
  return [
    { name: "sda", type: "disk", size: 25 * GiB, model: "VBOX HARDDISK" },
    { name: "sda1", type: "part", parent: "sda", size: 1 * GiB, fstype: "vfat", uuid: "5A1C-3F2E", mountpoint: "/boot/efi", baseUsed: 6.1 * MiB, label: "" },
    { name: "sda2", type: "part", parent: "sda", size: 24 * GiB - MiB, fstype: "ext4", uuid: "8f0e2c41-7a3b-4c55-9d2e-1b6f0a9c3d71", mountpoint: "/", baseUsed: 6.4 * GiB, label: "" },
    { name: "sdb", type: "disk", size: 10 * GiB, model: "VBOX HARDDISK" },
    { name: "sr0", type: "disk", size: 1073741312, model: "VBOX CD-ROM" },
  ];
}

export interface MountEntry {
  source: string;
  fstype: string;
  size: number;
  used: number;
  target: string;
  options: string;
}

/** Bytes used by files located under `mountpoint` (excluding nested mounts). */
export function usedUnder(fs: VirtualFileSystem, mountpoint: string, otherMounts: string[]): number {
  const node = fs.tryLookup(mountpoint, "/");
  if (!node) return 0;
  let total = 0;
  fs.walk(node, (n, path) => {
    if (path !== mountpoint && otherMounts.includes(path)) return false;
    if (n.type === "file") total += fs.sizeOf(n);
    else if (n.type === "dir") total += 4096;
  });
  return total;
}

export function mountTable(state: EnvState, fs: VirtualFileSystem): MountEntry[] {
  const mountedDisks = state.disks.filter((d) => d.mountpoint);
  const mps = mountedDisks.map((d) => d.mountpoint!);
  const entries: MountEntry[] = [];
  entries.push({ source: "tmpfs", fstype: "tmpfs", size: 392 * MiB, used: 1.2 * MiB, target: "/run", options: "rw,nosuid,nodev,noexec,relatime,size=401328k,mode=755" });
  for (const d of mountedDisks) {
    const files = d.mountpoint === "/" ? fs.totalSize() - mps.filter((m) => m !== "/").reduce((s, m) => s + usedUnder(fs, m, []), 0) : usedUnder(fs, d.mountpoint!, mps);
    entries.push({
      source: `/dev/${d.name}`,
      fstype: d.fstype ?? "ext4",
      size: d.size,
      used: Math.min(d.size, (d.baseUsed ?? 0) + Math.max(0, files)),
      target: d.mountpoint!,
      options: d.fstype === "vfat" ? "rw,relatime,fmask=0077,dmask=0077,codepage=437,iocharset=iso8859-1" : "rw,relatime",
    });
  }
  entries.push({ source: "tmpfs", fstype: "tmpfs", size: 1.9 * GiB, used: 0, target: "/dev/shm", options: "rw,nosuid,nodev" });
  entries.push({ source: "tmpfs", fstype: "tmpfs", size: 5 * MiB, used: 8 * 1024, target: "/run/lock", options: "rw,nosuid,nodev,noexec,relatime,size=5120k" });
  entries.push({ source: "tmpfs", fstype: "tmpfs", size: 392 * MiB, used: 12 * 1024, target: "/run/user/1000", options: "rw,nosuid,nodev,relatime,size=401324k,nr_inodes=100331,mode=700,uid=1000,gid=1000" });
  // keep / first after /run like real df
  return entries.sort((a, b) => order(a.target) - order(b.target));
}

function order(target: string): number {
  const o = ["/run", "/", "/dev/shm", "/run/lock", "/boot/efi", "/run/user/1000"];
  const i = o.indexOf(target);
  return i === -1 ? 3.5 : i;
}

export function findDisk(state: EnvState, dev: string): Disk | undefined {
  const name = dev.replace(/^\/dev\//, "");
  return state.disks.find((d) => d.name === name);
}

export function randomUuid(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hex = (n: number, len: number) => {
    let s = "";
    for (let i = 0; i < len; i++) {
      h = (h * 1103515245 + 12345 + n) >>> 0;
      s += (h % 16).toString(16);
    }
    return s;
  };
  return `${hex(1, 8)}-${hex(2, 4)}-4${hex(3, 3)}-a${hex(4, 3)}-${hex(5, 12)}`;
}
