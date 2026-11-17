import { createHash } from "node:crypto";
import { FsError } from "../filesystem";
import { canAccess, R, W } from "../permissions";
import type { FsNode } from "../types";
import { escapeRegExp } from "../util";
import { awkCommand } from "./awk";
import { errMsg, joinLines, lines, parseOpts, OptError, readInputs, readNode, resolve, withOpts } from "./helpers";
import type { CommandContext, CommandDef } from "./types";

const collator = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true });

function fileErr(ctx: CommandContext, cmd: string) {
  return (file: string, e: unknown) => ctx.err(`${cmd}: ${file}: ${errMsg(e)}\n`);
}

// -------------------------------------------------------------------- cat

function cat(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "nbsEATetuv", long: { number: "n", "number-nonblank": "b", "squeeze-blank": "s", "show-ends": "E", "show-all": "A", "show-tabs": "T" } }, (o) => {
    let status = 0;
    const inputs = readInputs(ctx, o.operands, (f, e) => {
      ctx.err(`${ctx.name}: ${f}: ${errMsg(e)}\n`);
      status = 1;
    });
    let n = 1;
    for (const { content } of inputs) {
      if (!["n", "b", "s", "E", "A", "T", "e", "t"].some((f) => o.flags.has(f))) {
        ctx.out(content);
        continue;
      }
      let ls = content.split("\n");
      const endsWithNl = content.endsWith("\n");
      if (endsWithNl) ls.pop();
      if (o.flags.has("s")) ls = ls.filter((l, i) => !(l === "" && ls[i - 1] === ""));
      const showEnds = o.flags.has("E") || o.flags.has("A") || o.flags.has("e");
      const showTabs = o.flags.has("T") || o.flags.has("A") || o.flags.has("t");
      const out = ls.map((l, i) => {
        let line = showTabs ? l.replace(/\t/g, "^I") : l;
        if (showEnds && (i < ls.length - 1 || endsWithNl)) line += "$";
        if (o.flags.has("b")) return l === "" ? line : `${String(n++).padStart(6)}\t${line}`;
        if (o.flags.has("n")) return `${String(n++).padStart(6)}\t${line}`;
        return line;
      });
      ctx.out(out.join("\n") + (endsWithNl ? "\n" : ""));
    }
    return status;
  });
}

function tac(ctx: CommandContext): number {
  let status = 0;
  for (const { content } of readInputs(ctx, ctx.args, (f, e) => {
    ctx.err(`tac: failed to open '${f}' for reading: ${errMsg(e)}\n`);
    status = 1;
  })) {
    ctx.out(joinLines(lines(content).reverse()));
  }
  return status;
}

// ----------------------------------------------------------- head / tail

function headTail(ctx: CommandContext, isHead: boolean): number {
  // support legacy -5 style
  const args = ctx.args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a));
  let o;
  try {
    o = parseOpts(ctx.name, args, { flags: "qvfF", withValue: "nc", long: { "lines=": "n", "bytes=": "c", quiet: "q", verbose: "v", follow: "f" } });
  } catch (e) {
    if (e instanceof OptError) {
      ctx.err(e.message + "\n");
      return 1;
    }
    throw e;
  }
  const nRaw = o.values.n ?? "10";
  const fromStart = !isHead && nRaw.startsWith("+");
  const allBut = isHead && nRaw.startsWith("-");
  const n = Math.abs(Number(nRaw.replace(/^[+-]/, "")));
  if (Number.isNaN(n)) {
    ctx.err(`${ctx.name}: invalid number of lines: ‘${nRaw}’\n`);
    return 1;
  }
  let status = 0;
  const inputs = readInputs(ctx, o.operands, (f, e) => {
    ctx.err(`${ctx.name}: cannot open '${f}' for reading: ${errMsg(e)}\n`);
    status = 1;
  });
  const showHeaders = (inputs.length > 1 && !o.flags.has("q")) || o.flags.has("v");
  inputs.forEach(({ name, content }, idx) => {
    if (showHeaders) ctx.out(`${idx > 0 ? "\n" : ""}==> ${name === "-" ? "standard input" : name} <==\n`);
    if (o.values.c !== undefined) {
      const c = Number(o.values.c);
      ctx.out(isHead ? content.slice(0, c) : content.slice(-c));
      return;
    }
    const ls = lines(content);
    const trailing = content.endsWith("\n") || content === "";
    let sel: string[];
    if (isHead) sel = allBut ? ls.slice(0, Math.max(0, ls.length - n)) : ls.slice(0, n);
    else sel = fromStart ? ls.slice(Math.max(0, n - 1)) : n === 0 ? [] : ls.slice(-n);
    const includesLast = sel.length > 0 && sel[sel.length - 1] === ls[ls.length - 1] && (isHead ? sel.length === ls.length : true);
    ctx.out(sel.join("\n") + (sel.length && (trailing || !includesLast) ? "\n" : ""));
  });
  return status;
}

// ---------------------------------------------------------------------- wc

function wc(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "lwcmL", long: { lines: "l", words: "w", bytes: "c", chars: "m", "max-line-length": "L" } }, (o) => {
    let status = 0;
    const sel = ["l", "w", "m", "c", "L"].filter((f) => o.flags.has(f));
    const which = sel.length ? sel : ["l", "w", "c"];
    const inputs = readInputs(ctx, o.operands, (f, e) => {
      ctx.err(`wc: ${f}: ${errMsg(e)}\n`);
      status = 1;
    });
    const rows = inputs.map(({ name, content }) => {
      const counts: Record<string, number> = {
        l: (content.match(/\n/g) ?? []).length,
        w: content.split(/\s+/).filter(Boolean).length,
        c: Buffer.byteLength(content),
        m: [...content].length,
        L: Math.max(0, ...content.split("\n").map((l) => l.length)),
      };
      return { name: o.operands.length ? name : "", counts };
    });
    if (rows.length > 1) {
      const total: Record<string, number> = { l: 0, w: 0, c: 0, m: 0, L: 0 };
      for (const r of rows) for (const k of Object.keys(total)) total[k] = k === "L" ? Math.max(total[k], r.counts[k]) : total[k] + r.counts[k];
      rows.push({ name: "total", counts: total });
    }
    const maxVal = Math.max(...rows.map((r) => Math.max(...which.map((k) => r.counts[k]))));
    let width = String(maxVal).length;
    if (!o.operands.length) width = Math.max(width, 7);
    if (which.length === 1 && rows.length === 1) width = 0;
    for (const r of rows) {
      const nums = which.map((k) => String(r.counts[k]).padStart(width)).join(" ");
      ctx.out(nums + (r.name ? ` ${r.name}` : "") + "\n");
    }
    return status;
  });
}

