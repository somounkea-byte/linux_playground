/**
 * Evaluation for `test`, `[ ... ]` and `[[ ... ]]`.
 */
import { canAccess, R, W, X } from "./permissions";
import type { FsNode } from "./types";
import { globToRegExp } from "./util";

export class TestError extends Error {
  constructor(
    message: string,
    public status = 2,
  ) {
    super(message);
  }
}

export interface TestHost {
  lookup(path: string, follow: boolean): FsNode | null;
  identity: { uid: number; gid: number; groups: number[]; username: string };
  sizeOf(node: FsNode): number;
  setRematch?(groups: string[]): void;
}

const UNARY_FILE = new Set(["-e", "-a", "-f", "-d", "-r", "-w", "-x", "-s", "-L", "-h", "-b", "-c", "-p", "-S", "-O", "-G", "-u", "-g", "-k", "-t"]);
const UNARY_STR = new Set(["-z", "-n", "-v"]);
const BINARY = new Set(["=", "==", "!=", "<", ">", "-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-nt", "-ot", "-ef", "=~"]);

/**
 * @param args already-expanded words (for [[ ]], `patternArgs` carries the raw
 * pattern form of each word for the right side of == / !=)
 */
export function evalTest(args: string[], host: TestHost, mode: "test" | "cond", patternArgs?: string[], isVar?: (name: string) => boolean): boolean {
  let i = 0;
  const peek = () => args[i];
  const and = mode === "cond" ? "&&" : "-a";
  const or = mode === "cond" ? "||" : "-o";

  const intArg = (v: string): number => {
    const t = v.trim();
    if (!/^[+-]?\d+$/.test(t)) throw new TestError(`${v}: integer expression expected`);
    return Number(t);
  };

  const fileTest = (op: string, path: string): boolean => {
    const follow = op !== "-L" && op !== "-h";
    const node = host.lookup(path, follow);
    if (!node) return false;
    const who = host.identity;
    switch (op) {
      case "-e":
      case "-a":
        return true;
      case "-f":
        return node.type === "file";
      case "-d":
        return node.type === "dir";
      case "-L":
      case "-h":
        return node.type === "symlink";
      case "-b":
        return node.type === "blockdev";
      case "-c":
        return node.type === "chardev";
      case "-p":
      case "-S":
      case "-t":
        return false;
      case "-r":
        return canAccess(node, who, R);
      case "-w":
        return canAccess(node, who, W);
      case "-x":
        return canAccess(node, who, X);
      case "-s":
        return host.sizeOf(node) > 0;
      case "-O":
        return node.uid === who.uid;
      case "-G":
        return node.gid === who.gid;
      case "-u":
        return (node.mode & 0o4000) !== 0;
      case "-g":
        return (node.mode & 0o2000) !== 0;
      case "-k":
        return (node.mode & 0o1000) !== 0;
    }
    return false;
  };

  const binary = (left: string, op: string, right: string, rightPattern: string | undefined): boolean => {
    switch (op) {
      case "=":
      case "==":
      case "!=": {
        let eq: boolean;
        if (mode === "cond") eq = globToRegExp(rightPattern ?? right).test(left);
        else eq = left === right;
        return op === "!=" ? !eq : eq;
      }
      case "<":
        return left < right;
      case ">":
        return left > right;
      case "-eq":
        return intArg(left) === intArg(right);
      case "-ne":
        return intArg(left) !== intArg(right);
      case "-lt":
        return intArg(left) < intArg(right);
      case "-le":
        return intArg(left) <= intArg(right);
      case "-gt":
        return intArg(left) > intArg(right);
      case "-ge":
        return intArg(left) >= intArg(right);
      case "-nt":
      case "-ot": {
        const a = host.lookup(left, true);
        const b = host.lookup(right, true);
        if (!a || !b) return op === "-nt" ? !!a && !b : !a && !!b;
        return op === "-nt" ? a.mtime > b.mtime : a.mtime < b.mtime;
      }
      case "-ef": {
        const a = host.lookup(left, true);
        const b = host.lookup(right, true);
        return !!a && !!b && a.id === b.id;
      }
      case "=~": {
        let re: RegExp;
        try {
          re = new RegExp(right);
        } catch {
          return false;
        }
        const m = re.exec(left);
        host.setRematch?.(m ? [...m].map((x) => x ?? "") : []);
        return !!m;
      }
    }
    throw new TestError(`${op}: binary operator expected`);
  };

  const primary = (): boolean => {
    const t = peek();
    if (t === undefined) throw new TestError("argument expected");
    if (t === "(") {
      i++;
      const v = orExpr();
      if (args[i] !== ")") throw new TestError("`)' expected");
      i++;
      return v;
    }
    // binary forms take precedence: a op b
    if (i + 2 < args.length + 0 && BINARY.has(args[i + 1]) && args[i + 2] !== undefined) {
      const left = args[i];
      const op = args[i + 1];
      const right = args[i + 2];
      const rp = patternArgs?.[i + 2];
      i += 3;
      return binary(left, op, right, rp);
    }
    if (UNARY_FILE.has(t) && args[i + 1] !== undefined) {
      i += 2;
      return fileTest(t, args[i - 1]);
    }
    if (UNARY_STR.has(t) && args[i + 1] !== undefined) {
      i += 2;
      const v = args[i - 1];
      if (t === "-z") return v.length === 0;
      if (t === "-v") return isVar ? isVar(v) : false;
      return v.length > 0;
    }
    i++;
    return t.length > 0;
  };

  const notExpr = (): boolean => {
    if (peek() === "!" && i + 1 < args.length) {
      i++;
      return !notExpr();
    }
    return primary();
  };

  const andExpr = (): boolean => {
    let v = notExpr();
    while (peek() === and) {
      i++;
      const r = notExpr();
      v = v && r;
    }
    return v;
  };

  const orExpr = (): boolean => {
    let v = andExpr();
    while (peek() === or) {
      i++;
      const r = andExpr();
      v = v || r;
    }
    return v;
  };

  if (args.length === 0) return false;
  const result = orExpr();
  if (i < args.length) {
    if (mode === "test") throw new TestError(args.length > 3 ? "too many arguments" : `${args[i]}: unary operator expected`);
    throw new TestError(`syntax error in conditional expression`);
  }
  return result;
}
