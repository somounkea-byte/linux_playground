import { canAccess, type Identity, W, X } from "./permissions";
import type { EnvState, FsNode, NodeType } from "./types";
import { newId } from "./util";

export type FsErrorCode =
  | "ENOENT"
  | "ENOTDIR"
  | "EISDIR"
  | "EACCES"
  | "EEXIST"
  | "ENOTEMPTY"
  | "ELOOP"
  | "EPERM"
  | "EINVAL"
  | "ENOSPC"
  | "EBUSY"
  | "EFBIG";

export const ERRNO_MESSAGES: Record<FsErrorCode, string> = {
  ENOENT: "No such file or directory",
  ENOTDIR: "Not a directory",
  EISDIR: "Is a directory",
  EACCES: "Permission denied",
  EEXIST: "File exists",
  ENOTEMPTY: "Directory not empty",
  ELOOP: "Too many levels of symbolic links",
  EPERM: "Operation not permitted",
  EINVAL: "Invalid argument",
  ENOSPC: "No space left on device",
  EBUSY: "Device or resource busy",
  EFBIG: "File too large",
};

export class FsError extends Error {
  constructor(public code: FsErrorCode) {
    super(ERRNO_MESSAGES[code]);
  }
}

/** Safety limits for each student's virtual environment. */
export const LIMITS = {
  maxFileSize: 1024 * 1024, // 1 MiB per file
  maxTotalSize: 20 * 1024 * 1024, // 20 MiB per environment
  maxNodes: 6000,
  maxNameLength: 255,
  maxPathLength: 4096,
};

export function splitPath(path: string): string[] {
  return path.split("/").filter((p) => p.length > 0);
}

/** Lexically normalise `path` against `cwd` into an absolute path. */
export function normalizePath(path: string, cwd: string): string {
  const parts = path.startsWith("/") ? [] : splitPath(cwd);
  for (const comp of splitPath(path)) {
    if (comp === ".") continue;
    if (comp === "..") parts.pop();
    else parts.push(comp);
  }
  return "/" + parts.join("/");
}

export function basename(path: string): string {
  const parts = splitPath(path);
  return parts.length ? parts[parts.length - 1] : "/";
}

export function dirname(path: string): string {
  if (!path.includes("/")) return ".";
  const parts = splitPath(path);
  parts.pop();
  return (path.startsWith("/") ? "/" : "") + parts.join("/") || (path.startsWith("/") ? "/" : ".");
}

const byteLength = (s: string) => Buffer.byteLength(s, "utf8");

export class VirtualFileSystem {
  private children = new Map<string, Map<string, string>>();

  constructor(private state: EnvState) {
    this.reindex();
  }

  reindex() {
    this.children.clear();
    for (const node of Object.values(this.state.nodes)) {
      if (node.type === "dir") this.ensureIndex(node.id);
    }
    for (const node of Object.values(this.state.nodes)) {
      if (node.parentId) this.ensureIndex(node.parentId).set(node.name, node.id);
    }
  }

  private ensureIndex(id: string) {
    let m = this.children.get(id);
    if (!m) {
      m = new Map();
      this.children.set(id, m);
    }
    return m;
  }

  get root(): FsNode {
    return this.state.nodes[this.state.rootId];
  }

  get(id: string): FsNode | undefined {
    return this.state.nodes[id];
  }

  childNames(dir: FsNode): string[] {
    return [...(this.children.get(dir.id)?.keys() ?? [])];
  }

  list(dir: FsNode): FsNode[] {
    const ids = this.children.get(dir.id);
    if (!ids) return [];
    return [...ids.values()].map((id) => this.state.nodes[id]).filter(Boolean);
  }

  child(dir: FsNode, name: string): FsNode | undefined {
    const id = this.children.get(dir.id)?.get(name);
    return id ? this.state.nodes[id] : undefined;
  }

  pathOf(node: FsNode): string {
    const parts: string[] = [];
    let cur: FsNode | undefined = node;
    while (cur && cur.parentId) {
      parts.unshift(cur.name);
      cur = this.state.nodes[cur.parentId];
    }
    return "/" + parts.join("/");
  }

