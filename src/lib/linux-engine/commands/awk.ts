/**
 * A compact awk interpreter covering the subset used in Linux courses:
 * patterns, BEGIN/END, fields, NR/NF/FS/OFS, print/printf, variables,
 * associative arrays, if/while/for/for-in, and common string functions.
 */
import { printfFormat } from "./builtins";
import { errMsg, readInputs } from "./helpers";
import { posixRegex } from "./text";
import type { CommandContext } from "./types";

type Val = string | number;

type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "re"; v: RegExp }
  | { k: "field"; e: Expr }
  | { k: "var"; name: string }
  | { k: "idx"; name: string; keys: Expr[] }
  | { k: "assign"; op: string; target: Expr; e: Expr }
  | { k: "bin"; op: string; a: Expr; b: Expr }
  | { k: "un"; op: string; e: Expr }
  | { k: "incdec"; op: string; prefix: boolean; target: Expr }
  | { k: "tern"; c: Expr; a: Expr; b: Expr }
  | { k: "call"; name: string; args: Expr[] }
  | { k: "in"; key: Expr; arr: string }
  | { k: "group"; e: Expr };

type Stmt =
  | { k: "print"; args: Expr[]; printf: boolean }
  | { k: "expr"; e: Expr }
  | { k: "if"; c: Expr; t: Stmt; f?: Stmt }
  | { k: "while"; c: Expr; body: Stmt }
  | { k: "for"; init?: Stmt; c?: Expr; step?: Stmt; body: Stmt }
  | { k: "forin"; v: string; arr: string; body: Stmt }
  | { k: "block"; body: Stmt[] }
  | { k: "next" }
  | { k: "exit"; e?: Expr }
  | { k: "break" }
  | { k: "continue" }
  | { k: "delete"; arr: string; keys?: Expr[] };

interface Rule {
  pattern: "BEGIN" | "END" | Expr | null;
  action: Stmt[] | null;
}

class AwkError extends Error {}

const TOKEN = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)|("(?:\\.|[^"\\])*")|([A-Za-z_][A-Za-z0-9_]*)|(\+\+|--|\+=|-=|\*=|\/=|%=|\^=|==|!=|<=|>=|&&|\|\||!~|[-+*/%^!<>=~?:,;(){}[\]$]|\n))/y;