// -------------------------------------------------------------------- sort

function sortCmd(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "rnufbhVcs", withValue: "kto", long: { reverse: "r", "numeric-sort": "n", unique: "u", "ignore-case": "f", "human-numeric-sort": "h", "key=": "k", "field-separator=": "t", "output=": "o" } }, (o) => {
    let status = 0;
    const content = readInputs(ctx, o.operands, (f, e) => {
      ctx.err(`sort: cannot read: ${f}: ${errMsg(e)}\n`);
      status = 2;
    })
      .map((i) => i.content)
      .join("");
    if (status) return status;
    const ls = lines(content);
    const sep = o.values.t;
    const keyOf = (line: string): string => {
      if (!o.values.k) return line;
      const m = /^(\d+)(?:\.\d+)?[a-z]*(?:,(\d+))?/.exec(o.values.k);
      if (!m) return line;
      const start = Number(m[1]) - 1;
      const end = m[2] ? Number(m[2]) : undefined;
      const fields = sep ? line.split(sep) : line.trim().split(/\s+/);
      return fields.slice(start, end).join(sep ?? " ");
    };
    const numeric = o.flags.has("n") || /n/.test(o.values.k?.replace(/^\d+(,\d+)?/, "") ?? "");
    const human = o.flags.has("h");
    const parseHuman = (s: string) => {
      const m = /^\s*(-?\d+(?:\.\d+)?)([KMGTP]?)/i.exec(s);
      if (!m) return 0;
      const power = m[2] ? "KMGTP".indexOf(m[2].toUpperCase()) + 1 : 0;
      return Number(m[1]) * 1024 ** power;
    };
    const cmp = (a: string, b: string): number => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      let r: number;
      if (numeric) r = (parseFloat(ka) || 0) - (parseFloat(kb) || 0);
      else if (human) r = parseHuman(ka) - parseHuman(kb);
      else if (o.flags.has("f")) r = ka.toLowerCase() < kb.toLowerCase() ? -1 : ka.toLowerCase() > kb.toLowerCase() ? 1 : 0;
      else r = collator.compare(ka, kb);
      if (r === 0 && !o.flags.has("s")) r = a < b ? -1 : a > b ? 1 : 0;
      return r;
    };
    if (o.flags.has("c")) {
      for (let i = 1; i < ls.length; i++) {
        if (cmp(ls[i - 1], ls[i]) > 0) {
          ctx.err(`sort: -:${i + 1}: disorder: ${ls[i]}\n`);
          return 1;
        }
      }
      return 0;
    }
    let sorted = [...ls].sort(cmp);
    if (o.flags.has("r")) sorted.reverse();
    if (o.flags.has("u")) sorted = sorted.filter((l, i) => i === 0 || (numeric ? parseFloat(keyOf(l)) !== parseFloat(keyOf(sorted[i - 1])) : keyOf(l) !== keyOf(sorted[i - 1])));
    const text = joinLines(sorted);
    if (o.values.o) {
      const sink = ctx.shell.openForWrite(o.values.o, false);
      sink.write(text);
    } else ctx.out(text);
    return 0;
  });
}

function uniq(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "cdui", long: { count: "c", repeated: "d", unique: "u", "ignore-case": "i" } }, (o) => {
    let status = 0;
    const [input, output] = o.operands;
    const content = readInputs(ctx, input ? [input] : [], (f, e) => {
      ctx.err(`uniq: ${f}: ${errMsg(e)}\n`);
      status = 1;
    })[0]?.content;
    if (content === undefined) return status;
    const ls = lines(content);
    const groups: { line: string; count: number }[] = [];
    for (const l of ls) {
      const last = groups[groups.length - 1];
      if (last && (o.flags.has("i") ? last.line.toLowerCase() === l.toLowerCase() : last.line === l)) last.count++;
      else groups.push({ line: l, count: 1 });
    }
    const out = groups
      .filter((g) => (o.flags.has("d") ? g.count > 1 : o.flags.has("u") ? g.count === 1 : true))
      .map((g) => (o.flags.has("c") ? `${String(g.count).padStart(7)} ${g.line}` : g.line));
    if (output) ctx.shell.openForWrite(output, false).write(joinLines(out));
    else ctx.out(joinLines(out));
    return 0;
  });
}

// --------------------------------------------------------------------- cut

function parseList(spec: string): ((n: number) => boolean) | null {
  const parts = spec.split(",");
  const ranges: [number, number][] = [];
  for (const p of parts) {
    const m = /^(\d*)(-?)(\d*)$/.exec(p);
    if (!m || (!m[1] && !m[3])) return null;
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : Infinity) : a;
    if (a < 1) return null;
    ranges.push([a, b]);
  }
  return (n) => ranges.some(([a, b]) => n >= a && n <= b);
}

function cut(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "s", withValue: "dfcb", long: { "delimiter=": "d", "fields=": "f", "characters=": "c", "bytes=": "b", "only-delimited": "s", "output-delimiter=": "od", complement: "complement" } }, (o) => {
    const listSpec = o.values.f ?? o.values.c ?? o.values.b;
    if (!listSpec) {
      ctx.err("cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.\n");
      return 1;
    }
    const sel = parseList(listSpec);
    if (!sel) {
      ctx.err(`cut: invalid field value ‘${listSpec}’\nTry 'cut --help' for more information.\n`);
      return 1;
    }
    const delim = o.values.d ?? "\t";
    if (delim.length !== 1) {
      ctx.err("cut: the delimiter must be a single character\nTry 'cut --help' for more information.\n");
      return 1;
    }
    const outDelim = o.values.od ?? delim;
    const pick = (n: number) => (o.flags.has("complement") ? !sel(n) : sel(n));
    let status = 0;
    for (const { content } of readInputs(ctx, o.operands, (f, e) => {
      ctx.err(`cut: ${f}: ${errMsg(e)}\n`);
      status = 1;
    })) {
      const out = lines(content).flatMap((l) => {
        if (o.values.f !== undefined) {
          if (!l.includes(delim)) return o.flags.has("s") ? [] : [l];
          return [l.split(delim).filter((_, i) => pick(i + 1)).join(outDelim)];
        }
        return [[...l].filter((_, i) => pick(i + 1)).join("")];
      });
      ctx.out(joinLines(out));
    }
    return status;
  });
}

