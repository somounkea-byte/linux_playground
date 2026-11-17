/**
 * Bash arithmetic evaluation: integers, C operators, assignments, ternary.
 */

export class ArithError extends Error {}

export interface ArithScope {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  getIndex?(name: string, index: number): string | undefined;
  setIndex?(name: string, index: number, value: string): void;
}

type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string; index?: Node }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "assign"; op: string; target: Node; b: Node }
  | { k: "incdec"; op: "++" | "--"; prefix: boolean; target: Node }
  | { k: "tern"; c: Node; a: Node; b: Node }
  | { k: "comma"; a: Node; b: Node };

const TOKEN_RE = /\s*(0[xX][0-9a-fA-F]+|\d+#[0-9a-zA-Z@_]+|\d+|[A-Za-z_][A-Za-z0-9_]*|\*\*=?|<<=|>>=|\+\+|--|&&|\|\||==|!=|<=|>=|<<|>>|[-+*/%&|^]=|[-+*/%<>=!~&|^?:(),\[\]])/y;

function lex(expr: string): string[] {
  const out: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < expr.length) {
    if (/^\s*$/.test(expr.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(expr);
    if (!m) throw new ArithError(`syntax error: operand expected (error token is "${expr.slice(pos).trim()}")`);
    out.push(m[1]);
    pos = TOKEN_RE.lastIndex;
  }
  return out;
}

const BIN_PREC: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "|": 3,
  "^": 4,
  "&": 5,
  "==": 6,
  "!=": 6,
  "<": 7,
  ">": 7,
  "<=": 7,
  ">=": 7,
  "<<": 8,
  ">>": 8,
  "+": 9,
  "-": 9,
  "*": 10,
  "/": 10,
  "%": 10,
  "**": 11,
};

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "^=", "**="]);

class ArithParser {
  private i = 0;
  constructor(private toks: string[], private src: string) {}

  parse(): Node {
    if (this.toks.length === 0) return { k: "num", v: 0 };
    const n = this.comma();
    if (this.i < this.toks.length) throw new ArithError(`syntax error in expression (error token is "${this.toks.slice(this.i).join(" ")}")`);
    return n;
  }

  private peek() {
    return this.toks[this.i];
  }

  private comma(): Node {
    let a = this.assign();
    while (this.peek() === ",") {
      this.i++;
      a = { k: "comma", a, b: this.assign() };
    }
    return a;
  }

  private assign(): Node {
    const start = this.i;
    const lhs = this.ternary();
    const op = this.peek();
    if (op && ASSIGN_OPS.has(op)) {
      if (lhs.k !== "var") throw new ArithError(`attempted assignment to non-variable (error token is "${this.toks.slice(start).join("")}")`);
      this.i++;
      return { k: "assign", op, target: lhs, b: this.assign() };
    }
    return lhs;
  }

  private ternary(): Node {
    const c = this.binary(1);
    if (this.peek() === "?") {
      this.i++;
      const a = this.assign();
      if (this.peek() !== ":") throw new ArithError(`\`:' expected for conditional expression (error token is "${this.src}")`);
      this.i++;
      const b = this.assign();
      return { k: "tern", c, a, b };
    }
    return c;
  }

  private binary(minPrec: number): Node {
    let a = this.unary();
    for (;;) {
      const op = this.peek();
      const prec = op !== undefined ? BIN_PREC[op] : undefined;
      if (prec === undefined || prec < minPrec) break;
      this.i++;
      const b = op === "**" ? this.binary(prec) : this.binary(prec + 1);
      a = { k: "bin", op, a, b };
    }
    return a;
  }