function tokenize(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  const prevAllowsRegex = () => {
    const p = out[out.length - 1];
    return p === undefined || /^[(,;{}!~&|=+\-*%<>?:\n]$|^(&&|\|\||==|!=|<=|>=|!~|\+=|-=|print|printf|return)$/.test(p);
  };
  while (i < src.length) {
    const ws = /^[ \t]+|^\\\n/.exec(src.slice(i));
    if (ws) {
      i += ws[0].length;
      continue;
    }
    if (src[i] === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (src[i] === "/" && prevAllowsRegex()) {
      let j = i + 1;
      let re = "";
      while (j < src.length && src[j] !== "/") {
        if (src[j] === "\\" && j + 1 < src.length) {
          re += src[j] + src[j + 1];
          j += 2;
          continue;
        }
        re += src[j++];
      }
      out.push("/" + re + "/");
      i = j + 1;
      continue;
    }
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) throw new AwkError(`syntax error at source line 1 near "${src.slice(i, i + 10)}"`);
    out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
    i = TOKEN.lastIndex;
  }
  return out;
}

class AwkParser {
  i = 0;
  constructor(private t: string[]) {}
  peek(o = 0) {
    return this.t[this.i + o];
  }
  eat(v?: string) {
    const tok = this.t[this.i];
    if (v !== undefined && tok !== v) throw new AwkError(`syntax error: expected '${v}' but found '${tok ?? "end of program"}'`);
    this.i++;
    return tok;
  }
  skipNl() {
    while (this.peek() === "\n" || this.peek() === ";") this.i++;
  }
  skipNewlinesOnly() {
    while (this.peek() === "\n") this.i++;
  }

  program(): Rule[] {
    const rules: Rule[] = [];
    this.skipNl();
    while (this.i < this.t.length) {
      let pattern: Rule["pattern"] = null;
      if (this.peek() === "BEGIN" || this.peek() === "END") pattern = this.eat() as "BEGIN" | "END";
      else if (this.peek() !== "{") pattern = this.expr();
      let action: Stmt[] | null = null;
      if (this.peek() === "{") action = this.block();
      rules.push({ pattern, action });
      this.skipNl();
    }
    return rules;
  }

  block(): Stmt[] {
    this.eat("{");
    const body: Stmt[] = [];
    this.skipNl();
    while (this.peek() !== "}") {
      if (this.peek() === undefined) throw new AwkError("syntax error: unexpected end of program");
      body.push(this.stmt());
      this.skipNl();
    }
    this.eat("}");
    return body;
  }

  simpleOrBlock(): Stmt {
    this.skipNewlinesOnly();
    if (this.peek() === "{") return { k: "block", body: this.block() };
    const s = this.stmt();
    if (this.peek() === ";") this.i++;
    return s;
  }

  stmt(): Stmt {
    const t = this.peek();
    switch (t) {
      case "{":
        return { k: "block", body: this.block() };
      case "print":
      case "printf": {
        this.i++;
        const args: Expr[] = [];
        const hasParen = this.peek() === "(";
        if (!this.endOfSimple()) {
          if (hasParen) {
            // print (a, b) form
            const save = this.i;
            this.i++;
            const list = [this.expr(true)];
            while (this.peek() === ",") {
              this.i++;
              list.push(this.expr(true));
            }
            if (this.peek() === ")" && this.endOfSimpleAt(this.i + 1)) {
              this.i++;
              args.push(...list);
            } else {
              this.i = save;
              args.push(this.expr(true));
              while (this.peek() === ",") {
                this.i++;
                args.push(this.expr(true));
              }
            }
          } else {
            args.push(this.expr(true));
            while (this.peek() === ",") {
              this.i++;
              args.push(this.expr(true));
            }
          }
        }
        return { k: "print", args, printf: t === "printf" };
      }
      case "if": {
        this.i++;
        this.eat("(");
        const c = this.expr();
        this.eat(")");
        const tStmt = this.simpleOrBlock();
        this.skipNl();
        if (this.peek() === "else") {
          this.i++;
          return { k: "if", c, t: tStmt, f: this.simpleOrBlock() };
        }
        return { k: "if", c, t: tStmt };
      }
      case "while": {
        this.i++;
        this.eat("(");
        const c = this.expr();
        this.eat(")");
        return { k: "while", c, body: this.simpleOrBlock() };
      }
      case "for": {
        this.i++;
        this.eat("(");
        if (/^[A-Za-z_]/.test(this.peek()) && this.peek(1) === "in") {
          const v = this.eat();
          this.eat("in");
          const arr = this.eat();
          this.eat(")");
          return { k: "forin", v, arr, body: this.simpleOrBlock() };
        }
        const init = this.peek() === ";" ? undefined : ({ k: "expr", e: this.expr() } as Stmt);
        this.eat(";");
        const c = this.peek() === ";" ? undefined : this.expr();
        this.eat(";");
        const step = this.peek() === ")" ? undefined : ({ k: "expr", e: this.expr() } as Stmt);
        this.eat(")");
        return { k: "for", init, c, step, body: this.simpleOrBlock() };
      }
      case "next":
        this.i++;
        return { k: "next" };
      case "break":
        this.i++;
        return { k: "break" };
      case "continue":
        this.i++;
        return { k: "continue" };
      case "exit": {
        this.i++;
        return { k: "exit", e: this.endOfSimple() ? undefined : this.expr() };
      }
      case "delete": {
        this.i++;
        const arr = this.eat();
        if (this.peek() === "[") {
          this.i++;
          const keys = [this.expr()];
          while (this.peek() === ",") {
            this.i++;
            keys.push(this.expr());
          }
          this.eat("]");
          return { k: "delete", arr, keys };
        }
        return { k: "delete", arr };
      }
    }
    return { k: "expr", e: this.expr() };
  }

  endOfSimple() {
    return this.endOfSimpleAt(this.i);
  }
  endOfSimpleAt(i: number) {
    const t = this.t[i];
    return t === undefined || t === ";" || t === "\n" || t === "}" || t === ">" || t === ">>" || t === "|";
  }

  expr(noGt = false): Expr {
    return this.ternary(noGt);
  }

  ternary(noGt: boolean): Expr {
    const c = this.or(noGt);
    if (this.peek() === "?") {
      this.i++;
      const a = this.ternary(noGt);
      this.eat(":");
      const b = this.ternary(noGt);
      return { k: "tern", c, a, b };
    }
    if (["=", "+=", "-=", "*=", "/=", "%=", "^="].includes(this.peek()) && (c.k === "var" || c.k === "field" || c.k === "idx")) {
      const op = this.eat();
      return { k: "assign", op, target: c, e: this.ternary(noGt) };
    }
    return c;
  }

  or(noGt: boolean): Expr {
    let a = this.and(noGt);
    while (this.peek() === "||") {
      this.i++;
      this.skipNewlinesOnly();
      a = { k: "bin", op: "||", a, b: this.and(noGt) };
    }
    return a;
  }

  and(noGt: boolean): Expr {
    let a = this.inExpr(noGt);
    while (this.peek() === "&&") {
      this.i++;
      this.skipNewlinesOnly();
      a = { k: "bin", op: "&&", a, b: this.inExpr(noGt) };
    }
    return a;
  }

  inExpr(noGt: boolean): Expr {
    const a = this.match(noGt);
    if (this.peek() === "in") {
      this.i++;
      return { k: "in", key: a, arr: this.eat() };
    }
    return a;
  }

  match(noGt: boolean): Expr {
    let a = this.compare(noGt);
    while (this.peek() === "~" || this.peek() === "!~") {
      const op = this.eat();
      a = { k: "bin", op, a, b: this.compare(noGt) };
    }
    return a;
  }

  compare(noGt: boolean): Expr {
    const a = this.concat(noGt);
    const op = this.peek();
    if (["<", "<=", "==", "!=", ">=", ...(noGt ? [] : [">"])].includes(op)) {
      this.i++;
      return { k: "bin", op, a, b: this.concat(noGt) };
    }
    return a;
  }

  concat(noGt: boolean): Expr {
    let a = this.additive();
    while (this.startsPrimary()) {
      a = { k: "bin", op: "concat", a, b: this.additive() };
    }
    void noGt;
    return a;
  }

  startsPrimary(): boolean {
    const t = this.peek();
    if (t === undefined) return false;
    if (t === "in" || t === "getline") return false;
    return /^\d/.test(t) || t.startsWith('"') || /^[A-Za-z_]/.test(t) || t === "$" || t === "(" || t === "!" || t === "++" || t === "--" || (t.startsWith("/") && t.length > 1 && t.endsWith("/"));
  }

  additive(): Expr {
    let a = this.mult();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.eat();
      a = { k: "bin", op, a, b: this.mult() };
    }
    return a;
  }

  mult(): Expr {
    let a = this.unary();
    while (this.peek() === "*" || this.peek() === "/" || this.peek() === "%") {
      const op = this.eat();
      a = { k: "bin", op, a, b: this.unary() };
    }
    return a;
  }

  unary(): Expr {
    const t = this.peek();
    if (t === "!" || t === "-" || t === "+") {
      this.i++;
      return { k: "un", op: t, e: this.unary() };
    }
    return this.power();
  }

  power(): Expr {
    const a = this.postfix();
    if (this.peek() === "^") {
      this.i++;
      return { k: "bin", op: "^", a, b: this.unary() };
    }
    return a;
  }

  postfix(): Expr {
    const t = this.peek();
    if (t === "++" || t === "--") {
      this.i++;
      return { k: "incdec", op: t, prefix: true, target: this.primary() };
    }
    const p = this.primary();
    if ((this.peek() === "++" || this.peek() === "--") && (p.k === "var" || p.k === "idx" || p.k === "field")) {
      return { k: "incdec", op: this.eat(), prefix: false, target: p };
    }
    return p;
  }

  primary(): Expr {
    const t = this.eat();
    if (t === undefined) throw new AwkError("syntax error: unexpected end of program");
    if (/^\d/.test(t)) return { k: "num", v: Number(t) };
    if (t.startsWith('"')) return { k: "str", v: unescape(t.slice(1, -1)) };
    if (t.startsWith("/") && t.length > 1) return { k: "re", v: new RegExp(posixRegex(t.slice(1, -1), true)) };
    if (t === "$") return { k: "field", e: this.postfixNoInc() };
    if (t === "(") {
      const e = this.expr();
      this.eat(")");
      return { k: "group", e };
    }
    if (/^[A-Za-z_]/.test(t)) {
      if (this.peek() === "(") {
        this.i++;
        const args: Expr[] = [];
        if (this.peek() !== ")") {
          args.push(this.expr());
          while (this.peek() === ",") {
            this.i++;
            args.push(this.expr());
          }
        }
        this.eat(")");
        return { k: "call", name: t, args };
      }
      if (this.peek() === "[") {
        this.i++;
        const keys = [this.expr()];
        while (this.peek() === ",") {
          this.i++;
          keys.push(this.expr());
        }
        this.eat("]");
        return { k: "idx", name: t, keys };
      }
      if (t === "length") return { k: "call", name: "length", args: [] };
      return { k: "var", name: t };
    }
    throw new AwkError(`syntax error at source line 1 near "${t}"`);
  }

  postfixNoInc(): Expr {
    const t = this.peek();
    if (t === "(") return this.primary();
    if (t === "-") {
      this.i++;
      return { k: "un", op: "-", e: this.primary() };
    }
    return this.primary();
  }
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, (_, c: string) => ({ n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "/": "/" })[c] ?? "\\" + c);
}