  /**
   * Resolve a path to a node.
   * @param follow follow a symlink in the final component
   * @param who when given, enforce search (x) permission on traversed directories
   */
  lookup(path: string, cwd: string, who?: Identity | null, follow = true, depth = 0): FsNode {
    if (depth > 40) throw new FsError("ELOOP");
    if (path.length > LIMITS.maxPathLength) throw new FsError("EINVAL");
    const abs = normalizePath(path, cwd);
    const comps = splitPath(abs);
    let cur = this.root;
    let curPath = "/";
    for (let i = 0; i < comps.length; i++) {
      if (cur.type !== "dir") throw new FsError("ENOTDIR");
      if (who && !canAccess(cur, who, X)) throw new FsError("EACCES");
      const next = this.child(cur, comps[i]);
      if (!next) throw new FsError("ENOENT");
      const last = i === comps.length - 1;
      if (next.type === "symlink" && (!last || follow)) {
        const targetAbs = normalizePath(next.target ?? "", curPath);
        const rest = comps.slice(i + 1).join("/");
        return this.lookup(rest ? `${targetAbs}/${rest}` : targetAbs, "/", who, follow, depth + 1);
      }
      cur = next;
      curPath = curPath === "/" ? `/${comps[i]}` : `${curPath}/${comps[i]}`;
    }
    // trailing slash on a non-directory
    if (path.endsWith("/") && path !== "/" && cur.type !== "dir") throw new FsError("ENOTDIR");
    return cur;
  }

  tryLookup(path: string, cwd: string, who?: Identity | null, follow = true): FsNode | null {
    try {
      return this.lookup(path, cwd, who, follow);
    } catch {
      return null;
    }
  }

  /** Resolve the parent directory of `path` and return it with the final name. */
  lookupParent(path: string, cwd: string, who?: Identity | null): { parent: FsNode; name: string } {
    const abs = normalizePath(path, cwd);
    const name = basename(abs);
    if (abs === "/") throw new FsError("EEXIST");
    const parent = this.lookup(dirname(abs), "/", who, true);
    if (parent.type !== "dir") throw new FsError("ENOTDIR");
    if (who && !canAccess(parent, who, X)) throw new FsError("EACCES");
    return { parent, name };
  }

  /** Check that `who` may create/delete entries in `dir`. */
  assertWritableDir(dir: FsNode, who: Identity) {
    if (!canAccess(dir, who, W | X)) throw new FsError("EACCES");
  }

  /** Sticky-bit check for deleting/renaming `node` inside `dir`. */
  assertCanUnlink(dir: FsNode, node: FsNode, who: Identity) {
    this.assertWritableDir(dir, who);
    if (dir.mode & 0o1000 && who.uid !== 0 && node.uid !== who.uid && dir.uid !== who.uid) {
      throw new FsError("EPERM");
    }
  }

  nodeCount() {
    return Object.keys(this.state.nodes).length;
  }

  create(
    parent: FsNode,
    name: string,
    type: NodeType,
    opts: { uid: number; gid: number; mode: number; content?: string; target?: string; size?: number; now?: number },
  ): FsNode {
    if (parent.type !== "dir") throw new FsError("ENOTDIR");
    if (!name || name === "." || name === ".." || name.includes("/")) throw new FsError("EINVAL");
    if (name.length > LIMITS.maxNameLength) throw new FsError("EINVAL");
    if (this.child(parent, name)) throw new FsError("EEXIST");
    if (this.nodeCount() >= LIMITS.maxNodes) throw new FsError("ENOSPC");
    const content = opts.content ?? "";
    if (byteLength(content) > LIMITS.maxFileSize) throw new FsError("EFBIG");
    const now = opts.now ?? Date.now();
    const node: FsNode = {
      id: newId(),
      parentId: parent.id,
      name,
      type,
      content,
      uid: opts.uid,
      gid: opts.gid,
      mode: opts.mode,
      ctime: now,
      mtime: now,
    };
    if (opts.target !== undefined) node.target = opts.target;
    if (opts.size !== undefined) node.size = opts.size;
    this.state.nodes[node.id] = node;
    this.ensureIndex(parent.id).set(name, node.id);
    if (type === "dir") this.ensureIndex(node.id);
    parent.mtime = now;
    return node;
  }