// ---------------------------------------------------------------------- tr

const CLASSES: Record<string, string> = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digit: "0123456789",
  alpha: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  alnum: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  space: " \t\n\r\v\f",
  blank: " \t",
  punct: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
};

function expandSet(set: string): string {
  let s = set.replace(/\[:(\w+):\]/g, (_, c: string) => CLASSES[c] ?? "");
  s = s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i + 1] === "-" && i + 2 < s.length) {
      const a = s.charCodeAt(i);
      const b = s.charCodeAt(i + 2);
      for (let c = a; c <= b; c++) out += String.fromCharCode(c);
      i += 2;
    } else out += s[i];
  }
  return out;
}

function tr(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "dscC", long: { delete: "d", "squeeze-repeats": "s", complement: "c" } }, (o) => {
    const [s1raw, s2raw] = o.operands;
    if (s1raw === undefined) {
      ctx.err("tr: missing operand\nTry 'tr --help' for more information.\n");
      return 1;
    }
    if (s2raw === undefined && !o.flags.has("d") && !o.flags.has("s")) {
      ctx.err(`tr: missing operand after ‘${s1raw}’\nTwo strings must be given when translating.\nTry 'tr --help' for more information.\n`);
      return 1;
    }
    if (o.operands.length > (o.flags.has("d") && !o.flags.has("s") ? 1 : 2)) {
      ctx.err(`tr: extra operand ‘${o.operands[o.flags.has("d") ? 1 : 2]}’\nTry 'tr --help' for more information.\n`);
      return 1;
    }
    const input = ctx.readAllStdin();
    const s1 = expandSet(s1raw);
    const complement = o.flags.has("c") || o.flags.has("C");
    const inS1 = (ch: string) => (complement ? !s1.includes(ch) : s1.includes(ch));
    let out = "";
    if (o.flags.has("d")) {
      for (const ch of input) if (!inS1(ch)) out += ch;
      if (o.flags.has("s") && s2raw) {
        const s2 = expandSet(s2raw);
        out = out.replace(new RegExp(`([${escapeRegExp(s2)}])\\1+`, "g"), "$1");
      }
      ctx.out(out);
      return 0;
    }
    if (s2raw !== undefined) {
      const s2 = expandSet(s2raw);
      for (const ch of input) {
        if (complement) {
          out += s1.includes(ch) ? ch : (s2[s2.length - 1] ?? ch);
          continue;
        }
        const idx = s1.indexOf(ch);
        out += idx === -1 ? ch : (s2[Math.min(idx, s2.length - 1)] ?? ch);
      }
    } else out = input;
    if (o.flags.has("s")) {
      const squeezeSet = s2raw !== undefined ? expandSet(s2raw) : s1;
      let res = "";
      for (const ch of out) if (!(res.endsWith(ch) && squeezeSet.includes(ch))) res += ch;
      out = res;
    }
    ctx.out(out);
    return 0;
  });
}

function tee(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "ai", long: { append: "a" } }, (o) => {
    const input = ctx.readAllStdin();
    let status = 0;
    for (const f of o.operands) {
      try {
        ctx.shell.openForWrite(f, o.flags.has("a")).write(input);
      } catch (e) {
        ctx.err(`tee: ${f}: ${errMsg(e).replace(/^.*: /, "")}\n`);
        status = 1;
      }
    }
    ctx.out(input);
    return status;
  });
}

// -------------------------------------------------------------------- grep

/** Convert a POSIX basic/extended regex to a JS RegExp source. */
export function posixRegex(pattern: string, extended: boolean): string {
  let s = pattern.replace(/\[:(\w+):\]/g, (_, c: string) => {
    const map: Record<string, string> = { alpha: "a-zA-Z", digit: "0-9", alnum: "a-zA-Z0-9", upper: "A-Z", lower: "a-z", space: "\\s", blank: " \\t", punct: "!-\\/:-@\\[-`{-~", xdigit: "0-9A-Fa-f" };
    return map[c] ?? "";
  });
  if (extended) return s;
  // BRE: \( \) \{ \} \| \+ \? are special, bare ones are literal
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const n = s[i + 1];
      if ("(){}|+?".includes(n)) out += n;
      else out += "\\" + n;
      i++;
      continue;
    }
    if ("(){}|+?".includes(c)) out += "\\" + c;
    else out += c;
  }
  s = out;
  return s;
}

const GREP_COLOR = {
  match: (s: string) => `\x1b[01;31m\x1b[K${s}\x1b[m\x1b[K`,
  file: (s: string) => `\x1b[35m\x1b[K${s}\x1b[m\x1b[K`,
  line: (s: string) => `\x1b[32m\x1b[K${s}\x1b[m\x1b[K`,
  sep: (s: string) => `\x1b[36m\x1b[K${s}\x1b[m\x1b[K`,
};

