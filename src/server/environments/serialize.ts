/**
 * Conversion between the engine's in-memory EnvState and the normalised
 * PostgreSQL rows (VirtualFile, VirtualLinuxUser, ...). Pure functions so
 * they can be unit tested without a database.
 */
import type { EnvState, FsNode, NodeType, ProcState } from "@/lib/linux-engine/types";

export const BIN_VERSION = 1;

export interface FileRow {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  type: string;
  content: string;
  target: string | null;
  ownerUid: number;
  groupGid: number;
  mode: number;
  size: number | null;
  createdAt: Date;
  modifiedAt: Date;
}

export interface UserRow {
  username: string;
  uid: number;
  gid: number;
  gecos: string;
  home: string;
  shell: string;
  passwordHash: string;
  lastChange: number;
  locked: boolean;
  position: number;
}

export interface GroupRow {
  name: string;
  gid: number;
  position: number;
}

export interface MemberRow {
  groupName: string;
  username: string;
  position: number;
}

export interface PackageRow {
  name: string;
  version: string;
  auto: boolean;
  installedAt: Date;
}

export interface ProcessRow {
  pid: number;
  ppid: number;
  user: string;
  command: string;
  args: string;
  state: string;
  nice: number;
  startedAt: Date;
  endsAt: Date | null;
  tty: string;
  cpu: number;
  mem: number;
  vsz: number;
  rss: number;
  service: string | null;
  kernel: boolean;
}

export type EnvMeta = Omit<EnvState, "nodes" | "users" | "groups" | "processes" | "packages"> & {
  lastUpdate: number | null;
  binVersion: number;
};

export interface EnvRows {
  meta: EnvMeta;
  files: FileRow[];
  users: UserRow[];
  groups: GroupRow[];
  members: MemberRow[];
  packages: PackageRow[];
  processes: ProcessRow[];
}

/** PostgreSQL text/jsonb cannot store NUL characters; replace them with the visible ␀ symbol. */
const noNul = (s: string) => (s.includes("\u0000") ? s.replace(/\u0000/g, "␀") : s);

function sanitizeMeta<T>(meta: T): T {
  const text = JSON.stringify(meta);
  return text.includes("\\u0000") ? (JSON.parse(text.replace(/\\u0000/g, "\\u2400")) as T) : meta;
}

export function toRows(state: EnvState, binVersion = BIN_VERSION): EnvRows {
  const paths = new Map<string, string>();
  const pathOf = (node: FsNode): string => {
    const cached = paths.get(node.id);
    if (cached !== undefined) return cached;
    let p: string;
    if (!node.parentId) p = "/";
    else {
      const parent = state.nodes[node.parentId];
      const pp = parent ? pathOf(parent) : "/";
      p = pp === "/" ? `/${node.name}` : `${pp}/${node.name}`;
    }
    paths.set(node.id, p);
    return p;
  };
  const files: FileRow[] = Object.values(state.nodes).map((n) => ({
    id: n.id,
    parentId: n.parentId,
    name: n.name,
    path: pathOf(n),
    type: n.type,
    content: noNul(n.content),
    target: n.target !== undefined ? noNul(n.target) : null,
    ownerUid: n.uid,
    groupGid: n.gid,
    mode: n.mode,
    size: n.size ?? null,
    createdAt: new Date(n.ctime),
    modifiedAt: new Date(n.mtime),
  }));
  const { nodes: _n, users, groups, processes, packages, ...rest } = state;
  void _n;
  return {
    meta: sanitizeMeta({ ...rest, lastUpdate: packages.lastUpdate, binVersion }),
    files,
    users: users.map((u, i) => ({ ...u, position: i })),
    groups: groups.map((g, i) => ({ name: g.name, gid: g.gid, position: i })),
    members: groups.flatMap((g) => g.members.map((m, i) => ({ groupName: g.name, username: m, position: i }))),
    packages: Object.entries(packages.installed).map(([name, p]) => ({ name, version: p.version, auto: p.auto, installedAt: new Date(p.installedAt) })),
    processes: processes.map((p) => ({
      pid: p.pid,
      ppid: p.ppid,
      user: p.user,
      command: p.command,
      args: p.args,
      state: p.state,
      nice: p.nice,
      startedAt: new Date(p.startedAt),
      endsAt: p.endsAt ? new Date(p.endsAt) : null,
      tty: p.tty,
      cpu: p.cpu,
      mem: p.mem,
      vsz: p.vsz,
      rss: p.rss,
      service: p.service ?? null,
      kernel: !!p.kernel,
    })),
  };
}