const toNum = (v: Val): number => {
  if (typeof v === "number") return v;
  const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(v);
  return m ? Number(m[0]) : 0;
};
const looksNumeric = (v: Val) => typeof v === "number" || /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(v);
const toStr = (v: Val, fmt = "%.6g"): string => {
  if (typeof v === "string") return v;
  if (Number.isInteger(v)) return String(v);
  return fmt === "%.6g" ? String(Number(v.toPrecision(6))) : String(v);
};

class NextSignal {}
class ExitSig {
  constructor(public code: number) {}
}
class BreakSig {}
class ContinueSig {}

export function awkCommand(ctx: CommandContext): number {
  let fs = " ";
  const vars: Record<string, Val> = {};
  const arrays: Record<string, Record<string, Val>> = {};
  let i = 0;
  let program: string | undefined;
  const files: string[] = [];
  while (i < ctx.args.length) {
    const a = ctx.args[i];
    if (a === "-F") fs = ctx.args[++i] ?? " ";
    else if (a.startsWith("-F")) fs = a.slice(2);
    else if (a === "-v") {
      const [k, ...v] = (ctx.args[++i] ?? "").split("=");
      vars[k] = unescape(v.join("="));
    } else if (a === "-f") {
      ctx.err("awk: -f is not supported in the simulator; pass the program inline\n");
      return 2;
    } else if (program === undefined) program = a;
    else if (/^[A-Za-z_]\w*=/.test(a)) {
      const [k, ...v] = a.split("=");
      vars[k] = v.join("=");
    } else files.push(a);
    i++;
  }
  if (program === undefined) {
    ctx.err("usage: awk [-F fs][-v var=value][prog | -f progfile][file ...]\n");
    return 2;
  }
  if (fs === "t" || fs === "\\t") fs = "\t";
  let rules: Rule[];
  try {
    rules = new AwkParser(tokenize(program)).program();
  } catch (e) {
    ctx.err(`awk: ${(e as Error).message}\n awk: line 1: ${program.split("\n")[0]}\n`);
    return 2;
  }

  vars.FS = fs;
  vars.OFS = vars.OFS ?? " ";
  vars.ORS = "\n";
  vars.NR = 0;
  vars.NF = 0;
  vars.FILENAME = "";
  let fields: string[] = [""];
  let steps = 0;

  const splitRecord = (rec: string) => {
    const sep = toStr(vars.FS);
    let parts: string[];
    if (sep === " ") parts = rec.trim() === "" ? [] : rec.trim().split(/[ \t\n]+/);
    else if (sep.length === 1) parts = rec === "" ? [] : rec.split(sep);
    else parts = rec === "" ? [] : rec.split(new RegExp(sep));
    fields = [rec, ...parts];
    vars.NF = parts.length;
  };
  const rebuild = () => {
    const nf = toNum(vars.NF);
    fields.length = Math.max(1, nf + 1);
    for (let k = 1; k <= nf; k++) if (fields[k] === undefined) fields[k] = "";
    fields[0] = fields.slice(1).join(toStr(vars.OFS));
  };

  const getField = (n: number): Val => {
    if (n < 0) throw new AwkError(`trying to access out of range field ${n}`);
    const v = fields[n] ?? "";
    return v;
  };
  const setField = (n: number, v: Val) => {
    if (n === 0) {
      splitRecord(toStr(v));
      return;
    }
    fields[n] = toStr(v);
    if (n > toNum(vars.NF)) vars.NF = n;
    rebuild();
  };
  const key = (keys: Expr[]) => keys.map((k) => toStr(ev(k))).join("\x1c");

  const assignTo = (target: Expr, v: Val) => {
    if (target.k === "var") vars[target.name] = v;
    else if (target.k === "field") setField(toNum(ev(target.e)), v);
    else if (target.k === "idx") (arrays[target.name] ??= {})[key(target.keys)] = v;
  };

  const callFn = (name: string, args: Expr[]): Val => {
    const a = (n: number) => (args[n] ? ev(args[n]) : "");
    switch (name) {
      case "length":
        if (args[0]?.k === "var" && arrays[args[0].name]) return Object.keys(arrays[args[0].name]).length;
        return toStr(args.length ? a(0) : fields[0]).length;
      case "substr": {
        const s = toStr(a(0));
        const start = Math.round(toNum(a(1)));
        const len = args[2] ? Math.round(toNum(a(2))) : Infinity;
        const from = Math.max(1, start);
        const to = len === Infinity ? s.length + 1 : start + len;
        return s.slice(from - 1, Math.max(from - 1, to - 1));
      }
      case "index":
        return toStr(a(0)).indexOf(toStr(a(1))) + 1;
      case "toupper":
        return toStr(a(0)).toUpperCase();
      case "tolower":
        return toStr(a(0)).toLowerCase();
      case "int":
        return Math.trunc(toNum(a(0)));
      case "sqrt":
        return Math.sqrt(toNum(a(0)));
      case "rand":
        return ctx.shell.random();
      case "srand":
        return 0;
      case "sprintf":
        return printfFormat(toStr(a(0)), args.slice(1).map((x) => toStr(ev(x))), () => {});
      case "split": {
        const s = toStr(a(0));
        const target = args[1];
        if (target?.k !== "var") throw new AwkError("split: second argument must be an array");
        const sep = args[2] ? ev(args[2]) : vars.FS;
        const parts = toStr(sep) === " " ? s.trim().split(/\s+/).filter(Boolean) : s.split(args[2]?.k === "re" ? (args[2] as { v: RegExp }).v : toStr(sep));
        arrays[target.name] = {};
        parts.forEach((p, idx) => (arrays[target.name][String(idx + 1)] = p));
        return parts.length;
      }
      case "sub":
      case "gsub": {
        const reE = args[0];
        const re = reE.k === "re" ? new RegExp(reE.v.source, name === "gsub" ? "g" : "") : new RegExp(posixRegex(toStr(ev(reE)), true), name === "gsub" ? "g" : "");
        const rep = toStr(a(1));
        const target = args[2] ?? ({ k: "field", e: { k: "num", v: 0 } } as Expr);
        const cur = toStr(ev(target));
        let count = 0;
        const next = cur.replace(re, (m) => {
          count++;
          return rep.replace(/\\&/g, "\u0000").replace(/&/g, m).replace(/\u0000/g, "&");
        });
        if (count) assignTo(target, next);
        return count;
      }
      case "match": {
        const reE = args[1];
        const re = reE.k === "re" ? reE.v : new RegExp(toStr(ev(reE)));
        const m = re.exec(toStr(a(0)));
        vars.RSTART = m ? m.index + 1 : 0;
        vars.RLENGTH = m ? m[0].length : -1;
        return vars.RSTART;
      }
      case "system": {
        return ctx.shell.evalText(toStr(a(0)), ctx.shell.ioFromContext(ctx));
      }
    }
    throw new AwkError(`calling undefined function ${name}`);
  };

  const ev = (e: Expr): Val => {
    if (++steps > 200000) throw new AwkError("execution limit reached");
    switch (e.k) {
      case "num":
        return e.v;
      case "str":
        return e.v;
      case "re":
        return e.v.test(fields[0]) ? 1 : 0;
      case "group":
        return ev(e.e);
      case "field":
        return getField(toNum(ev(e.e)));
      case "var":
        return vars[e.name] ?? "";
      case "idx":
        return (arrays[e.name] ??= {})[key(e.keys)] ?? "";
      case "in":
        return key([e.key]) in (arrays[e.arr] ?? {}) ? 1 : 0;
      case "assign": {
        let v = ev(e.e);
        if (e.op !== "=") {
          const cur = toNum(ev(e.target));
          const r = toNum(v);
          v = e.op === "+=" ? cur + r : e.op === "-=" ? cur - r : e.op === "*=" ? cur * r : e.op === "/=" ? cur / r : e.op === "%=" ? cur % r : cur ** r;
        }
        assignTo(e.target, v);
        return v;
      }
      case "incdec": {
        const cur = toNum(ev(e.target));
        const nv = e.op === "++" ? cur + 1 : cur - 1;
        assignTo(e.target, nv);
        return e.prefix ? nv : cur;
      }
      case "tern":
        return truthy(ev(e.c)) ? ev(e.a) : ev(e.b);
      case "un": {
        const v = ev(e.e);
        if (e.op === "!") return truthy(v) ? 0 : 1;
        if (e.op === "-") return -toNum(v);
        return toNum(v);
      }
      case "call":
        return callFn(e.name, e.args);
      case "bin": {
        if (e.op === "&&") return truthy(ev(e.a)) && truthy(ev(e.b)) ? 1 : 0;
        if (e.op === "||") return truthy(ev(e.a)) || truthy(ev(e.b)) ? 1 : 0;
        if (e.op === "~" || e.op === "!~") {
          const s = toStr(ev(e.a));
          const re = e.b.k === "re" ? e.b.v : new RegExp(posixRegex(toStr(ev(e.b)), true));
          const r = re.test(s);
          return (e.op === "~" ? r : !r) ? 1 : 0;
        }
        const a = ev(e.a);
        const b = ev(e.b);
        switch (e.op) {
          case "concat":
            return toStr(a) + toStr(b);
          case "+":
            return toNum(a) + toNum(b);
          case "-":
            return toNum(a) - toNum(b);
          case "*":
            return toNum(a) * toNum(b);
          case "/":
            if (toNum(b) === 0) throw new AwkError("division by zero");
            return toNum(a) / toNum(b);
          case "%":
            if (toNum(b) === 0) throw new AwkError("division by zero in %");
            return toNum(a) % toNum(b);
          case "^":
            return toNum(a) ** toNum(b);
        }
        const numeric = looksNumeric(a) && looksNumeric(b) && !(typeof a === "string" && a === "" ) && !(typeof b === "string" && b === "");
        const cmp = numeric ? toNum(a) - toNum(b) : toStr(a) < toStr(b) ? -1 : toStr(a) > toStr(b) ? 1 : 0;
        switch (e.op) {
          case "<":
            return cmp < 0 ? 1 : 0;
          case "<=":
            return cmp <= 0 ? 1 : 0;
          case ">":
            return cmp > 0 ? 1 : 0;
          case ">=":
            return cmp >= 0 ? 1 : 0;
          case "==":
            return cmp === 0 ? 1 : 0;
          case "!=":
            return cmp !== 0 ? 1 : 0;
        }
      }
    }
    throw new AwkError("internal error");
  };

  const truthy = (v: Val) => (typeof v === "number" ? v !== 0 : v !== "" && (!looksNumeric(v) || toNum(v) !== 0 || !/^\s*[-+]?0*\.?0*\s*$/.test(v)));

  const exec = (s: Stmt): void => {
    if (++steps > 200000) throw new AwkError("execution limit reached");
    switch (s.k) {
      case "print": {
        if (s.printf) {
          if (!s.args.length) throw new AwkError("printf: no format");
          ctx.out(printfFormat(toStr(ev(s.args[0])), s.args.slice(1).map((x) => toStr(ev(x))), () => {}));
          return;
        }
        const parts = s.args.length ? s.args.map((x) => toStr(ev(x))) : [fields[0]];
        ctx.out(parts.join(toStr(vars.OFS)) + toStr(vars.ORS));
        return;
      }
      case "expr":
        ev(s.e);
        return;
      case "if":
        if (truthy(ev(s.c))) exec(s.t);
        else if (s.f) exec(s.f);
        return;
      case "while":
        while (truthy(ev(s.c))) {
          try {
            exec(s.body);
          } catch (e) {
            if (e instanceof BreakSig) break;
            if (e instanceof ContinueSig) continue;
            throw e;
          }
        }
        return;
      case "for":
        if (s.init) exec(s.init);
        while (!s.c || truthy(ev(s.c))) {
          try {
            exec(s.body);
          } catch (e) {
            if (e instanceof BreakSig) break;
            if (!(e instanceof ContinueSig)) throw e;
          }
          if (s.step) exec(s.step);
        }
        return;
      case "forin":
        for (const k of Object.keys(arrays[s.arr] ?? {})) {
          vars[s.v] = k;
          try {
            exec(s.body);
          } catch (e) {
            if (e instanceof BreakSig) break;
            if (e instanceof ContinueSig) continue;
            throw e;
          }
        }
        return;
      case "block":
        for (const b of s.body) exec(b);
        return;
      case "next":
        throw new NextSignal();
      case "exit":
        throw new ExitSig(s.e ? toNum(ev(s.e)) : 0);
      case "break":
        throw new BreakSig();
      case "continue":
        throw new ContinueSig();
      case "delete":
        if (s.keys) delete (arrays[s.arr] ?? {})[key(s.keys)];
        else arrays[s.arr] = {};
        return;
    }
  };

  const runAction = (r: Rule) => {
    if (!r.action) ctx.out(fields[0] + toStr(vars.ORS));
    else for (const s of r.action) exec(s);
  };

  let exitCode = 0;
  let status = 0;
  try {
    try {
      for (const r of rules) if (r.pattern === "BEGIN") runAction(r);
      const mainRules = rules.filter((r) => r.pattern !== "BEGIN" && r.pattern !== "END");
      const needInput = mainRules.length > 0 || rules.some((r) => r.pattern === "END");
      if (needInput) {
        const inputs = readInputs(ctx, files, (f, e) => {
          ctx.err(`awk: cannot open "${f}" (${errMsg(e)})\n`);
          status = 2;
        });
        for (const input of inputs) {
          vars.FILENAME = input.name === "-" ? "" : input.name;
          const recs = input.content.split("\n");
          if (recs[recs.length - 1] === "") recs.pop();
          for (const rec of recs) {
            vars.NR = toNum(vars.NR) + 1;
            splitRecord(rec);
            try {
              for (const r of mainRules) {
                const p = r.pattern as Expr | null;
                if (p === null || truthy(ev(p))) runAction(r);
              }
            } catch (e) {
              if (!(e instanceof NextSignal)) throw e;
            }
          }
        }
      }
    } catch (e) {
      if (!(e instanceof ExitSig)) throw e;
      exitCode = e.code;
    }
    for (const r of rules) if (r.pattern === "END") runAction(r);
  } catch (e) {
    if (e instanceof ExitSig) return e.code;
    if (e instanceof AwkError) {
      ctx.err(`awk: run time error: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  return status || exitCode;
}