function grep(ctx: CommandContext): number {
  return withOpts(
    ctx,
    {
      flags: "ivnclLrRwxoEFhHqsPz",
      withValue: "eABCm",
      long: {
        "ignore-case": "i",
        "invert-match": "v",
        "line-number": "n",
        count: "c",
        "files-with-matches": "l",
        "files-without-match": "L",
        recursive: "r",
        "word-regexp": "w",
        "line-regexp": "x",
        "only-matching": "o",
        "extended-regexp": "E",
        "fixed-strings": "F",
        "no-filename": "h",
        "with-filename": "H",
        quiet: "q",
        silent: "q",
        "no-messages": "s",
        "regexp=": "e",
        "color=": "color",
        "colour=": "color",
        color: "color",
        "include=": "include",
        "exclude=": "exclude",
        "max-count=": "m",
      },
    },
    (o) => {
      const f = o.flags;
      let patterns = o.multi.e ?? [];
      let operands = o.operands;
      if (!patterns.length) {
        if (!operands.length) {
          ctx.err("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n");
          return 2;
        }
        patterns = [operands[0]];
        operands = operands.slice(1);
      }
      patterns = patterns.flatMap((p) => p.split("\n"));
      const extended = f.has("E") || ctx.name === "egrep" || f.has("P");
      const fixed = f.has("F") || ctx.name === "fgrep";
      let source = patterns.map((p) => (fixed ? escapeRegExp(p) : posixRegex(p, extended))).map((p) => `(?:${p})`).join("|");
      if (f.has("w")) source = `(?<![A-Za-z0-9_])(?:${source})(?![A-Za-z0-9_])`;
      if (f.has("x")) source = `^(?:${source})$`;
      let re: RegExp;
      try {
        re = new RegExp(source, f.has("i") ? "gi" : "g");
      } catch {
        ctx.err(`grep: Invalid regular expression\n`);
        return 2;
      }
      const colorMode = o.values.color ?? (f.has("color") ? "auto" : "never");
      const color = colorMode === "always" || (colorMode === "auto" && ctx.stdoutIsTTY);
      const recursive = f.has("r") || f.has("R");
      const maxCount = o.values.m ? Number(o.values.m) : Infinity;
      const after = Number(o.values.A ?? o.values.C ?? 0);
      const before = Number(o.values.B ?? o.values.C ?? 0);
      const include = o.values.include ? new RegExp(`^${o.values.include.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`) : null;

      const sources: { name: string; content: string }[] = [];
      let errors = false;
      if (!operands.length && recursive) operands = ["."];
      if (!operands.length) sources.push({ name: "(standard input)", content: ctx.readAllStdin() });
      for (const op of operands) {
        if (op === "-") {
          sources.push({ name: "(standard input)", content: ctx.readAllStdin() });
          continue;
        }
        let node: FsNode;
        try {
          node = resolve(ctx, op);
        } catch (e) {
          if (!f.has("s")) ctx.err(`grep: ${op}: ${errMsg(e)}\n`);
          errors = true;
          continue;
        }
        if (node.type === "dir") {
          if (!recursive) {
            if (!f.has("s")) ctx.err(`grep: ${op}: Is a directory\n`);
            errors = true;
            continue;
          }
          ctx.fs.walk(node, (n, path) => {
            if (n.type === "dir" && !canAccess(n, ctx.who, R)) {
              if (!f.has("s")) ctx.err(`grep: ${path}: Permission denied\n`);
              errors = true;
              return false;
            }
            if (n.type !== "file") return;
            const shown = op === "." ? path.replace(ctx.fs.pathOf(node), ".").replace(/^\.\//, "") : path.replace(ctx.fs.pathOf(node), op.replace(/\/+$/, ""));
            if (include && !include.test(n.name)) return;
            if (!canAccess(n, ctx.who, R)) {
              if (!f.has("s")) ctx.err(`grep: ${shown}: Permission denied\n`);
              errors = true;
              return;
            }
            sources.push({ name: shown, content: readNode(ctx, n) });
          });
          continue;
        }
        if (!ctx.shell.canRead(node)) {
          if (!f.has("s")) ctx.err(`grep: ${op}: Permission denied\n`);
          errors = true;
          continue;
        }
        sources.push({ name: op, content: readNode(ctx, node) });
      }
      const showName = f.has("H") || (!f.has("h") && (sources.length > 1 || recursive));
      let anyMatch = false;
      for (const src of sources) {
        const ls = lines(src.content);
        let count = 0;
        let lastPrinted = -1;
        let pendingAfter = 0;
        const name = color ? GREP_COLOR.file(src.name) : src.name;
        const prefix = (i: number, sepChar: string) =>
          (showName ? name + (color ? GREP_COLOR.sep(sepChar) : sepChar) : "") + (f.has("n") ? (color ? GREP_COLOR.line(String(i + 1)) : String(i + 1)) + (color ? GREP_COLOR.sep(sepChar) : sepChar) : "");
        for (let i = 0; i < ls.length; i++) {
          if (count >= maxCount) break;
          re.lastIndex = 0;
          const matched = re.test(ls[i]) !== f.has("v");
          if (!matched) {
            if (pendingAfter > 0 && !f.has("c") && !f.has("l") && !f.has("q")) {
              ctx.out(prefix(i, "-") + ls[i] + "\n");
              lastPrinted = i;
              pendingAfter--;
            }
            continue;
          }
          count++;
          anyMatch = true;
          if (f.has("q")) return 0;
          if (f.has("l") || f.has("L") || f.has("c")) continue;
          if (before > 0 || after > 0) {
            if (lastPrinted >= 0 && i - before > lastPrinted + 1) ctx.out(color ? GREP_COLOR.sep("--") + "\n" : "--\n");
            for (let b = Math.max(lastPrinted + 1, i - before); b < i; b++) ctx.out(prefix(b, "-") + ls[b] + "\n");
          }
          if (f.has("o") && !f.has("v")) {
            re.lastIndex = 0;
            for (const m of ls[i].matchAll(re)) if (m[0]) ctx.out(prefix(i, ":") + (color ? GREP_COLOR.match(m[0]) : m[0]) + "\n");
          } else {
            re.lastIndex = 0;
            const text = color && !f.has("v") ? ls[i].replace(re, (m) => (m ? GREP_COLOR.match(m) : m)) : ls[i];
            ctx.out(prefix(i, ":") + text + "\n");
          }
          lastPrinted = i;
          pendingAfter = after;
        }
        if (f.has("c")) ctx.out((showName ? name + (color ? GREP_COLOR.sep(":") : ":") : "") + count + "\n");
        if (f.has("l") && count > 0) ctx.out(name + "\n");
        if (f.has("L") && count === 0) ctx.out(name + "\n");
      }
      if (errors && !f.has("q")) return 2;
      return anyMatch ? 0 : 1;
    },
  );
}

// --------------------------------------------------------------------- sed

interface SedCmd {
  a1?: SedAddr;
  a2?: SedAddr;
  negate: boolean;
  cmd: string;
  re?: RegExp;
  replacement?: string;
  global?: boolean;
  occurrence?: number;
  print?: boolean;
  text?: string;
  from?: string;
  to?: string;
  block?: SedCmd[];
}

type SedAddr = { type: "line"; n: number } | { type: "last" } | { type: "re"; re: RegExp };

function parseSed(script: string, extended: boolean): SedCmd[] {
  const cmds: SedCmd[] = [];
  let i = 0;
  const skipWs = () => {
    while (i < script.length && /[\s;]/.test(script[i])) i++;
  };
  const readDelimited = (delim: string): string => {
    let out = "";
    while (i < script.length && script[i] !== delim) {
      if (script[i] === "\\" && i + 1 < script.length) {
        if (script[i + 1] === delim) out += delim;
        else if (script[i + 1] === "n") out += "\n";
        else out += script[i] + script[i + 1];
        i += 2;
        continue;
      }
      out += script[i++];
    }
    if (script[i] !== delim) throw new Error(`unterminated \`s' command`);
    i++;
    return out;
  };
  const readAddr = (): SedAddr | undefined => {
    if (/\d/.test(script[i])) {
      const m = /^\d+/.exec(script.slice(i))!;
      i += m[0].length;
      return { type: "line", n: Number(m[0]) };
    }
    if (script[i] === "$") {
      i++;
      return { type: "last" };
    }
    if (script[i] === "/" || script[i] === "\\") {
      const delim = script[i] === "\\" ? script[++i] : "/";
      i++;
      const src = readDelimited(delim);
      let flags = "";
      if (script[i] === "I") {
        flags = "i";
        i++;
      }
      return { type: "re", re: new RegExp(posixRegex(src, extended), flags) };
    }
    return undefined;
  };
  while (i < script.length) {
    skipWs();
    if (i >= script.length) break;
    const a1 = readAddr();
    let a2: SedAddr | undefined;
    if (a1 && script[i] === ",") {
      i++;
      a2 = readAddr();
    }
    while (script[i] === " ") i++;
    let negate = false;
    if (script[i] === "!") {
      negate = true;
      i++;
    }
    const cmd = script[i++];
    if (!cmd) throw new Error("missing command");
    const c: SedCmd = { a1, a2, negate, cmd };
    switch (cmd) {
      case "s": {
        const delim = script[i++];
        const pat = readDelimited(delim);
        const rep = readDelimited(delim);
        let flags = "";
        let global = false;
        let occurrence = 1;
        let print = false;
        while (i < script.length && /[gipI0-9]/.test(script[i])) {
          const fl = script[i++];
          if (fl === "g") global = true;
          else if (fl === "i" || fl === "I") flags += "i";
          else if (fl === "p") print = true;
          else occurrence = Number(fl);
        }
        c.re = new RegExp(posixRegex(pat, extended), flags + "g");
        c.replacement = rep;
        c.global = global;
        c.occurrence = occurrence;
        c.print = print;
        break;
      }
      case "y": {
        const delim = script[i++];
        c.from = readDelimited(delim);
        c.to = readDelimited(delim);
        if (c.from.length !== c.to.length) throw new Error("strings for `y' command are different lengths");
        break;
      }
      case "a":
      case "i":
      case "c": {
        if (script[i] === "\\") i++;
        while (script[i] === " " || script[i] === "\n") i++;
        let text = "";
        while (i < script.length && script[i] !== "\n" && script[i] !== ";") text += script[i++];
        c.text = text.replace(/\\n/g, "\n");
        break;
      }
      case "{": {
        let depth = 1;
        const start = i;
        while (i < script.length && depth) {
          if (script[i] === "{") depth++;
          else if (script[i] === "}") depth--;
          i++;
        }
        c.block = parseSed(script.slice(start, i - 1), extended);
        break;
      }
      case "d":
      case "p":
      case "q":
      case "=":
      case "n":
      case "N":
        break;
      default:
        throw new Error(`unknown command: \`${cmd}'`);
    }
    cmds.push(c);
  }
  return cmds;
}

function sedReplace(line: string, c: SedCmd): { out: string; did: boolean } {
  let n = 0;
  let did = false;
  const rep = (m: string, ...groups: unknown[]) => {
    n++;
    if (!c.global && n !== c.occurrence) return m;
    did = true;
    const caps = groups.slice(0, -2) as (string | undefined)[];
    return c.replacement!.replace(/\\(\d)|&|\\n|\\t|\\&/g, (t, d) => {
      if (t === "&") return m;
      if (t === "\\&") return "&";
      if (t === "\\n") return "\n";
      if (t === "\\t") return "\t";
      return caps[Number(d) - 1] ?? "";
    });
  };
  c.re!.lastIndex = 0;
  const out = line.replace(c.re!, rep);
  return { out, did };
}

function sed(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "nEr", withValue: "ef", long: { quiet: "n", silent: "n", "expression=": "e", "regexp-extended": "E", "in-place": "i", "in-place=": "i" } }, (o) => {
    let scripts = o.multi.e ?? [];
    let operands = o.operands;
    // -i may be passed as -i or -i.bak (handled manually)
    let inPlace = o.flags.has("i") || o.values.i !== undefined;
    const rawArgs = ctx.args;
    if (rawArgs.some((a) => /^-[^-]*i/.test(a) && !a.startsWith("--"))) inPlace = true;
    if (!scripts.length) {
      if (!operands.length) {
        ctx.err("Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n");
        return 1;
      }
      scripts = [operands[0]];
      operands = operands.slice(1);
    }
    let program: SedCmd[];
    try {
      program = parseSed(scripts.join("\n"), o.flags.has("E") || o.flags.has("r"));
    } catch (e) {
      ctx.err(`sed: -e expression #1, char ${scripts[0].length}: ${(e as Error).message}\n`);
      return 1;
    }
    const quiet = o.flags.has("n");
    const process = (content: string): string => {
      const ls = lines(content);
      let out = "";
      const rangeActive = new Map<SedCmd, boolean>();
      const matchAddr = (a: SedAddr, idx: number, line: string) =>
        a.type === "line" ? idx + 1 === a.n : a.type === "last" ? idx === ls.length - 1 : a.re.test(line);
      const selected = (c: SedCmd, idx: number, line: string): boolean => {
        let sel: boolean;
        if (!c.a1) sel = true;
        else if (!c.a2) sel = matchAddr(c.a1, idx, line);
        else {
          if (rangeActive.get(c)) {
            sel = true;
            const end = c.a2.type === "line" ? idx + 1 >= c.a2.n : matchAddr(c.a2, idx, line);
            if (end) rangeActive.set(c, false);
          } else if (matchAddr(c.a1, idx, line)) {
            sel = true;
            const endNow = c.a2.type === "line" ? idx + 1 >= c.a2.n : false;
            rangeActive.set(c, !endNow);
          } else sel = false;
        }
        return c.negate ? !sel : sel;
      };
      let quit = false;
      for (let idx = 0; idx < ls.length && !quit; idx++) {
        let line = ls[idx];
        let deleted = false;
        const appendAfter: string[] = [];
        const run = (cmds: SedCmd[]): void => {
          for (const c of cmds) {
            if (deleted || quit) return;
            if (!selected(c, idx, line)) continue;
            switch (c.cmd) {
              case "s": {
                const r = sedReplace(line, c);
                line = r.out;
                if (r.did && c.print) out += line + "\n";
                break;
              }
              case "y":
                line = [...line].map((ch) => {
                  const k = c.from!.indexOf(ch);
                  return k === -1 ? ch : c.to![k];
                }).join("");
                break;
              case "d":
                deleted = true;
                return;
              case "p":
                out += line + "\n";
                break;
              case "=":
                out += idx + 1 + "\n";
                break;
              case "a":
                appendAfter.push(c.text!);
                break;
              case "i":
                out += c.text + "\n";
                break;
              case "c":
                out += c.text + "\n";
                deleted = true;
                return;
              case "q":
                quit = true;
                return;
              case "{":
                run(c.block!);
                break;
            }
          }
        };
        run(program);
        if (!deleted && !quiet) out += line + "\n";
        for (const a of appendAfter) out += a + "\n";
        if (quit && !quiet && deleted) break;
      }
      return out;
    };
    let status = 0;
    if (inPlace) {
      for (const f of operands) {
        try {
          const node = resolve(ctx, f);
          if (node.type === "dir") throw new FsError("EISDIR");
          if (!canAccess(node, ctx.who, R)) throw new FsError("EACCES");
          const parent = ctx.fs.get(node.parentId!)!;
          if (!canAccess(node, ctx.who, W) && !canAccess(parent, ctx.who, W)) throw new FsError("EACCES");
          ctx.fs.writeContent(node, process(readNode(ctx, node)), false, ctx.now);
        } catch (e) {
          ctx.err(`sed: couldn't edit ${f}: ${errMsg(e) === "No such file or directory" ? "not a regular file" : errMsg(e)}\n`);
          status = 4;
        }
      }
      return status;
    }
    for (const { content } of readInputs(ctx, operands, (f, e) => {
      ctx.err(`sed: can't read ${f}: ${errMsg(e)}\n`);
      status = 2;
    })) {
      ctx.out(process(content));
    }
    return status;
  });
}

