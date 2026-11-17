import type { VirtualFileSystem } from "./filesystem";
import type { Identity } from "./permissions";
import type { EnvState, LinuxGroup, LinuxUser } from "./types";

export const NAME_RE = /^[a-z_][a-z0-9_-]*\$?$/;
export const MAX_NAME = 32;

export class UserError extends Error {
  constructor(
    message: string,
    public exitCode = 1,
  ) {
    super(message);
  }
}

export function findUser(state: EnvState, nameOrUid: string | number): LinuxUser | undefined {
  if (typeof nameOrUid === "number") return state.users.find((u) => u.uid === nameOrUid);
  const byName = state.users.find((u) => u.username === nameOrUid);
  if (byName) return byName;
  if (/^\d+$/.test(nameOrUid)) return state.users.find((u) => u.uid === Number(nameOrUid));
  return undefined;
}

export function findGroup(state: EnvState, nameOrGid: string | number): LinuxGroup | undefined {
  if (typeof nameOrGid === "number") return state.groups.find((g) => g.gid === nameOrGid);
  const byName = state.groups.find((g) => g.name === nameOrGid);
  if (byName) return byName;
  if (/^\d+$/.test(nameOrGid)) return state.groups.find((g) => g.gid === Number(nameOrGid));
  return undefined;
}

export function userName(state: EnvState, uid: number): string {
  return findUser(state, uid)?.username ?? String(uid);
}

export function groupName(state: EnvState, gid: number): string {
  return findGroup(state, gid)?.name ?? String(gid);
}

/** Primary group followed by supplementary groups. */
export function groupsOf(state: EnvState, username: string): LinuxGroup[] {
  const user = findUser(state, username);
  if (!user) return [];
  const primary = findGroup(state, user.gid);
  const supplementary = state.groups.filter((g) => g.members.includes(username) && g.gid !== user.gid);
  return primary ? [primary, ...supplementary] : supplementary;
}

export function identityFor(state: EnvState, username: string): Identity {
  const user = findUser(state, username);
  if (!user) return { uid: 65534, gid: 65534, groups: [65534], username: "nobody" };
  return { uid: user.uid, gid: user.gid, groups: groupsOf(state, username).map((g) => g.gid), username: user.username };
}

export function validateName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME && NAME_RE.test(name);
}

function nextId(used: number[], min: number, max: number): number {
  const set = new Set(used);
  for (let i = min; i <= max; i++) if (!set.has(i)) return i;
  throw new UserError("no more free IDs", 4);
}

export function nextUid(state: EnvState, system = false): number {
  return system
    ? nextId(state.users.map((u) => u.uid), 100, 999)
    : nextId(state.users.map((u) => u.uid), 1000, 59999);
}

export function nextGid(state: EnvState, system = false): number {
  return system
    ? nextId(state.groups.map((g) => g.gid), 100, 999)
    : nextId(state.groups.map((g) => g.gid), 1000, 59999);
}

const daysSinceEpoch = (now: number) => Math.floor(now / 86400000);

export interface AddUserOptions {
  username: string;
  uid?: number;
  /** Primary group name or gid. When omitted a user-private group is created. */
  group?: string;
  groups?: string[];
  home?: string;
  createHome: boolean;
  shell?: string;
  gecos?: string;
  system?: boolean;
  passwordHash?: string;
  now: number;
}

export function addGroup(state: EnvState, name: string, opts: { gid?: number; system?: boolean } = {}): LinuxGroup {
  if (!validateName(name)) throw new UserError(`'${name}' is not a valid group name`, 3);
  if (findGroup(state, name) && !/^\d+$/.test(name)) throw new UserError(`group '${name}' already exists`, 9);
  const gid = opts.gid ?? nextGid(state, opts.system);
  if (state.groups.some((g) => g.gid === gid)) throw new UserError(`GID '${gid}' already exists`, 4);
  const group: LinuxGroup = { name, gid, members: [] };
  state.groups.push(group);
  return group;
}

export function deleteGroup(state: EnvState, name: string) {
  const group = state.groups.find((g) => g.name === name);
  if (!group) throw new UserError(`group '${name}' does not exist`, 6);
  const primaryOf = state.users.find((u) => u.gid === group.gid);
  if (primaryOf) throw new UserError(`cannot remove the primary group of user '${primaryOf.username}'`, 8);
  state.groups = state.groups.filter((g) => g !== group);
}