export function fromRows(rows: EnvRows): EnvState {
  const { lastUpdate, binVersion: _b, ...meta } = rows.meta;
  void _b;
  const nodes: Record<string, FsNode> = {};
  for (const f of rows.files) {
    const node: FsNode = {
      id: f.id,
      parentId: f.parentId,
      name: f.name,
      type: f.type as NodeType,
      content: f.content,
      uid: f.ownerUid,
      gid: f.groupGid,
      mode: f.mode,
      ctime: f.createdAt.getTime(),
      mtime: f.modifiedAt.getTime(),
    };
    if (f.target !== null) node.target = f.target;
    if (f.size !== null) node.size = f.size;
    nodes[f.id] = node;
  }
  const members = new Map<string, MemberRow[]>();
  for (const m of rows.members) {
    const list = members.get(m.groupName) ?? [];
    list.push(m);
    members.set(m.groupName, list);
  }
  return {
    ...(meta as Omit<EnvMeta, "lastUpdate" | "binVersion">),
    nodes,
    users: [...rows.users].sort((a, b) => a.position - b.position).map(({ position: _p, ...u }) => (void _p, u)),
    groups: [...rows.groups]
      .sort((a, b) => a.position - b.position)
      .map((g) => ({ name: g.name, gid: g.gid, members: (members.get(g.name) ?? []).sort((a, b) => a.position - b.position).map((m) => m.username) })),
    packages: {
      installed: Object.fromEntries(rows.packages.map((p) => [p.name, { version: p.version, auto: p.auto, installedAt: p.installedAt.getTime() }])),
      lastUpdate,
    },
    processes: rows.processes.map((p) => ({
      pid: p.pid,
      ppid: p.ppid,
      user: p.user,
      command: p.command,
      args: p.args,
      state: p.state as ProcState,
      nice: p.nice,
      startedAt: p.startedAt.getTime(),
      endsAt: p.endsAt ? p.endsAt.getTime() : null,
      tty: p.tty,
      cpu: p.cpu,
      mem: p.mem,
      vsz: p.vsz,
      rss: p.rss,
      ...(p.service ? { service: p.service } : {}),
      ...(p.kernel ? { kernel: true } : {}),
    })),
  };
}

export interface EnvDiff {
  metaChanged: boolean;
  fileUpserts: FileRow[];
  fileDeletes: string[];
  usersChanged: boolean;
  groupsChanged: boolean;
  packagesChanged: boolean;
  processesChanged: boolean;
  empty: boolean;
}

const fileKey = (f: FileRow) => JSON.stringify([f.parentId, f.name, f.path, f.type, f.content, f.target, f.ownerUid, f.groupGid, f.mode, f.size, f.createdAt.getTime(), f.modifiedAt.getTime()]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffRows(before: EnvRows | null, after: EnvRows): EnvDiff {
  if (!before) {
    return { metaChanged: true, fileUpserts: after.files, fileDeletes: [], usersChanged: true, groupsChanged: true, packagesChanged: true, processesChanged: true, empty: false };
  }
  const prev = new Map(before.files.map((f) => [f.id, fileKey(f)]));
  const fileUpserts = after.files.filter((f) => prev.get(f.id) !== fileKey(f));
  const nextIds = new Set(after.files.map((f) => f.id));
  const fileDeletes = before.files.filter((f) => !nextIds.has(f.id)).map((f) => f.id);
  const d: EnvDiff = {
    metaChanged: !same(before.meta, after.meta),
    fileUpserts,
    fileDeletes,
    usersChanged: !same(before.users, after.users),
    groupsChanged: !same(before.groups, after.groups) || !same(before.members, after.members),
    packagesChanged: !same(before.packages, after.packages),
    processesChanged: !same(before.processes, after.processes),
    empty: false,
  };
  d.empty = !d.metaChanged && !fileUpserts.length && !fileDeletes.length && !d.usersChanged && !d.groupsChanged && !d.packagesChanged && !d.processesChanged;
  return d;
}