// -------------------------------------------------------------------- diff

function diff(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "uqsiwB", long: { unified: "u", brief: "q" } }, (o) => {
    if (o.operands.length !== 2) {
      ctx.err(o.operands.length < 2 ? `diff: missing operand after '${o.operands[0] ?? "diff"}'\ndiff: Try 'diff --help' for more information.\n` : `diff: extra operand '${o.operands[2]}'\n`);
      return 2;
    }
    const [fa, fb] = o.operands;
    let a: string;
    let b: string;
    try {
      const na = resolve(ctx, fa);
      const nb = resolve(ctx, fb);
      if (!ctx.shell.canRead(na) || !ctx.shell.canRead(nb)) throw new FsError("EACCES");
      a = readNode(ctx, na);
      b = readNode(ctx, nb);
    } catch (e) {
      ctx.err(`diff: ${errMsg(e)}\n`);
      return 2;
    }
    const norm = (l: string) => (o.flags.has("i") ? l.toLowerCase() : l).replace(o.flags.has("w") ? /\s+/g : /$^/, "");
    const A = lines(a);
    const B = lines(b);
    if (A.length === B.length && A.every((l, i) => norm(l) === norm(B[i]))) {
      if (o.flags.has("s")) ctx.out(`Files ${fa} and ${fb} are identical\n`);
      return 0;
    }
    if (o.flags.has("q")) {
      ctx.out(`Files ${fa} and ${fb} differ\n`);
      return 1;
    }
    // LCS table
    const n = A.length;
    const m = B.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = norm(A[i]) === norm(B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops: { t: "=" | "-" | "+"; a: number; b: number }[] = [];
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && norm(A[i]) === norm(B[j])) ops.push({ t: "=", a: i++, b: j++ });
      else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) ops.push({ t: "+", a: i, b: j++ });
      else ops.push({ t: "-", a: i++, b: j });
    }
    if (o.flags.has("u")) {
      ctx.out(`--- ${fa}\n+++ ${fb}\n`);
      ctx.out(`@@ -1,${n} +1,${m} @@\n`);
      for (const op of ops) ctx.out(op.t === "=" ? ` ${A[op.a]}\n` : op.t === "-" ? `-${A[op.a]}\n` : `+${B[op.b]}\n`);
      return 1;
    }
    const range = (s: number, e: number) => (e - s <= 1 ? String(s + 1) : `${s + 1},${e}`);
    let k = 0;
    while (k < ops.length) {
      if (ops[k].t === "=") {
        k++;
        continue;
      }
      const startA = ops[k].a;
      const startB = ops[k].b;
      const dels: string[] = [];
      const adds: string[] = [];
      while (k < ops.length && ops[k].t !== "=") {
        if (ops[k].t === "-") dels.push(A[ops[k].a]);
        else adds.push(B[ops[k].b]);
        k++;
      }
      if (dels.length && adds.length) ctx.out(`${range(startA, startA + dels.length)}c${range(startB, startB + adds.length)}\n`);
      else if (dels.length) ctx.out(`${range(startA, startA + dels.length)}d${startB}\n`);
      else ctx.out(`${startA}a${range(startB, startB + adds.length)}\n`);
      for (const d of dels) ctx.out(`< ${d}\n`);
      if (dels.length && adds.length) ctx.out("---\n");
      for (const ad of adds) ctx.out(`> ${ad}\n`);
    }
    return 1;
  });
}