  private unary(): Node {
    const t = this.peek();
    if (t === "++" || t === "--") {
      this.i++;
      const target = this.unary();
      if (target.k !== "var") throw new ArithError("syntax error: operand expected");
      return { k: "incdec", op: t, prefix: true, target };
    }
    if (t === "!" || t === "~" || t === "-" || t === "+") {
      this.i++;
      return { k: "un", op: t, a: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Node {
    const p = this.primary();
    const t = this.peek();
    if ((t === "++" || t === "--") && p.k === "var") {
      this.i++;
      return { k: "incdec", op: t, prefix: false, target: p };
    }
    return p;
  }

  private primary(): Node {
    const t = this.toks[this.i++];
    if (t === undefined) throw new ArithError(`syntax error: operand expected (error token is "${this.src}")`);
    if (t === "(") {
      const n = this.comma();
      if (this.toks[this.i++] !== ")") throw new ArithError("missing `)'");
      return n;
    }
    if (/^0[xX]/.test(t)) return { k: "num", v: parseInt(t, 16) };
    if (/^\d+#/.test(t)) {
      const [base, digits] = t.split("#");
      const v = parseInt(digits, Number(base));
      if (Number.isNaN(v)) throw new ArithError(`value too great for base (error token is "${t}")`);
      return { k: "num", v };
    }
    if (/^\d+$/.test(t)) {
      if (t.length > 1 && t.startsWith("0")) {
        if (/[89]/.test(t)) throw new ArithError(`value too great for base (error token is "${t}")`);
        return { k: "num", v: parseInt(t, 8) };
      }
      return { k: "num", v: Number(t) };
    }
    if (/^[A-Za-z_]/.test(t)) {
      if (this.peek() === "[") {
        this.i++;
        const index = this.comma();
        if (this.toks[this.i++] !== "]") throw new ArithError("missing `]'");
        return { k: "var", name: t, index };
      }
      return { k: "var", name: t };
    }
    throw new ArithError(`syntax error: operand expected (error token is "${[t, ...this.toks.slice(this.i)].join("")}")`);
  }
}

const toInt = (n: number) => (Number.isFinite(n) ? Math.trunc(n) : 0);

export function evalArith(expr: string, scope: ArithScope, depth = 0): number {
  if (depth > 32) throw new ArithError("expression recursion level exceeded");
  const ast = new ArithParser(lex(expr), expr.trim()).parse();

  const readVar = (node: Extract<Node, { k: "var" }>): number => {
    const raw = node.index !== undefined ? scope.getIndex?.(node.name, ev(node.index)) : scope.get(node.name);
    if (raw === undefined || raw.trim() === "") return 0;
    if (/^-?\d+$/.test(raw.trim())) return Number(raw.trim());
    return evalArith(raw, scope, depth + 1);
  };
  const writeVar = (node: Extract<Node, { k: "var" }>, v: number) => {
    if (node.index !== undefined && scope.setIndex) scope.setIndex(node.name, ev(node.index), String(v));
    else scope.set(node.name, String(v));
  };

  const ev = (n: Node): number => {
    switch (n.k) {
      case "num":
        return n.v;
      case "var":
        return readVar(n);
      case "un": {
        const a = ev(n.a);
        if (n.op === "!") return a ? 0 : 1;
        if (n.op === "~") return ~a;
        if (n.op === "-") return -a;
        return a;
      }
      case "comma":
        ev(n.a);
        return ev(n.b);
      case "tern":
        return ev(n.c) ? ev(n.a) : ev(n.b);
      case "incdec": {
        const t = n.target as Extract<Node, { k: "var" }>;
        const old = readVar(t);
        const nv = n.op === "++" ? old + 1 : old - 1;
        writeVar(t, nv);
        return n.prefix ? nv : old;
      }
      case "assign": {
        const t = n.target as Extract<Node, { k: "var" }>;
        const rhs = ev(n.b);
        const v = n.op === "=" ? rhs : binop(n.op.slice(0, -1), readVar(t), rhs);
        writeVar(t, v);
        return v;
      }
      case "bin": {
        if (n.op === "&&") return ev(n.a) && ev(n.b) ? 1 : 0;
        if (n.op === "||") return ev(n.a) || ev(n.b) ? 1 : 0;
        return binop(n.op, ev(n.a), ev(n.b));
      }
    }
  };

  const binop = (op: string, a: number, b: number): number => {
    switch (op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return toInt(a * b);
      case "/":
        if (b === 0) throw new ArithError(`division by 0 (error token is "${expr.trim()}")`);
        return Math.trunc(a / b);
      case "%":
        if (b === 0) throw new ArithError(`division by 0 (error token is "${expr.trim()}")`);
        return a % b;
      case "**":
        if (b < 0) throw new ArithError("exponent less than 0");
        return toInt(a ** b);
      case "<<":
        return a << b;
      case ">>":
        return a >> b;
      case "&":
        return a & b;
      case "|":
        return a | b;
      case "^":
        return a ^ b;
      case "==":
        return a === b ? 1 : 0;
      case "!=":
        return a !== b ? 1 : 0;
      case "<":
        return a < b ? 1 : 0;
      case ">":
        return a > b ? 1 : 0;
      case "<=":
        return a <= b ? 1 : 0;
      case ">=":
        return a >= b ? 1 : 0;
    }
    throw new ArithError(`syntax error: invalid arithmetic operator (error token is "${op}")`);
  };

  return ev(ast);
}
