import type { FsNode, NodeType } from "./types";

export const R = 4;
export const W = 2;
export const X = 1;

export const S_ISUID = 0o4000;
export const S_ISGID = 0o2000;
export const S_ISVTX = 0o1000;

/** The identity a command runs as. */
export interface Identity {
  uid: number;
  gid: number;
  /** All group ids (primary + supplementary). */
  groups: number[];
  username: string;
}

export function typeChar(type: NodeType): string {
  switch (type) {
    case "dir":
      return "d";
    case "symlink":
      return "l";
    case "chardev":
      return "c";
    case "blockdev":
      return "b";
    default:
      return "-";
  }
}

/** Format permission bits as `rwxr-xr-x` (with s/t special bits). */
export function modeToSymbolic(mode: number): string {
  const chars: string[] = [];
  const triples = [(mode >> 6) & 7, (mode >> 3) & 7, mode & 7];
  const special = [mode & S_ISUID, mode & S_ISGID, mode & S_ISVTX];
  triples.forEach((t, i) => {
    chars.push(t & R ? "r" : "-");
    chars.push(t & W ? "w" : "-");
    const x = t & X;
    if (special[i]) {
      const c = i === 2 ? "t" : "s";
      chars.push(x ? c : c.toUpperCase());
    } else {
      chars.push(x ? "x" : "-");
    }
  });
  return chars.join("");
}

export function formatMode(node: Pick<FsNode, "type" | "mode">): string {
  return typeChar(node.type) + modeToSymbolic(node.mode);
}

export function modeToOctal(mode: number, width = 3): string {
  const s = (mode & 0o7777).toString(8);
  return s.padStart(width, "0");
}

/**
 * Check whether `who` may access `node` with the requested bits (R/W/X).
 * Mirrors the kernel's owner → group → other selection.
 */
export function canAccess(node: Pick<FsNode, "uid" | "gid" | "mode" | "type">, who: Identity, want: number): boolean {
  if (who.uid === 0) {
    // root bypasses rw checks; execute on files needs at least one x bit
    if (want & X && node.type !== "dir") {
      return (node.mode & 0o111) !== 0;
    }
    return true;
  }
  let bits: number;
  if (node.uid === who.uid) bits = (node.mode >> 6) & 7;
  else if (who.groups.includes(node.gid)) bits = (node.mode >> 3) & 7;
  else bits = node.mode & 7;
  return (bits & want) === want;
}

export class ChmodParseError extends Error {}

/**
 * Apply a chmod mode string (numeric like `755` or symbolic like `u+x,g-w`)
 * to an existing mode. Returns the new mode.
 */
export function applyChmod(spec: string, current: number, isDir: boolean, umask = 0o022): number {
  if (/^[0-7]{1,4}$/.test(spec)) {
    const value = parseInt(spec, 8);
    // chmod on directories with 3-4 digits keeps setgid unless explicitly given (GNU behaviour for 1-3 digits)
    if (isDir && spec.length <= 3) {
      return (value & 0o777) | (current & (S_ISUID | S_ISGID));
    }
    return value & 0o7777;
  }
  let mode = current & 0o7777;
  for (const clause of spec.split(",")) {
    const m = /^([ugoa]*)([-+=][rwxXst]*)+$/.exec(clause);
    if (!m || clause.length === 0) throw new ChmodParseError(spec);
    let who = m[1];
    const explicitWho = who.length > 0;
    if (!explicitWho) who = "a";
    if (who.includes("a")) who = "ugo";
    const ops = clause.slice(m[1].length).match(/[-+=][rwxXst]*/g) ?? [];
    for (const op of ops) {
      const operator = op[0];
      const perms = op.slice(1);
      let bits = 0;
      for (const p of perms) {
        if (p === "r") bits |= R;
        else if (p === "w") bits |= W;
        else if (p === "x") bits |= X;
        else if (p === "X") {
          if (isDir || (current & 0o111) !== 0) bits |= X;
        }
      }
      let mask = 0;
      let special = 0;
      for (const w of who) {
        if (w === "u") {
          mask |= bits << 6;
          if (perms.includes("s")) special |= S_ISUID;
        } else if (w === "g") {
          mask |= bits << 3;
          if (perms.includes("s")) special |= S_ISGID;
        } else if (w === "o") {
          mask |= bits;
        }
      }
      if (perms.includes("t")) special |= S_ISVTX;
      // Without explicit who, + and - honour the umask (GNU semantics)
      if (!explicitWho && operator !== "=") mask &= ~umask;
      if (operator === "+") mode |= mask | special;
      else if (operator === "-") mode &= ~(mask | special);
      else {
        let clear = 0;
        for (const w of who) {
          if (w === "u") clear |= 0o700 | S_ISUID;
          if (w === "g") clear |= 0o070 | S_ISGID;
          if (w === "o") clear |= 0o007 | S_ISVTX;
        }
        mode = (mode & ~clear) | mask | special;
      }
    }
  }
  return mode;
}

/** Breakdown of a mode for the visual permission calculator. */
export function describeMode(mode: number) {
  const part = (shift: number) => {
    const v = (mode >> shift) & 7;
    return { read: !!(v & R), write: !!(v & W), execute: !!(v & X), value: v };
  };
  return { owner: part(6), group: part(3), others: part(0) };
}