// ------------------------------------------------------------------- misc

function xargs(ctx: CommandContext): number {
  let i = 0;
  let maxArgs = Infinity;
  let replace: string | null = null;
  while (i < ctx.args.length && ctx.args[i].startsWith("-")) {
    const a = ctx.args[i];
    if (a === "-n") maxArgs = Number(ctx.args[++i]);
    else if (a.startsWith("-n")) maxArgs = Number(a.slice(2));
    else if (a === "-I") replace = ctx.args[++i];
    else if (a.startsWith("-I")) replace = a.slice(2);
    else if (a === "-0" || a === "-r" || a === "-t") {
      /* accepted */
    } else break;
    i++;
  }
  const cmd = ctx.args.slice(i);
  if (!cmd.length) cmd.push("echo");
  const input = ctx.readAllStdin();
  const io = { stdin: { data: "", pos: 0, tty: false }, stdout: { tty: ctx.stdoutIsTTY, write: ctx.out }, stderr: { tty: true, write: ctx.err } };
  let status = 0;
  if (replace !== null) {
    for (const line of lines(input)) {
      if (!line.trim()) continue;
      const r = ctx.shell.runArgv(cmd.map((c) => c.split(replace!).join(line.trim())), io);
      if (r !== 0) status = 123;
    }
    return status;
  }
  const items = input.split(/\s+/).filter(Boolean);
  if (!items.length && ctx.args.includes("-r")) return 0;
  for (let k = 0; k < Math.max(1, items.length); k += maxArgs === Infinity ? Math.max(1, items.length) : maxArgs) {
    const chunk = items.slice(k, maxArgs === Infinity ? undefined : k + maxArgs);
    const r = ctx.shell.runArgv([...cmd, ...chunk], io);
    if (r !== 0) status = r === 127 ? 127 : 123;
  }
  return status;
}