  /** Remove a node (and its subtree). */
  remove(node: FsNode, now = Date.now()) {
    if (node.id === this.state.rootId) throw new FsError("EBUSY");
    const stack = [node];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.type === "dir") stack.push(...this.list(n));
      delete this.state.nodes[n.id];
      this.children.delete(n.id);
    }
    if (node.parentId) {
      this.children.get(node.parentId)?.delete(node.name);
      const parent = this.state.nodes[node.parentId];
      if (parent) parent.mtime = now;
    }
  }

  isAncestor(maybeAncestor: FsNode, node: FsNode): boolean {
    let cur: FsNode | undefined = node;
    while (cur) {
      if (cur.id === maybeAncestor.id) return true;
      cur = cur.parentId ? this.state.nodes[cur.parentId] : undefined;
    }
    return false;
  }

  move(node: FsNode, newParent: FsNode, newName: string, now = Date.now()) {
    if (newParent.type !== "dir") throw new FsError("ENOTDIR");
    if (node.type === "dir" && this.isAncestor(node, newParent)) throw new FsError("EINVAL");
    const existing = this.child(newParent, newName);
    if (existing && existing.id !== node.id) this.remove(existing, now);
    if (node.parentId) {
      this.children.get(node.parentId)?.delete(node.name);
      const oldParent = this.state.nodes[node.parentId];
      if (oldParent) oldParent.mtime = now;
    }
    node.parentId = newParent.id;
    node.name = newName;
    node.ctime = now;
    this.ensureIndex(newParent.id).set(newName, node.id);
    newParent.mtime = now;
  }

  /** Deep-copy `src` into `destParent/name`. */
  copy(src: FsNode, destParent: FsNode, name: string, owner: { uid: number; gid: number }, preserve: boolean, now = Date.now()): FsNode {
    const copy = this.create(destParent, name, src.type, {
      uid: preserve ? src.uid : owner.uid,
      gid: preserve ? src.gid : owner.gid,
      mode: src.mode,
      content: src.content,
      target: src.target,
      size: src.size,
      now: preserve ? src.mtime : now,
    });
    if (src.type === "dir") {
      for (const child of this.list(src)) {
        if (child.id === copy.id) continue;
        this.copy(child, copy, child.name, owner, preserve, now);
      }
    }
    return copy;
  }

  writeContent(node: FsNode, content: string, append: boolean, now = Date.now()) {
    if (node.type === "dir") throw new FsError("EISDIR");
    if (node.type === "chardev") {
      // /dev/null and friends swallow writes
      return;
    }
    const next = append ? node.content + content : content;
    const size = byteLength(next);
    if (size > LIMITS.maxFileSize) throw new FsError("EFBIG");
    const delta = size - this.sizeOf(node);
    if (delta > 0 && this.totalSize() + delta > LIMITS.maxTotalSize) throw new FsError("ENOSPC");
    node.content = next;
    delete node.size;
    node.mtime = now;
  }

  sizeOf(node: FsNode): number {
    if (node.type === "dir") return 4096;
    if (node.type === "symlink") return (node.target ?? "").length;
    if (node.type === "chardev" || node.type === "blockdev") return 0;
    return node.size ?? byteLength(node.content);
  }

  totalSize(): number {
    let total = 0;
    for (const n of Object.values(this.state.nodes)) {
      if (n.type === "file" && n.size === undefined) total += byteLength(n.content);
    }
    return total;
  }

  /** Depth-first walk (pre-order). Return false from `fn` to skip a subtree. */
  walk(node: FsNode, fn: (n: FsNode, path: string, depth: number) => boolean | void, path = this.pathOf(node), depth = 0) {
    const res = fn(node, path, depth);
    if (res === false || node.type !== "dir") return;
    const kids = this.list(node).sort((a, b) => a.name.localeCompare(b.name));
    for (const k of kids) this.walk(k, fn, path === "/" ? `/${k.name}` : `${path}/${k.name}`, depth + 1);
  }

  /** Create all directories of an absolute path (setup helper, no permission checks). */
  mkdirp(path: string, owner: { uid: number; gid: number }, mode = 0o755, now = Date.now()): FsNode {
    let cur = this.root;
    for (const comp of splitPath(path)) {
      let next = this.child(cur, comp);
      if (!next) next = this.create(cur, comp, "dir", { ...owner, mode, now });
      cur = next;
    }
    return cur;
  }

  /** Write a file at an absolute path, creating parents (setup helper). */
  writeFileAt(
    path: string,
    content: string,
    opts: { uid: number; gid: number; mode?: number; size?: number; now?: number } = { uid: 0, gid: 0 },
  ): FsNode {
    const parent = this.mkdirp(dirname(path), { uid: 0, gid: 0 }, 0o755, opts.now);
    const name = basename(path);
    const existing = this.child(parent, name);
    if (existing) {
      existing.content = content;
      existing.uid = opts.uid;
      existing.gid = opts.gid;
      if (opts.mode !== undefined) existing.mode = opts.mode;
      if (opts.size !== undefined) existing.size = opts.size;
      else delete existing.size;
      existing.mtime = opts.now ?? Date.now();
      return existing;
    }
    return this.create(parent, name, "file", { uid: opts.uid, gid: opts.gid, mode: opts.mode ?? 0o644, content, size: opts.size, now: opts.now });
  }
}