export function addUser(state: EnvState, fs: VirtualFileSystem, opts: AddUserOptions): { user: LinuxUser; homeCreated: boolean; homeExisted: boolean } {
  const { username } = opts;
  if (!validateName(username)) throw new UserError(`invalid user name '${username}'`, 3);
  if (findUser(state, username) && state.users.some((u) => u.username === username)) {
    throw new UserError(`user '${username}' already exists`, 9);
  }
  const uid = opts.uid ?? nextUid(state, opts.system);
  if (state.users.some((u) => u.uid === uid)) throw new UserError(`UID ${uid} is not unique`, 4);

  let gid: number;
  if (opts.group) {
    const g = findGroup(state, opts.group);
    if (!g) throw new UserError(`group '${opts.group}' does not exist`, 6);
    gid = g.gid;
  } else {
    if (state.groups.some((g) => g.name === username)) {
      throw new UserError(`group ${username} exists - if you want to add this user to that group, use -g.`, 9);
    }
    const preferred = state.groups.some((g) => g.gid === uid) ? undefined : uid;
    gid = addGroup(state, username, { gid: preferred, system: opts.system }).gid;
  }
  for (const sg of opts.groups ?? []) {
    if (!findGroup(state, sg)) throw new UserError(`group '${sg}' does not exist`, 6);
  }

  const home = opts.home ?? `/home/${username}`;
  const user: LinuxUser = {
    username,
    uid,
    gid,
    gecos: opts.gecos ?? "",
    home,
    shell: opts.shell ?? "/bin/sh",
    passwordHash: opts.passwordHash ?? "!",
    lastChange: daysSinceEpoch(opts.now),
    locked: false,
  };
  state.users.push(user);
  for (const sg of opts.groups ?? []) {
    const g = findGroup(state, sg)!;
    if (!g.members.includes(username)) g.members.push(username);
  }

  let homeCreated = false;
  let homeExisted = false;
  if (opts.createHome) {
    const existing = fs.tryLookup(home, "/");
    if (existing) {
      homeExisted = true;
    } else {
      const dir = fs.mkdirp(home, { uid: 0, gid: 0 }, 0o755, opts.now);
      dir.uid = uid;
      dir.gid = gid;
      dir.mode = 0o750;
      // copy /etc/skel
      const skel = fs.tryLookup("/etc/skel", "/");
      if (skel && skel.type === "dir") {
        for (const child of fs.list(skel)) fs.copy(child, dir, child.name, { uid, gid }, false, opts.now);
      }
      homeCreated = true;
    }
  }
  return { user, homeCreated, homeExisted };
}

export function deleteUser(state: EnvState, fs: VirtualFileSystem, username: string, removeHome: boolean, now: number) {
  const user = state.users.find((u) => u.username === username);
  if (!user) throw new UserError(`user '${username}' does not exist`, 6);
  if (user.uid === 0) throw new UserError(`user root is currently used by process 1`, 8);
  if (state.session.userStack.some((f) => f.user === username)) {
    throw new UserError(`user ${username} is currently used by process ${state.processes.find((p) => p.user === username)?.pid ?? 1234}`, 8);
  }
  state.users = state.users.filter((u) => u !== user);
  for (const g of state.groups) g.members = g.members.filter((m) => m !== username);
  // remove the user-private group when nobody else uses it
  const own = state.groups.find((g) => g.gid === user.gid && g.name === username);
  if (own && !state.users.some((u) => u.gid === own.gid)) state.groups = state.groups.filter((g) => g !== own);
  // kill their processes
  state.processes = state.processes.filter((p) => p.user !== username);
  if (removeHome) {
    const home = fs.tryLookup(user.home, "/", null, false);
    if (home && home.type === "dir" && user.home !== "/") fs.remove(home, now);
    const mail = fs.tryLookup(`/var/mail/${username}`, "/", null, false);
    if (mail) fs.remove(mail, now);
  }
  return user;
}

export function addUserToGroup(state: EnvState, username: string, groupName_: string) {
  const user = findUser(state, username);
  if (!user) throw new UserError(`user '${username}' does not exist`, 6);
  const group = findGroup(state, groupName_);
  if (!group) throw new UserError(`group '${groupName_}' does not exist`, 6);
  if (!group.members.includes(user.username)) group.members.push(user.username);
}

export function removeUserFromGroup(state: EnvState, username: string, groupName_: string) {
  const group = findGroup(state, groupName_);
  if (!group) throw new UserError(`group '${groupName_}' does not exist`, 6);
  if (!group.members.includes(username)) throw new UserError(`user '${username}' is not a member of '${group.name}'`, 3);
  group.members = group.members.filter((m) => m !== username);
}

export function passwdLine(u: LinuxUser): string {
  return `${u.username}:x:${u.uid}:${u.gid}:${u.gecos}:${u.home}:${u.shell}`;
}

export function groupLine(g: LinuxGroup): string {
  return `${g.name}:x:${g.gid}:${g.members.join(",")}`;
}

/** Regenerate /etc/passwd, /etc/group, /etc/shadow and /etc/gshadow from state. */
export function syncEtcFiles(state: EnvState, fs: VirtualFileSystem, now = Date.now()) {
  const passwd = state.users.map(passwdLine).join("\n") + "\n";
  const group = state.groups.map(groupLine).join("\n") + "\n";
  const shadow =
    state.users
      .map((u) => `${u.username}:${u.locked ? "!" : ""}${u.passwordHash}:${u.lastChange}:0:99999:7:::`)
      .join("\n") + "\n";
  const gshadow = state.groups.map((g) => `${g.name}:!::${g.members.join(",")}`).join("\n") + "\n";
  const write = (path: string, content: string, mode: number, gid: number) => {
    const node = fs.tryLookup(path, "/");
    if (node && node.content === content) return;
    fs.writeFileAt(path, content, { uid: 0, gid, mode, now });
  };
  const shadowGid = findGroup(state, "shadow")?.gid ?? 42;
  write("/etc/passwd", passwd, 0o644, 0);
  write("/etc/group", group, 0o644, 0);
  write("/etc/shadow", shadow, 0o640, shadowGid);
  write("/etc/gshadow", gshadow, 0o640, shadowGid);
}

/** Can `username` use sudo? (member of sudo/admin group or root) */
export function isSudoer(state: EnvState, username: string): boolean {
  if (username === "root") return true;
  return groupsOf(state, username).some((g) => g.name === "sudo" || g.name === "admin");
}