function seq(ctx: CommandContext): number {
  let sep = "\n";
  let width = false;
  const nums: string[] = [];
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === "-s") sep = ctx.args[++i] ?? "\n";
    else if (a === "-w") width = true;
    else nums.push(a);
  }
  if (!nums.length) {
    ctx.err("seq: missing operand\nTry 'seq --help' for more information.\n");
    return 1;
  }
  for (const n of nums) {
    if (Number.isNaN(Number(n))) {
      ctx.err(`seq: invalid floating point argument: ‘${n}’\nTry 'seq --help' for more information.\n`);
      return 1;
    }
  }
  const [first, inc, last] = nums.length === 1 ? [1, 1, Number(nums[0])] : nums.length === 2 ? [Number(nums[0]), 1, Number(nums[1])] : [Number(nums[0]), Number(nums[1]), Number(nums[2])];
  if (inc === 0) {
    ctx.err("seq: invalid Zero increment value: ‘0’\n");
    return 1;
  }
  const out: string[] = [];
  const decimals = Math.max(...nums.map((n) => (n.split(".")[1] ?? "").length));
  for (let v = first; inc > 0 ? v <= last + 1e-9 : v >= last - 1e-9; v += inc) {
    out.push(decimals ? v.toFixed(decimals) : String(Math.round(v)));
    if (out.length > 100000) break;
  }
  const w = width ? Math.max(...out.map((s) => s.length)) : 0;
  ctx.out(out.map((s) => s.padStart(w, "0")).join(sep) + (out.length ? "\n" : ""));
  return 0;
}

function hashSum(ctx: CommandContext, algo: "md5" | "sha1" | "sha256"): number {
  let status = 0;
  const files = ctx.args.filter((a) => !a.startsWith("-"));
  for (const { name, content } of readInputs(ctx, files, (f, e) => {
    ctx.err(`${ctx.name}: ${f}: ${errMsg(e)}\n`);
    status = 1;
  })) {
    ctx.out(`${createHash(algo).update(content).digest("hex")}  ${name}\n`);
  }
  return status;
}

function base64(ctx: CommandContext): number {
  const decode = ctx.args.includes("-d") || ctx.args.includes("--decode");
  const files = ctx.args.filter((a) => !a.startsWith("-"));
  let status = 0;
  for (const { content } of readInputs(ctx, files, fileErr(ctx, "base64"))) {
    if (decode) {
      try {
        ctx.out(Buffer.from(content.replace(/\s+/g, ""), "base64").toString("utf8"));
      } catch {
        ctx.err("base64: invalid input\n");
        status = 1;
      }
    } else {
      const enc = Buffer.from(content, "utf8").toString("base64");
      ctx.out((enc.match(/.{1,76}/g) ?? [""]).join("\n") + "\n");
    }
  }
  return status;
}

