import { FsError, ERRNO_MESSAGES } from "../filesystem";
import type { FsNode } from "../types";
import type { CommandContext } from "./types";

export class OptError extends Error {}

export interface OptSpec {
  /** Boolean short flags, e.g. "laRh". */
  flags?: string;
  /** Short flags that take a value, e.g. "nt". */
  withValue?: string;
  /** Long options: name → short key (or itself); `=` suffix means it takes a value. */
  long?: Record<string, string>;
  /** Stop option parsing at the first operand (POSIX mode). */
  stopAtOperand?: boolean;
}

export interface ParsedOpts {
  flags: Set<string>;
  values: Record<string, string>;
  multi: Record<string, string[]>;
  operands: string[];
}

/**
 * GNU-style option parser: combined short flags, `--long[=value]`,
 * `--` terminator and option permutation.
 */
export function parseOpts(cmd: string, args: string[], spec: OptSpec): ParsedOpts {
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  const multi: Record<string, string[]> = {};
  const operands: string[] = [];
  const setValue = (k: string, v: string) => {
    values[k] = v;
    (multi[k] ??= []).push(v);
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--") && a.length > 2) {
      const eq = a.indexOf("=");
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const entries = Object.entries(spec.long ?? {});
      const exact = entries.find(([k]) => k.replace(/=$/, "") === name);
      const prefixMatches = entries.filter(([k]) => k.replace(/=$/, "").startsWith(name));
      const match = exact ?? (prefixMatches.length === 1 ? prefixMatches[0] : undefined);
      if (!match) {
        if (prefixMatches.length > 1) throw new OptError(`${cmd}: option '${a}' is ambiguous\nTry '${cmd} --help' for more information.`);
        throw new OptError(`${cmd}: unrecognized option '${a}'\nTry '${cmd} --help' for more information.`);
      }
      const [key, target] = match;
      if (key.endsWith("=")) {
        let v: string | undefined = eq === -1 ? undefined : a.slice(eq + 1);
        if (v === undefined) {
          v = args[++i];
          if (v === undefined) throw new OptError(`${cmd}: option '--${key.slice(0, -1)}' requires an argument\nTry '${cmd} --help' for more information.`);
        }
        setValue(target, v);
      } else {
        flags.add(target);
        if (eq !== -1) setValue(target, a.slice(eq + 1));
      }
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (spec.withValue?.includes(ch)) {
          let v = a.slice(j + 1);
          if (!v) {
            v = args[++i];
            if (v === undefined) throw new OptError(`${cmd}: option requires an argument -- '${ch}'\nTry '${cmd} --help' for more information.`);
          }
          setValue(ch, v);
          break;
        }
        if (spec.flags?.includes(ch)) flags.add(ch);
        else throw new OptError(`${cmd}: invalid option -- '${ch}'\nTry '${cmd} --help' for more information.`);
      }
      continue;
    }
    operands.push(a);
    if (spec.stopAtOperand) {
      operands.push(...args.slice(i + 1));
      break;
    }
  }
  return { flags, values, multi, operands };
}

/** Run `fn` and translate OptError / FsError into stderr output. */
export function withOpts(ctx: CommandContext, spec: OptSpec, fn: (o: ParsedOpts) => number): number {
  let parsed: ParsedOpts;
  try {
    parsed = parseOpts(ctx.name, ctx.args, spec);
  } catch (e) {
    if (e instanceof OptError) {
      ctx.err(e.message + "\n");
      return ctx.name === "ls" ? 2 : 1;
    }
    throw e;
  }
  return fn(parsed);
}

export function errMsg(e: unknown): string {
  if (e instanceof FsError) return ERRNO_MESSAGES[e.code];
  if (e instanceof Error) return e.message;
  return String(e);
}

export function isFsError(e: unknown, code?: string): e is FsError {
  return e instanceof FsError && (code === undefined || e.code === code);
}

/** Resolve a path for the current identity, honouring directory search permissions. */
export function resolve(ctx: CommandContext, path: string, follow = true): FsNode {
  return ctx.fs.lookup(path, ctx.cwd, ctx.who, follow);
}

export function tryResolve(ctx: CommandContext, path: string, follow = true): FsNode | null {
  try {
    return resolve(ctx, path, follow);
  } catch {
    return null;
  }
}

/** Read the content of a node (dynamic for /proc and /var/log). */
export function readNode(ctx: CommandContext, node: FsNode): string {
  return ctx.shell.readFileContent(node);
}

/** Read inputs given as file operands, or stdin when none / "-". */
export function readInputs(
  ctx: CommandContext,
  files: string[],
  onError: (file: string, e: unknown) => void,
): { name: string; content: string }[] {
  if (files.length === 0) return [{ name: "-", content: ctx.readAllStdin() }];
  const out: { name: string; content: string }[] = [];
  for (const f of files) {
    if (f === "-") {
      out.push({ name: "-", content: ctx.readAllStdin() });
      continue;
    }
    try {
      const node = resolve(ctx, f);
      if (node.type === "dir") throw new FsError("EISDIR");
      if (!ctx.shell.canRead(node)) throw new FsError("EACCES");
      out.push({ name: f, content: readNode(ctx, node) });
    } catch (e) {
      onError(f, e);
    }
  }
  return out;
}

/** Split text into lines (dropping the trailing empty element from a final newline). */
export function lines(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

export function joinLines(ls: string[]): string {
  return ls.length ? ls.join("\n") + "\n" : "";
}

/** Require root, otherwise print a message. Returns true when allowed. */
export function requireRoot(ctx: CommandContext, message: string): boolean {
  if (ctx.who.uid === 0) return true;
  ctx.err(message + "\n");
  return false;
}

/** Parse a numeric argument like head -n. */
export function parseCount(v: string): number | null {
  if (!/^[+-]?\d+$/.test(v)) return null;
  return Number(v);
}
