/**
 * Bash-compatible lexer and recursive-descent parser.
 *
 * Words are kept in their raw form (quotes included); expansion happens at
 * execution time so that variable assignments earlier in a list are honoured.
 */

export class ShellSyntaxError extends Error {
  line = 1;
}
/** Raised when input ends inside an unfinished construct (PS2 continuation). */
export class IncompleteInputError extends Error {}

export interface Token {
  t: "word" | "op" | "nl" | "arith" | "eof";
  v: string;
  /** For redirection operators preceded by an io-number (`2>`). */
  fd?: number;
  start: number;
  end: number;
  heredoc?: { body: string; quoted: boolean };
}

const OPERATORS = ["<<<", "&>>", "<<-", ";;&", "&&", "||", ";;", ";&", ">>", "<<", "<&", ">&", "&>", ">|", "|", "&", ";", "(", ")", "<", ">"];
const META = new Set([" ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")"]);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const pendingHeredocs: { token: Token; delim: string; strip: boolean; quoted: boolean }[] = [];
  let i = 0;
  let expectHeredocDelim: { strip: boolean } | null = null;

  const readHeredocBodies = () => {
    for (const hd of pendingHeredocs) {
      const lines: string[] = [];
      let found = false;
      while (i < input.length) {
        let nl = input.indexOf("\n", i);
        if (nl === -1) nl = input.length;
        let line = input.slice(i, nl);
        i = nl + 1;
        if (hd.strip) line = line.replace(/^\t+/, "");
        if (line === hd.delim) {
          found = true;
          break;
        }
        lines.push(line);
      }
      if (!found) throw new IncompleteInputError("here-document");
      hd.token.heredoc = { body: lines.length ? lines.join("\n") + "\n" : "", quoted: hd.quoted };
    }
    pendingHeredocs.length = 0;
  };

  while (i < input.length) {
    const c = input[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "\\" && input[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (c === "#") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }
    if (c === "\n") {
      tokens.push({ t: "nl", v: "\n", start: i, end: i + 1 });
      i++;
      if (pendingHeredocs.length) readHeredocBodies();
      continue;
    }
    // (( arithmetic command ))
    if (c === "(" && input[i + 1] === "(") {
      const end = findArithEnd(input, i + 2);
      if (end !== -1) {
        tokens.push({ t: "arith", v: input.slice(i + 2, end), start: i, end: end + 2 });
        i = end + 2;
        continue;
      }
    }
    // io-number redirection: 2> 2>> 2>&1 1>&2 0<
    const ioMatch = /^(\d+)(>>|>&|>\||<&|<<<|<<|>|<)/.exec(input.slice(i, i + 6));
    if (ioMatch) {
      tokens.push({ t: "op", v: ioMatch[2], fd: Number(ioMatch[1]), start: i, end: i + ioMatch[0].length });
      i += ioMatch[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => input.startsWith(o, i));
    if (op) {
      tokens.push({ t: "op", v: op, start: i, end: i + op.length });
      i += op.length;
      if (op === "<<" || op === "<<-") expectHeredocDelim = { strip: op === "<<-" };
      continue;
    }
    // word
    const start = i;
    i = readWord(input, i);
    const raw = input.slice(start, i);
    const tok: Token = { t: "word", v: raw, start, end: i };
    tokens.push(tok);
    if (expectHeredocDelim) {
      const quoted = /['"\\]/.test(raw);
      const delim = raw.replace(/['"\\]/g, "");
      pendingHeredocs.push({ token: tok, delim, strip: expectHeredocDelim.strip, quoted });
      expectHeredocDelim = null;
    }
  }
  if (pendingHeredocs.length) throw new IncompleteInputError("here-document");
  tokens.push({ t: "eof", v: "", start: input.length, end: input.length });
  return tokens;
}

function findArithEnd(input: string, from: number): number {
  let depth = 0;
  for (let j = from; j < input.length; j++) {
    const ch = input[j];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) return input[j + 1] === ")" ? j : -1;
      depth--;
    } else if (ch === "\n") {
      return -1;
    }
  }
  return -1;
}

/** Read a raw word starting at `i`; returns the index just after it. */
export function readWord(input: string, i: number): number {
  while (i < input.length) {
    const c = input[i];
    if (META.has(c)) {
      // name=( ... ) array assignment
      if (c === "(" && /^[A-Za-z_][A-Za-z0-9_]*\+?=$/.test(currentWordPrefix(input, i))) {
        i = skipBalanced(input, i + 1, "(", ")");
        continue;
      }
      break;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new IncompleteInputError("quote");
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i = skipDoubleQuoted(input, i + 1);
      continue;
    }
    if (c === "`") {
      i = skipBacktick(input, i + 1);
      continue;
    }
    if (c === "$") {
      if (input[i + 1] === "(") {
        i = skipBalanced(input, i + 2, "(", ")");
        continue;
      }
      if (input[i + 1] === "{") {
        i = skipBalanced(input, i + 2, "{", "}");
        continue;
      }
    }
    i++;
  }
  return i;
}

function currentWordPrefix(input: string, i: number): string {
  let s = i;
  while (s > 0 && !META.has(input[s - 1])) s--;
  return input.slice(s, i);
}

function skipDoubleQuoted(input: string, i: number): number {
  while (i < input.length) {
    const c = input[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === '"') return i + 1;
    if (c === "`") {
      i = skipBacktick(input, i + 1);
      continue;
    }
    if (c === "$" && input[i + 1] === "(") {
      i = skipBalanced(input, i + 2, "(", ")");
      continue;
    }
    if (c === "$" && input[i + 1] === "{") {
      i = skipBalanced(input, i + 2, "{", "}");
      continue;
    }
    i++;
  }
  throw new IncompleteInputError("quote");
}

function skipBacktick(input: string, i: number): number {
  while (i < input.length) {
    if (input[i] === "\\") {
      i += 2;
      continue;
    }
    if (input[i] === "`") return i + 1;
    i++;
  }
  throw new IncompleteInputError("backtick");
}

/** Skip to just past the matching close char, honouring quotes. */
export function skipBalanced(input: string, i: number, open: string, close: string): number {
  let depth = 1;
  while (i < input.length) {
    const c = input[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new IncompleteInputError("quote");
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i = skipDoubleQuoted(input, i + 1);
      continue;
    }
    if (c === "`") {
      i = skipBacktick(input, i + 1);
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  throw new IncompleteInputError("paren");
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export interface Redirect {
  op: string;
  fd?: number;
  target: string;
  heredoc?: { body: string; quoted: boolean };
}

export type Command =
  | { type: "simple"; assigns: string[]; words: string[]; redirects: Redirect[]; line: number }
  | { type: "if"; clauses: { cond: List; body: List }[]; elseBody?: List; redirects: Redirect[] }
  | { type: "for"; name: string; items: string[] | null; body: List; redirects: Redirect[] }
  | { type: "forArith"; init: string; cond: string; step: string; body: List; redirects: Redirect[] }
  | { type: "while"; until: boolean; cond: List; body: List; redirects: Redirect[] }
  | { type: "case"; word: string; items: { patterns: string[]; body: List; term: string }[]; redirects: Redirect[] }
  | { type: "group"; body: List; redirects: Redirect[] }
  | { type: "subshell"; body: List; redirects: Redirect[] }
  | { type: "arith"; expr: string; redirects: Redirect[] }
  | { type: "cond"; words: string[]; redirects: Redirect[] }
  | { type: "funcdef"; name: string; body: Command; redirects: Redirect[] };

export interface Pipeline {
  negate: boolean;
  commands: Command[];
}

export interface AndOr {
  first: Pipeline;
  rest: { op: "&&" | "||"; pipeline: Pipeline }[];
}

export interface ListItem {
  andOr: AndOr;
  background: boolean;
  text: string;
}

export type List = ListItem[];

const REDIRECT_OPS = new Set(["<", ">", ">>", "<<", "<<-", "<<<", "<&", ">&", "&>", "&>>", ">|"]);

export class Parser {
  private pos = 0;
  private tokens: Token[];

  constructor(private input: string) {
    this.tokens = tokenize(input);
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private isWord(v?: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.t === "word" && (v === undefined || t.v === v);
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === "op" && t.v === v;
  }

  private unexpected(tok: Token): never {
    if (tok.t === "eof") throw new IncompleteInputError("eof");
    const shown = tok.t === "nl" ? "newline" : tok.t === "arith" ? `((${tok.v}))` : tok.v;
    const err = new ShellSyntaxError(`syntax error near unexpected token \`${shown}'`);
    err.line = this.lineOf(tok.start);
    throw err;
  }

  private skipNewlines() {
    while (this.peek().t === "nl") this.pos++;
  }

  private expectWord(v: string) {
    this.skipNewlines();
    const t = this.peek();
    if (t.t === "word" && t.v === v) {
      this.pos++;
      return;
    }
    this.unexpected(t);
  }

  parseProgram(): List {
    const list = this.parseList([]);
    const t = this.peek();
    if (t.t !== "eof") this.unexpected(t);
    return list;
  }

  /** Parse a list until a terminator reserved word / op (not consumed). */
  parseList(terminators: string[]): List {
    const items: List = [];
    for (;;) {
      this.skipNewlines();
      const t = this.peek();
      if (t.t === "eof") break;
      if (t.t === "word" && terminators.includes(t.v)) break;
      if (t.t === "op" && terminators.includes(t.v)) break;
      if (t.t === "op" && (t.v === ";" || t.v === "&")) this.unexpected(t);
      const startTok = this.peek();
      const andOr = this.parseAndOr();
      const endTok = this.tokens[this.pos - 1];
      let background = false;
      const sep = this.peek();
      if (sep.t === "op" && (sep.v === ";" || sep.v === "&")) {
        background = sep.v === "&";
        this.pos++;
      } else if (sep.t === "nl") {
        this.pos++;
      } else if (sep.t !== "eof" && !(sep.t === "word" && terminators.includes(sep.v)) && !(sep.t === "op" && terminators.includes(sep.v))) {
        this.unexpected(sep);
      }
      items.push({ andOr, background, text: this.input.slice(startTok.start, endTok.end) });
    }
    return items;
  }

  private parseAndOr(): AndOr {
    const first = this.parsePipeline();
    const rest: AndOr["rest"] = [];
    while (this.isOp("&&") || this.isOp("||")) {
      const op = this.next().v as "&&" | "||";
      this.skipNewlines();
      rest.push({ op, pipeline: this.parsePipeline() });
    }
    return { first, rest };
  }

  private parsePipeline(): Pipeline {
    let negate = false;
    if (this.isWord("!")) {
      negate = true;
      this.pos++;
    }
    const commands = [this.parseCommand()];
    while (this.isOp("|")) {
      this.pos++;
      this.skipNewlines();
      commands.push(this.parseCommand());
    }
    return { negate, commands };
  }

  private parseRedirects(): Redirect[] {
    const redirects: Redirect[] = [];
    while (this.peek().t === "op" && REDIRECT_OPS.has(this.peek().v)) redirects.push(this.parseRedirect());
    return redirects;
  }

  private parseRedirect(): Redirect {
    const op = this.next();
    const target = this.peek();
    if (target.t !== "word") this.unexpected(target);
    this.pos++;
    return { op: op.v, fd: op.fd, target: target.v, heredoc: target.heredoc };
  }

  private parseCommand(): Command {
    const t = this.peek();
    if (t.t === "arith") {
      this.pos++;
      return { type: "arith", expr: t.v, redirects: this.parseRedirects() };
    }
    if (t.t === "op" && t.v === "(") {
      this.pos++;
      const body = this.parseList([")"]);
      if (!this.isOp(")")) this.unexpected(this.peek());
      this.pos++;
      return { type: "subshell", body, redirects: this.parseRedirects() };
    }
    if (t.t === "word") {
      switch (t.v) {
        case "if":
          return this.parseIf();
        case "for":
          return this.parseFor();
        case "while":
        case "until":
          return this.parseWhile();
        case "case":
          return this.parseCase();
        case "{": {
          this.pos++;
          const body = this.parseList(["}"]);
          this.expectWord("}");
          return { type: "group", body, redirects: this.parseRedirects() };
        }
        case "[[":
          return this.parseCond();
        case "function": {
          this.pos++;
          const name = this.next();
          if (name.t !== "word") this.unexpected(name);
          if (this.isOp("(")) {
            this.pos++;
            if (!this.isOp(")")) this.unexpected(this.peek());
            this.pos++;
          }
          this.skipNewlines();
          return { type: "funcdef", name: name.v, body: this.parseCommand(), redirects: [] };
        }
        case "then":
        case "fi":
        case "do":
        case "done":
        case "elif":
        case "else":
        case "esac":
        case "}":
          this.unexpected(t);
      }
      // name() { ... }
      if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(t.v) && this.peek(1).t === "op" && this.peek(1).v === "(" && this.peek(2).t === "op" && this.peek(2).v === ")") {
        this.pos += 3;
        this.skipNewlines();
        return { type: "funcdef", name: t.v, body: this.parseCommand(), redirects: [] };
      }
    }
    return this.parseSimple();
  }

  lineOf(offset: number): number {
    let n = 1;
    for (let k = 0; k < offset && k < this.input.length; k++) if (this.input[k] === "\n") n++;
    return n;
  }

  private parseSimple(): Command {
    const line = this.lineOf(this.peek().start);
    const assigns: string[] = [];
    const words: string[] = [];
    const redirects: Redirect[] = [];
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && REDIRECT_OPS.has(t.v)) {
        redirects.push(this.parseRedirect());
        continue;
      }
      if (t.t !== "word") break;
      if (words.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/.test(t.v)) assigns.push(t.v);
      else words.push(t.v);
      this.pos++;
    }
    if (assigns.length === 0 && words.length === 0 && redirects.length === 0) this.unexpected(this.peek());
    return { type: "simple", assigns, words, redirects, line };
  }

  private parseIf(): Command {
    this.pos++; // if
    const clauses: { cond: List; body: List }[] = [];
    const cond = this.parseList(["then"]);
    this.expectWord("then");
    const body = this.parseList(["elif", "else", "fi"]);
    clauses.push({ cond, body });
    let elseBody: List | undefined;
    for (;;) {
      this.skipNewlines();
      if (this.isWord("elif")) {
        this.pos++;
        const c = this.parseList(["then"]);
        this.expectWord("then");
        clauses.push({ cond: c, body: this.parseList(["elif", "else", "fi"]) });
        continue;
      }
      if (this.isWord("else")) {
        this.pos++;
        elseBody = this.parseList(["fi"]);
      }
      this.expectWord("fi");
      break;
    }
    if (clauses.some((c) => c.cond.length === 0 || c.body.length === 0)) {
      throw new ShellSyntaxError("syntax error near unexpected token `fi'");
    }
    return { type: "if", clauses, elseBody, redirects: this.parseRedirects() };
  }

  private parseDoGroup(): List {
    this.skipNewlines();
    if (this.isOp(";")) this.pos++;
    this.skipNewlines();
    this.expectWord("do");
    const body = this.parseList(["done"]);
    this.expectWord("done");
    if (body.length === 0) throw new ShellSyntaxError("syntax error near unexpected token `done'");
    return body;
  }

  private parseFor(): Command {
    this.pos++; // for
    const t = this.peek();
    if (t.t === "arith") {
      this.pos++;
      const parts = t.v.split(";");
      if (parts.length !== 3) throw new ShellSyntaxError("syntax error: arithmetic expression required");
      const body = this.parseDoGroup();
      return { type: "forArith", init: parts[0], cond: parts[1], step: parts[2], body, redirects: this.parseRedirects() };
    }
    const name = this.next();
    if (name.t !== "word") this.unexpected(name);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.v)) throw new ShellSyntaxError(`\`${name.v}': not a valid identifier`);
    let items: string[] | null = null;
    this.skipNewlines();
    if (this.isWord("in")) {
      this.pos++;
      items = [];
      while (this.peek().t === "word") items.push(this.next().v);
      if (this.isOp(";")) this.pos++;
      else if (this.peek().t === "nl") this.pos++;
      else if (this.peek().t === "eof") throw new IncompleteInputError("for");
      else this.unexpected(this.peek());
    } else if (this.isOp(";")) this.pos++;
    const body = this.parseDoGroup();
    return { type: "for", name: name.v, items, body, redirects: this.parseRedirects() };
  }

  private parseWhile(): Command {
    const until = this.next().v === "until";
    const cond = this.parseList(["do"]);
    const body = this.parseDoGroup();
    return { type: "while", until, cond, body, redirects: this.parseRedirects() };
  }

  private parseCase(): Command {
    this.pos++; // case
    const word = this.next();
    if (word.t !== "word") this.unexpected(word);
    this.skipNewlines();
    this.expectWord("in");
    const items: { patterns: string[]; body: List; term: string }[] = [];
    for (;;) {
      this.skipNewlines();
      if (this.isWord("esac")) {
        this.pos++;
        break;
      }
      if (this.peek().t === "eof") throw new IncompleteInputError("case");
      if (this.isOp("(")) this.pos++;
      const patterns: string[] = [];
      for (;;) {
        const p = this.next();
        if (p.t !== "word") this.unexpected(p);
        patterns.push(p.v);
        if (this.isOp("|")) {
          this.pos++;
          continue;
        }
        break;
      }
      if (!this.isOp(")")) this.unexpected(this.peek());
      this.pos++;
      const body = this.parseList([";;", ";&", ";;&", "esac"]);
      let term = ";;";
      if (this.isOp(";;") || this.isOp(";&") || this.isOp(";;&")) term = this.next().v;
      items.push({ patterns, body, term });
    }
    return { type: "case", word: word.v, items, redirects: this.parseRedirects() };
  }

  private parseCond(): Command {
    this.pos++; // [[
    const words: string[] = [];
    for (;;) {
      const t = this.peek();
      if (t.t === "eof") throw new IncompleteInputError("[[");
      if (t.t === "word" && t.v === "]]") {
        this.pos++;
        break;
      }
      if (t.t === "nl") throw new ShellSyntaxError("syntax error in conditional expression");
      words.push(t.v);
      this.pos++;
    }
    return { type: "cond", words, redirects: this.parseRedirects() };
  }
}

export function parse(input: string): List {
  return new Parser(input).parseProgram();
}

/** Split a raw string into word tokens (used for alias expansion). */
export function splitWords(input: string): string[] {
  return tokenize(input)
    .filter((t) => t.t === "word")
    .map((t) => t.v);
}