export const textCommands: CommandDef[] = [
  {
    name: "cat",
    category: "basics",
    description: "Concatenate files and print them on the standard output.",
    syntax: "cat [OPTION]... [FILE]...",
    options: [
      { flag: "-n", description: "number all output lines" },
      { flag: "-b", description: "number non-empty lines" },
      { flag: "-A", description: "show tabs and line ends" },
    ],
    examples: [
      { command: "cat documents/welcome.txt", description: "Show a file" },
      { command: "cat a.txt b.txt > both.txt", description: "Join two files" },
    ],
    permissions: "Requires read (r) permission on the file.",
    run: cat,
  },
  { name: "tac", category: "text", description: "Print files in reverse line order.", syntax: "tac [FILE]...", run: tac },
  {
    name: "less",
    aliases: ["more"],
    category: "basics",
    description: "View file contents (the simulator prints the whole file).",
    syntax: "less FILE",
    examples: [{ command: "less /etc/passwd", description: "Read a long file" }],
    run: (ctx) => cat({ ...ctx, args: ctx.args.filter((a) => !a.startsWith("-")), name: ctx.name }),
  },
  {
    name: "head",
    category: "basics",
    description: "Output the first part of files.",
    syntax: "head [-n N] [FILE]...",
    options: [{ flag: "-n N", description: "print the first N lines (default 10)" }],
    examples: [{ command: "head -n 5 /etc/passwd", description: "First 5 lines" }],
    run: (ctx) => headTail(ctx, true),
  },
  {
    name: "tail",
    category: "basics",
    description: "Output the last part of files.",
    syntax: "tail [-n N] [FILE]...",
    options: [
      { flag: "-n N", description: "print the last N lines (default 10)" },
      { flag: "-n +N", description: "print starting from line N" },
      { flag: "-f", description: "follow (the simulator prints and exits)" },
    ],
    examples: [{ command: "sudo tail -n 20 /var/log/auth.log", description: "Recent authentication events" }],
    run: (ctx) => headTail(ctx, false),
  },
  {
    name: "wc",
    category: "text",
    description: "Print newline, word, and byte counts for each file.",
    syntax: "wc [-lwcm] [FILE]...",
    options: [
      { flag: "-l", description: "count lines" },
      { flag: "-w", description: "count words" },
      { flag: "-c", description: "count bytes" },
    ],
    examples: [{ command: "wc -l /etc/passwd", description: "How many accounts exist?" }],
    run: wc,
  },
  {
    name: "sort",
    category: "text",
    description: "Sort lines of text files.",
    syntax: "sort [-rnu] [-k KEY] [-t SEP] [FILE]...",
    options: [
      { flag: "-r", description: "reverse order" },
      { flag: "-n", description: "numeric sort" },
      { flag: "-u", description: "unique lines only" },
      { flag: "-k N", description: "sort by field N" },
      { flag: "-t C", description: "field separator" },
    ],
    examples: [{ command: "sort -t: -k3 -n /etc/passwd", description: "Accounts ordered by UID" }],
    run: sortCmd,
  },
  {
    name: "uniq",
    category: "text",
    description: "Report or omit repeated adjacent lines.",
    syntax: "uniq [-cdu] [INPUT [OUTPUT]]",
    examples: [{ command: "sort names.txt | uniq -c", description: "Count duplicates" }],
    run: uniq,
  },
  {
    name: "cut",
    category: "text",
    description: "Remove sections from each line of files.",
    syntax: "cut -d DELIM -f FIELDS [FILE]...",
    examples: [{ command: "cut -d: -f1 /etc/passwd", description: "List all usernames" }],
    run: cut,
  },
  {
    name: "tr",
    category: "text",
    description: "Translate or delete characters.",
    syntax: "tr [-ds] SET1 [SET2]",
    examples: [{ command: "echo hello | tr a-z A-Z", description: "Convert to upper case" }],
    run: tr,
  },
  {
    name: "tee",
    category: "text",
    description: "Read from standard input and write to standard output and files.",
    syntax: "tee [-a] FILE...",
    examples: [{ command: 'echo "127.0.0.1 web.local" | sudo tee -a /etc/hosts', description: "Append to a root-owned file" }],
    run: tee,
  },
  {
    name: "grep",
    aliases: ["egrep", "fgrep"],
    category: "basics",
    description: "Print lines that match patterns.",
    syntax: "grep [OPTION]... PATTERN [FILE]...",
    options: [
      { flag: "-i", description: "ignore case" },
      { flag: "-v", description: "invert match (lines that do NOT match)" },
      { flag: "-n", description: "show line numbers" },
      { flag: "-r", description: "search directories recursively" },
      { flag: "-c", description: "count matching lines" },
      { flag: "-l", description: "only print names of matching files" },
      { flag: "-w", description: "match whole words" },
      { flag: "-E", description: "extended regular expressions" },
    ],
    examples: [
      { command: "grep student /etc/passwd", description: "Find a user entry" },
      { command: "grep -rn TODO ~/projects", description: "Search a project" },
      { command: "ps aux | grep nginx", description: "Filter command output" },
    ],
    run: grep,
  },
  {
    name: "sed",
    category: "text",
    description: "Stream editor for filtering and transforming text.",
    syntax: "sed [-n] [-i] [-E] SCRIPT [FILE]...",
    options: [
      { flag: "s/OLD/NEW/g", description: "substitute text" },
      { flag: "-n '5p'", description: "print only line 5" },
      { flag: "'/pattern/d'", description: "delete matching lines" },
      { flag: "-i", description: "edit files in place" },
    ],
    examples: [
      { command: "sed 's/Linux/GNU\\/Linux/g' notes.txt", description: "Replace text in the output" },
      { command: "sed -i 's/8080/80/' app.conf", description: "Edit a file in place" },
    ],
    run: sed,
  },
  {
    name: "awk",
    aliases: ["mawk", "gawk"],
    category: "text",
    description: "Pattern scanning and processing language (common subset).",
    syntax: "awk [-F SEP] [-v VAR=VAL] 'PROGRAM' [FILE]...",
    examples: [
      { command: "awk -F: '{print $1}' /etc/passwd", description: "Print the first field" },
      { command: "awk -F: '$3 >= 1000 {print $1, $3}' /etc/passwd", description: "Regular users and their UIDs" },
      { command: "awk '{sum += $2} END {print sum}' data.txt", description: "Sum a column" },
    ],
    run: awkCommand,
  },
  { name: "diff", category: "text", description: "Compare files line by line.", syntax: "diff [-u] FILE1 FILE2", examples: [{ command: "diff old.conf new.conf", description: "Show differences" }], run: diff },
  { name: "xargs", category: "text", description: "Build and execute command lines from standard input.", syntax: "xargs [-n N] [-I REPL] [COMMAND [ARGS]]", examples: [{ command: 'find . -name "*.tmp" | xargs rm', description: "Delete found files" }], run: xargs },
  {
    name: "nl",
    category: "text",
    description: "Number lines of files.",
    syntax: "nl [FILE]...",
    run: (ctx) => {
      let n = 1;
      for (const { content } of readInputs(ctx, ctx.args.filter((a) => !a.startsWith("-")), fileErr(ctx, "nl"))) {
        ctx.out(joinLines(lines(content).map((l) => (l.trim() === "" ? "" : `${String(n++).padStart(6)}\t${l}`))));
      }
      return 0;
    },
  },
  {
    name: "rev",
    category: "text",
    description: "Reverse lines characterwise.",
    syntax: "rev [FILE]...",
    run: (ctx) => {
      for (const { content } of readInputs(ctx, ctx.args, fileErr(ctx, "rev"))) ctx.out(joinLines(lines(content).map((l) => [...l].reverse().join(""))));
      return 0;
    },
  },
  { name: "seq", category: "scripting", description: "Print a sequence of numbers.", syntax: "seq [FIRST [INCREMENT]] LAST", examples: [{ command: "seq 1 5", description: "Print 1 to 5" }], run: seq },
  { name: "md5sum", category: "security", description: "Compute MD5 message digest.", syntax: "md5sum [FILE]...", run: (ctx) => hashSum(ctx, "md5") },
  { name: "sha1sum", category: "security", hidden: true, description: "Compute SHA1 message digest.", syntax: "sha1sum [FILE]...", run: (ctx) => hashSum(ctx, "sha1") },
  { name: "sha256sum", category: "security", description: "Compute SHA256 message digest (verify downloads).", syntax: "sha256sum [FILE]...", examples: [{ command: "sha256sum backup.tar", description: "Fingerprint a file" }], run: (ctx) => hashSum(ctx, "sha256") },
  { name: "base64", category: "text", description: "Base64 encode/decode data.", syntax: "base64 [-d] [FILE]", run: base64 },
];
