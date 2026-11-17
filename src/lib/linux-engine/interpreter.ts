/**
 * The shell interpreter: expansion, redirection, pipelines, control flow,
 * functions, scripts and command dispatch.
 *
 * Everything is synchronous and operates on the in-memory EnvState. No host
 * process or host filesystem is ever touched.
 */
import { ArithError, evalArith, type ArithScope } from "./arith";
import type { CommandContext, CommandDef } from "./commands/types";
import { FsError, normalizePath, type VirtualFileSystem } from "./filesystem";
import { canAccess, type Identity, R, W, X } from "./permissions";
import { IncompleteInputError, parse, ShellSyntaxError, splitWords, skipBalanced, type Command, type List, type Pipeline, type Redirect } from "./parser";
import { packageProvidingCommand } from "./packages";
import { loadAverage, memoryStats, uptimeString } from "./processes";
import { evalTest, TestError } from "./test-expr";
import type { EnvState, FsNode, InputPrompt, ShellFrame, TerminalAction } from "./types";
import { findUser, identityFor } from "./users";
import { globToRegExp, hasGlobChars, levenshtein, seeded, syslogDate } from "./util";

// ---------------------------------------------------------------------------
// Control-flow signals
// ---------------------------------------------------------------------------

export class NeedInputSignal {
  constructor(public prompt: InputPrompt) {}
}
export class ExitSignal {
  constructor(public code: number) {}
}
class ReturnSignal {
  constructor(public code: number) {}
}
class BreakSignal {
  constructor(public levels: number) {}
}
class ContinueSignal {
  constructor(public levels: number) {}
}
export class LimitError extends Error {}

export const BINARY_MARKER = "\u007fELF\u0002\u0001\u0001SIMBIN:";

export interface InputStream {
  data: string;
  pos: number;
  tty: boolean;
}

export interface Sink {
  tty: boolean;
  write(s: string): void;
}

interface IO {
  stdin: InputStream;
  stdout: Sink;
  stderr: Sink;
}

export interface ShellOptions {
  now: number;
  inputs: string[];
  registry: Map<string, CommandDef>;
  maxSteps?: number;
  maxOutput?: number;
}

interface Piece {
  s: string;
  q: boolean;
}

const MAX_FUNC_DEPTH = 100;

export class Shell {
  readonly state: EnvState;
  readonly fs: VirtualFileSystem;
  readonly now: number;
  readonly registry: Map<string, CommandDef>;
  private inputs: string[];
  private terminal: string[] = [];
  private terminalSize = 0;
  private steps = 0;
  private maxSteps: number;
  private maxOutput: number;
  positional: string[] = [];
  scriptName = "bash";
  private scriptStack: string[] = [];
  private currentLine = 0;
  private locals: Map<string, { value?: string; array?: string[]; existed: boolean }>[] = [];
  private funcDepth = 0;
  private identityStack: Identity[] = [];
  readonly commandsUsed = new Set<string>();
  readonly actions: TerminalAction[] = [];
  private lastBgPid = 0;
  private rand = 0;
  private lastSubstStatus = 0;
  readonly jobNotices: string[] = [];

  constructor(state: EnvState, fs: VirtualFileSystem, opts: ShellOptions) {
    this.state = state;
    this.fs = fs;
    this.now = opts.now;
    this.inputs = [...opts.inputs];
    this.registry = opts.registry;
    this.maxSteps = opts.maxSteps ?? 25000;
    this.maxOutput = opts.maxOutput ?? 512 * 1024;
  }

  // ---------------------------------------------------------------- session

  get frame(): ShellFrame {
    const stack = this.state.session.userStack;
    return stack[stack.length - 1];
  }

  get cwd(): string {
    return this.frame.cwd;
  }

  set cwd(v: string) {
    this.frame.cwd = v;
  }

  get identity(): Identity {
    if (this.identityStack.length) return this.identityStack[this.identityStack.length - 1];
    return identityFor(this.state, this.frame.user);
  }

  get user(): string {
    return this.identity.username;
  }

  homeOf(username: string): string {
    return findUser(this.state, username)?.home ?? "/";
  }

  withIdentity<T>(who: Identity, fn: () => T): T {
    this.identityStack.push(who);
    try {
      return fn();
    } finally {
      this.identityStack.pop();
    }
  }

  get output(): string {
    return this.terminal.join("");
  }

  private writeTerminal(s: string) {
    if (!s) return;
    this.terminalSize += s.length;
    if (this.terminalSize > this.maxOutput) {
      throw new LimitError("output limit exceeded (the simulator stops commands that print too much)");
    }
    this.terminal.push(s);
  }

  readonly tty: Sink = { tty: true, write: (s) => this.writeTerminal(s) };

  /** Prefix used for shell-level error messages. */
  errPrefix(): string {
    if (this.scriptStack.length) return `${this.scriptStack[this.scriptStack.length - 1]}: line ${this.currentLine}`;
    return "bash";
  }

  tick(n = 1) {
    this.steps += n;
    if (this.steps > this.maxSteps) {
      throw new LimitError("execution limit reached (too many steps - is there an infinite loop?)");
    }
  }

  /** Collect interactive input; throws NeedInputSignal when the client must supply it. */
  readInput(prompt: string, secret: boolean, sink: Sink = this.tty): string {
    if (prompt) sink.write(prompt);
    if (this.inputs.length === 0) throw new NeedInputSignal({ prompt, secret });
    const value = this.inputs.shift()!;
    sink.write(secret ? "\n" : value + "\n");
    return value;
  }

  random(): number {
    return seeded(this.now + this.rand++ * 7919);
  }

  // ------------------------------------------------------------- variables

  private dynamicVar(name: string): string | undefined {
    switch (name) {
      case "PWD":
        return this.cwd;
      case "OLDPWD":
        return this.frame.oldpwd;
      case "USER":
      case "LOGNAME":
        return this.frame.user;
      case "HOME":
        return this.state.session.vars.HOME_OVERRIDE ?? this.homeOf(this.frame.user);
      case "UID":
        return String(identityFor(this.state, this.frame.user).uid);
      case "EUID":
        return String(this.identity.uid);
      case "HOSTNAME":
        return this.state.hostname;
      case "RANDOM":
        return String(Math.floor(this.random() * 32768));
      case "SECONDS":
        return "0";
      case "SHELL":
        return findUser(this.state, this.frame.user)?.shell ?? "/bin/bash";
      case "BASH_VERSION":
        return "5.2.21(1)-release";
      case "LINENO":
        return String(this.currentLine);
    }
    return undefined;
  }

  getVar(name: string): string | undefined {
    const dyn = this.dynamicVar(name);
    if (dyn !== undefined) return dyn;
    const arr = this.state.session.arrays[name];
    if (arr) return arr[0];
    return this.state.session.vars[name];
  }

  isSet(name: string): boolean {
    return this.getVar(name) !== undefined || name in this.state.session.arrays;
  }

  setVar(name: string, value: string) {
    if (["PWD", "OLDPWD", "UID", "EUID", "RANDOM", "LINENO"].includes(name)) return;
    if (name === "HOME") {
      this.state.session.vars.HOME_OVERRIDE = value;
      return;
    }
    const arr = this.state.session.arrays[name];
    if (arr) {
      arr[0] = value;
      return;
    }
    this.state.session.vars[name] = value;
  }

  unsetVar(name: string) {
    delete this.state.session.vars[name];
    delete this.state.session.arrays[name];
    this.state.session.exported = this.state.session.exported.filter((n) => n !== name);
  }

  getArray(name: string): string[] | undefined {
    return this.state.session.arrays[name];
  }

  setArray(name: string, values: string[]) {
    delete this.state.session.vars[name];
    this.state.session.arrays[name] = values;
  }

  exportVar(name: string) {
    if (!this.state.session.exported.includes(name)) this.state.session.exported.push(name);
  }

  /** Environment passed to child processes. */
  environment(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const n of this.state.session.exported) {
      const v = this.getVar(n);
      if (v !== undefined) env[n] = v;
    }
    for (const n of ["HOME", "USER", "LOGNAME", "PWD", "SHELL"]) env[n] = this.getVar(n) ?? "";
    if (this.frame.oldpwd) env.OLDPWD = this.frame.oldpwd;
    return env;
  }

  declareLocal(name: string) {
    const scope = this.locals[this.locals.length - 1];
    if (!scope) return false;
    if (!scope.has(name)) {
      const s = this.state.session;
      scope.set(name, { value: s.vars[name], array: s.arrays[name] ? [...s.arrays[name]] : undefined, existed: name in s.vars || name in s.arrays });
    }
    return true;
  }

  get inFunction(): boolean {
    return this.locals.length > 0;
  }

  private arithScope(): ArithScope {
    return {
      get: (n) => this.getVar(n),
      set: (n, v) => this.setVar(n, v),
      getIndex: (n, i) => this.state.session.arrays[n]?.[i] ?? (i === 0 ? this.state.session.vars[n] : undefined),
      setIndex: (n, i, v) => {
        const arr = this.state.session.arrays[n] ?? (this.state.session.arrays[n] = []);
        arr[i] = v;
      },
    };
  }

  arith(expr: string): number {
    const expanded = this.expandString(expr, false);
    return evalArith(expanded, this.arithScope());
  }

  // ------------------------------------------------------------- filesystem

  canRead(node: FsNode): boolean {
    return canAccess(node, this.identity, R);
  }

  canWrite(node: FsNode): boolean {
    return canAccess(node, this.identity, W);
  }

  lookup(path: string, follow = true): FsNode {
    return this.fs.lookup(path, this.cwd, this.identity, follow);
  }

  /** Content of a node, generating dynamic files (/proc, logs) on demand. */
  readFileContent(node: FsNode): string {
    if (node.type === "chardev") {
      if (node.name === "zero") return "";
      if (node.name === "random" || node.name === "urandom") return "";
      return "";
    }
    const path = this.fs.pathOf(node);
    const dyn = this.dynamicContent(path);
    return dyn ?? node.content;
  }

  private dynamicContent(path: string): string | undefined {
    const now = this.now;
    switch (path) {
      case "/proc/uptime": {
        const up = (now - this.state.bootTime) / 1000;
        return `${up.toFixed(2)} ${(up * 1.9).toFixed(2)}\n`;
      }
      case "/proc/loadavg": {
        const [a, b, c] = loadAverage(now);
        return `${a.toFixed(2)} ${b.toFixed(2)} ${c.toFixed(2)} 1/${180 + this.state.processes.length} ${this.state.nextPid}\n`;
      }
      case "/proc/meminfo": {
        const m = memoryStats(this.state, now);
        const row = (k: string, v: number) => `${(k + ":").padEnd(16)}${String(v).padStart(8)} kB`;
        return (
          [
            row("MemTotal", m.total),
            row("MemFree", m.free),
            row("MemAvailable", m.available),
            row("Buffers", 52340),
            row("Cached", m.buffCache - 52340),
            row("SwapCached", 0),
            row("Active", 912340),
            row("Inactive", 1203400),
            row("SwapTotal", m.swapTotal),
            row("SwapFree", m.swapFree),
            row("Shmem", m.shared),
          ].join("\n") + "\n"
        );
      }
      case "/var/log/auth.log":
        return this.formatLogs("auth");
      case "/var/log/syslog":
        return this.formatLogs("syslog");
    }
    if (/^\/proc\/\d+\/(cmdline|status|comm)$/.test(path)) {
      const pid = Number(path.split("/")[2]);
      const p = this.state.processes.find((x) => x.pid === pid);
      if (!p) return "";
      if (path.endsWith("comm")) return p.command + "\n";
      if (path.endsWith("cmdline")) return p.args.replace(/ /g, "\0");
      return `Name:\t${p.command}\nState:\t${p.state}\nPid:\t${p.pid}\nPPid:\t${p.ppid}\nUid:\t${findUser(this.state, p.user)?.uid ?? 0}\n`;
    }
    return undefined;
  }

  formatLogs(file: "auth" | "syslog"): string {
    return this.state.logs
      .filter((l) => l.file === file)
      .map((l) => `${syslogDate(l.ts)} ${this.state.hostname} ${l.source}: ${l.message}`)
      .join("\n")
      .concat(this.state.logs.some((l) => l.file === file) ? "\n" : "");
  }

  log(file: "auth" | "syslog", source: string, message: string, unit?: string) {
    this.state.logs.push({ ts: this.now, source, message, file, unit });
    if (this.state.logs.length > 400) this.state.logs.splice(0, this.state.logs.length - 400);
  }

  // ------------------------------------------------------------- execution

  run(input: string): number {
    const list = parse(input);
    return this.execList(list, { stdin: { data: "", pos: 0, tty: true }, stdout: this.tty, stderr: this.tty });
  }

  execList(list: List, io: IO): number {
    let status = 0;
    for (const item of list) {
      if (item.background) {
        status = this.execBackground(item, io);
        continue;
      }
      status = this.execAndOr(item.andOr, io);
    }
    return status;
  }

  private execBackground(item: List[number], io: IO): number {
    const session = this.state.session;
    const jobId = (session.jobs.reduce((m, j) => Math.max(m, j.id), 0) || 0) + 1;
    const first = item.andOr.first.commands[0];
    const isSleep = item.andOr.rest.length === 0 && item.andOr.first.commands.length === 1 && first.type === "simple" && first.words[0] === "sleep";
    const pid = this.state.nextPid++;
    this.lastBgPid = pid;
    io.stderr.write(`[${jobId}] ${pid}\n`);
    if (isSleep && first.type === "simple") {
      const fields = first.words.slice(1).flatMap((w) => this.expandWord(w));
      const secs = fields.reduce((sum, f) => sum + parseDuration(f), 0);
      this.commandsUsed.add("sleep");
      this.state.processes.push({
        pid,
        ppid: 0,
        user: this.user,
        command: "sleep",
        args: ["sleep", ...fields].join(" "),
        state: "S",
        nice: 0,
        startedAt: this.now,
        endsAt: this.now + Math.max(0, secs) * 1000,
        tty: "pts/0",
        cpu: 0,
        mem: 0,
        vsz: 5684,
        rss: 1920,
      });
      session.jobs.push({ id: jobId, pid, command: item.text, state: "Running" });
      this.state.session.lastExit = 0;
      return 0;
    }
    const status = this.execAndOr(item.andOr, io);
    this.jobNotices.push(`[${jobId}]+  ${status === 0 ? "Done" : `Exit ${status}`}                    ${item.text}`);
    return 0;
  }

  private execAndOr(ao: List[number]["andOr"], io: IO): number {
    let status = this.execPipeline(ao.first, io);
    for (const { op, pipeline } of ao.rest) {
      if ((op === "&&" && status === 0) || (op === "||" && status !== 0)) status = this.execPipeline(pipeline, io);
    }
    return status;
  }

  private execPipeline(p: Pipeline, io: IO): number {
    let status: number;
    if (p.commands.length === 1) {
      status = this.execCommand(p.commands[0], io);
    } else {
      let input = io.stdin;
      status = 0;
      for (let i = 0; i < p.commands.length; i++) {
        const last = i === p.commands.length - 1;
        let buffer = "";
        const sink: Sink = last ? io.stdout : { tty: false, write: (s) => (buffer += s) };
        status = this.subshell(() => this.execCommand(p.commands[i], { stdin: input, stdout: sink, stderr: io.stderr }));
        input = { data: buffer, pos: 0, tty: false };
      }
    }
    if (p.negate) status = status === 0 ? 1 : 0;
    this.state.session.lastExit = status;
    return status;
  }

  /** Run `fn` in a subshell: variable, cwd and function changes are discarded. */
  subshell(fn: () => number): number {
    const s = this.state.session;
    const saved = {
      vars: { ...s.vars },
      arrays: structuredClone(s.arrays),
      exported: [...s.exported],
      functions: { ...s.functions },
      aliases: { ...s.aliases },
      cwd: this.frame.cwd,
      oldpwd: this.frame.oldpwd,
      stackLen: s.userStack.length,
      positional: [...this.positional],
      umask: s.umask,
    };
    try {
      return fn();
    } catch (e) {
      if (e instanceof ExitSignal) return e.code;
      throw e;
    } finally {
      s.vars = saved.vars;
      s.arrays = saved.arrays;
      s.exported = saved.exported;
      s.functions = saved.functions;
      s.aliases = saved.aliases;
      s.userStack.length = Math.min(s.userStack.length, saved.stackLen);
      this.frame.cwd = saved.cwd;
      this.frame.oldpwd = saved.oldpwd;
      this.positional = saved.positional;
      s.umask = saved.umask;
    }
  }

  execCommand(cmd: Command, io: IO): number {
    this.tick();
    let rio: IO;
    if (cmd.type !== "simple") {
      try {
        rio = this.applyRedirects(cmd.redirects, io);
      } catch (e) {
        return this.redirectFailure(e, io);
      }
    } else rio = io;

    switch (cmd.type) {
      case "simple":
        return this.execSimple(cmd, io);
      case "group":
        return this.execList(cmd.body, rio);
      case "subshell":
        return this.subshell(() => this.execList(cmd.body, rio));
      case "if": {
        for (const clause of cmd.clauses) {
          if (this.execList(clause.cond, rio) === 0) return this.execList(clause.body, rio);
        }
        return cmd.elseBody ? this.execList(cmd.elseBody, rio) : 0;
      }
      case "while": {
        let status = 0;
        for (;;) {
          this.tick();
          const c = this.execList(cmd.cond, rio);
          if (cmd.until ? c === 0 : c !== 0) break;
          try {
            status = this.execList(cmd.body, rio);
          } catch (e) {
            if (e instanceof BreakSignal) {
              if (e.levels > 1) throw new BreakSignal(e.levels - 1);
              break;
            }
            if (e instanceof ContinueSignal) {
              if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
              continue;
            }
            throw e;
          }
        }
        return status;
      }
      case "for": {
        const items = cmd.items === null ? [...this.positional] : cmd.items.flatMap((w) => this.expandWord(w));
        let status = 0;
        for (const item of items) {
          this.tick();
          this.setVar(cmd.name, item);
          try {
            status = this.execList(cmd.body, rio);
          } catch (e) {
            if (e instanceof BreakSignal) {
              if (e.levels > 1) throw new BreakSignal(e.levels - 1);
              break;
            }
            if (e instanceof ContinueSignal) {
              if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
              continue;
            }
            throw e;
          }
        }
        return status;
      }
      case "forArith": {
        let status = 0;
        try {
          if (cmd.init.trim()) this.arith(cmd.init);
          for (;;) {
            this.tick();
            if (cmd.cond.trim() && this.arith(cmd.cond) === 0) break;
            try {
              status = this.execList(cmd.body, rio);
            } catch (e) {
              if (e instanceof BreakSignal) {
                if (e.levels > 1) throw new BreakSignal(e.levels - 1);
                break;
              }
              if (!(e instanceof ContinueSignal)) throw e;
              if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
            }
            if (cmd.step.trim()) this.arith(cmd.step);
          }
        } catch (e) {
          if (e instanceof ArithError) {
            rio.stderr.write(`${this.errPrefix()}: ${e.message}\n`);
            return 1;
          }
          throw e;
        }
        return status;
      }
      case "case": {
        const word = this.expandWord(cmd.word, "single").join(" ");
        let fall = false;
        let status = 0;
        for (const item of cmd.items) {
          const matched = fall || item.patterns.some((p) => globToRegExp(this.expandPattern(p)).test(word));
          if (!matched) continue;
          status = this.execList(item.body, rio);
          if (item.term === ";&") {
            fall = true;
            continue;
          }
          if (item.term === ";;&") {
            fall = false;
            continue;
          }
          break;
        }
        return status;
      }
      case "arith": {
        try {
          return this.arith(cmd.expr) !== 0 ? 0 : 1;
        } catch (e) {
          if (e instanceof ArithError) {
            rio.stderr.write(`${this.errPrefix()}: ((: ${cmd.expr.trim()}: ${e.message}\n`);
            return 1;
          }
          throw e;
        }
      }
      case "cond": {
        const expanded = cmd.words.map((w) => (["&&", "||", "(", ")", "!", "<", ">"].includes(w) ? w : this.expandWord(w, "single").join(" ")));
        const patterns = cmd.words.map((w) => this.expandPattern(w));
        try {
          const ok = evalTest(expanded, this.testHost(), "cond", patterns, (n) => this.isSet(n));
          return ok ? 0 : 1;
        } catch (e) {
          if (e instanceof TestError) {
            rio.stderr.write(`${this.errPrefix()}: ${e.message}\n`);
            return 2;
          }
          throw e;
        }
      }
      case "funcdef":
        this.state.session.functions[cmd.name] = cmd.body;
        return 0;
    }
  }

  testHost() {
    return {
      lookup: (path: string, follow: boolean) => this.fs.tryLookup(path, this.cwd, this.identity, follow),
      identity: this.identity,
      sizeOf: (n: FsNode) => this.fs.sizeOf(n),
      setRematch: (groups: string[]) => this.setArray("BASH_REMATCH", groups),
    };
  }

  private redirectFailure(e: unknown, io: IO): number {
    if (e instanceof RedirectError) {
      io.stderr.write(`${this.errPrefix()}: ${e.message}\n`);
      this.state.session.lastExit = 1;
      return 1;
    }
    throw e;
  }

  private execSimple(cmd: Extract<Command, { type: "simple" }>, io: IO): number {
    this.currentLine = cmd.line;
    const words = this.expandAliases(cmd.words);
    this.lastSubstStatus = 0;
    let argv: string[];
    try {
      argv = words.flatMap((w) => this.expandWord(w));
    } catch (e) {
      if (e instanceof ExpansionError) {
        io.stderr.write(`${this.errPrefix()}: ${e.message}\n`);
        return 1;
      }
      throw e;
    }

    let rio: IO;
    try {
      rio = this.applyRedirects(cmd.redirects, io);
    } catch (e) {
      return this.redirectFailure(e, io);
    }

    if (argv.length === 0) {
      try {
        for (const a of cmd.assigns) this.assign(a);
      } catch (e) {
        if (e instanceof ExpansionError) {
          io.stderr.write(`${this.errPrefix()}: ${e.message}\n`);
          return 1;
        }
        throw e;
      }
      return this.lastSubstStatus;
    }

    // temporary assignments for this command only
    const saved: [string, string | undefined, boolean][] = [];
    for (const a of cmd.assigns) {
      const name = a.slice(0, a.indexOf("=")).replace(/\+$/, "");
      saved.push([name, this.state.session.vars[name], this.state.session.exported.includes(name)]);
      this.assign(a);
      this.exportVar(name);
    }
    try {
      return this.runArgv(argv, rio);
    } finally {
      for (const [name, value, wasExported] of saved) {
        if (value === undefined) delete this.state.session.vars[name];
        else this.state.session.vars[name] = value;
        if (!wasExported) this.state.session.exported = this.state.session.exported.filter((n) => n !== name);
      }
    }
  }

  private expandAliases(words: string[]): string[] {
    const seen = new Set<string>();
    let result = words;
    while (result.length && !seen.has(result[0]) && Object.prototype.hasOwnProperty.call(this.state.session.aliases, result[0])) {
      seen.add(result[0]);
      const value = this.state.session.aliases[result[0]];
      const replacement = splitWords(value);
      result = [...replacement, ...result.slice(1)];
      if (!value.endsWith(" ")) break;
    }
    return result;
  }

  assign(raw: string) {
    const eq = raw.indexOf("=");
    let name = raw.slice(0, eq);
    const append = name.endsWith("+");
    if (append) name = name.slice(0, -1);
    const valueRaw = raw.slice(eq + 1);
    const idx = /^([A-Za-z_][A-Za-z0-9_]*)\[(.*)\]$/.exec(name);
    if (valueRaw.startsWith("(") && valueRaw.endsWith(")") && !idx) {
      const inner = valueRaw.slice(1, -1);
      const elems = splitWords(inner.replace(/\n/g, " ")).flatMap((w) => this.expandWord(w));
      const base = append ? (this.getArray(name) ?? (this.state.session.vars[name] !== undefined ? [this.state.session.vars[name]] : [])) : [];
      this.setArray(name, [...base, ...elems]);
      return;
    }
    const value = this.expandWord(valueRaw, "assign").join("");
    if (idx) {
      const [, arrName, indexExpr] = idx;
      const index = this.arith(indexExpr);
      const arr = this.getArray(arrName) ?? (this.state.session.vars[arrName] !== undefined ? [this.state.session.vars[arrName]] : []);
      arr[index] = append ? (arr[index] ?? "") + value : value;
      this.setArray(arrName, arr);
      return;
    }
    const prev = append ? (this.getVar(name) ?? "") : "";
    this.setVar(name, prev + value);
  }

  // --------------------------------------------------------------- dispatch

  /** Run an already-expanded argv. */
  runArgv(argv: string[], io: IO): number {
    const name = argv[0];
    const args = argv.slice(1);
    this.tick();

    const fn = this.state.session.functions[name] as Command | undefined;
    if (fn) return this.callFunction(name, fn, args, io);

    const def = this.registry.get(name);
    if (def?.builtin) {
      this.commandsUsed.add(def.name);
      return this.invoke(def, name, args, io);
    }

    if (name.includes("/")) {
      let node: FsNode;
      try {
        node = this.lookup(name);
      } catch (e) {
        const msg = e instanceof FsError ? e.message : String(e);
        io.stderr.write(`${this.errPrefix()}: ${name}: ${msg}\n`);
        return e instanceof FsError && e.code === "EACCES" ? 126 : 127;
      }
      return this.execFile(node, name, argv, io);
    }

    const found = this.searchPath(name);
    if (found) return this.execFile(found.node, found.path, argv, io);
    return this.commandNotFound(name, io);
  }

  searchPath(name: string): { node: FsNode; path: string } | null {
    const path = this.getVar("PATH") ?? "";
    for (const dir of path.split(":")) {
      if (!dir) continue;
      const full = `${dir}/${name}`;
      const node = this.fs.tryLookup(full, this.cwd, this.identity);
      if (node && node.type === "file" && canAccess(node, this.identity, X)) return { node, path: normalizePath(full, this.cwd) };
    }
    return null;
  }

  private execFile(node: FsNode, path: string, argv: string[], io: IO): number {
    if (node.type === "dir") {
      io.stderr.write(`${this.errPrefix()}: ${path}: Is a directory\n`);
      return 126;
    }
    if (!canAccess(node, this.identity, X)) {
      io.stderr.write(`${this.errPrefix()}: ${path}: Permission denied\n`);
      return 126;
    }
    const content = node.content;
    if (content.startsWith(BINARY_MARKER)) {
      const cmdName = content.slice(BINARY_MARKER.length).trim();
      const def = this.registry.get(cmdName);
      if (!def) {
        io.stderr.write(`${this.errPrefix()}: ${path}: cannot execute binary file: Exec format error\n`);
        return 126;
      }
      this.commandsUsed.add(def.name);
      return this.invoke(def, argv[0].includes("/") ? cmdName : argv[0], argv.slice(1), io);
    }
    if (!canAccess(node, this.identity, R)) {
      io.stderr.write(`/bin/bash: ${path}: Permission denied\n`);
      return 126;
    }
    const firstLine = content.split("\n", 1)[0];
    if (firstLine.startsWith("#!")) {
      const interp = firstLine.slice(2).trim();
      if (!/(^|\/)(ba)?sh$|env (ba)?sh$|^\/usr\/bin\/env bash/.test(interp)) {
        io.stderr.write(`${this.errPrefix()}: ${path}: ${interp}: bad interpreter: the simulator only runs bash scripts\n`);
        return 126;
      }
    }
    this.commandsUsed.add("script");
    return this.runScript(content, argv[0], argv.slice(1), io, false);
  }

  /** Execute script text. `source` runs in the current shell context. */
  runScript(content: string, scriptName: string, args: string[], io: IO, source: boolean): number {
    let list: List;
    try {
      list = parse(content);
    } catch (e) {
      if (e instanceof ShellSyntaxError) {
        io.stderr.write(`${scriptName}: line ${e.line}: ${e.message}\n`);
        return 2;
      }
      if (e instanceof IncompleteInputError) {
        const lines = content.split("\n").length;
        io.stderr.write(`${scriptName}: line ${lines}: syntax error: unexpected end of file\n`);
        return 2;
      }
      throw e;
    }
    if (this.scriptStack.length > 20) {
      io.stderr.write(`${this.errPrefix()}: maximum script nesting exceeded\n`);
      return 1;
    }
    const savedPositional = this.positional;
    const savedName = this.scriptName;
    const savedLine = this.currentLine;
    this.scriptStack.push(scriptName);
    try {
      if (source) {
        if (args.length) this.positional = args;
        try {
          return this.execList(list, io);
        } catch (e) {
          if (e instanceof ReturnSignal) return e.code;
          throw e;
        }
      }
      return this.subshell(() => {
        const s = this.state.session;
        // a child process only inherits exported variables
        const env: Record<string, string> = {};
        for (const n of s.exported) if (s.vars[n] !== undefined) env[n] = s.vars[n];
        s.vars = env;
        s.arrays = {};
        s.functions = {};
        s.aliases = {};
        this.positional = args;
        this.scriptName = scriptName;
        const saveLocals = this.locals;
        this.locals = [];
        try {
          return this.execList(list, io);
        } catch (e) {
          if (e instanceof ReturnSignal) return e.code;
          if (e instanceof BreakSignal || e instanceof ContinueSignal) return 0;
          throw e;
        } finally {
          this.locals = saveLocals;
        }
      });
    } finally {
      this.scriptStack.pop();
      this.positional = savedPositional;
      this.scriptName = savedName;
      this.currentLine = savedLine;
    }
  }

  private callFunction(name: string, body: Command, args: string[], io: IO): number {
    if (this.funcDepth >= MAX_FUNC_DEPTH) {
      io.stderr.write(`${this.errPrefix()}: ${name}: maximum function nesting level exceeded (${MAX_FUNC_DEPTH})\n`);
      return 1;
    }
    this.commandsUsed.add("function");
    const savedPositional = this.positional;
    this.positional = args;
    this.funcDepth++;
    const scope = new Map<string, { value?: string; array?: string[]; existed: boolean }>();
    this.locals.push(scope);
    try {
      return this.execCommand(body, io);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.code;
      throw e;
    } finally {
      this.locals.pop();
      for (const [n, saved] of scope) {
        delete this.state.session.vars[n];
        delete this.state.session.arrays[n];
        if (saved.existed) {
          if (saved.array) this.state.session.arrays[n] = saved.array;
          else if (saved.value !== undefined) this.state.session.vars[n] = saved.value;
        }
      }
      this.funcDepth--;
      this.positional = savedPositional;
    }
  }

  private commandNotFound(name: string, io: IO): number {
    const def = this.registry.get(name);
    const pkg = packageProvidingCommand(name);
    if (def?.package || pkg) {
      const p = def?.package ?? pkg!.name;
      io.stderr.write(`Command '${name}' not found, but can be installed with:\nsudo apt install ${p}\n`);
      return 127;
    }
    if (this.scriptStack.length) {
      io.stderr.write(`${this.errPrefix()}: ${name}: command not found\n`);
      return 127;
    }
    const candidates = [...this.registry.values()]
      .filter((d) => !d.hidden && !d.builtin && d.name.length > 1)
      .map((d) => ({ d, dist: levenshtein(name, d.name) }))
      .filter((x) => x.dist === 1 || (x.dist === 2 && name.length > 4))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);
    if (candidates.length && name.length > 1) {
      const lines = candidates.map((c) => `  command '${c.d.name}' from deb ${c.d.package ?? debFor(c.d.category)}`);
      io.stderr.write(`Command '${name}' not found, did you mean:\n${lines.join("\n")}\nTry: sudo apt install <deb name>\n`);
      return 127;
    }
    io.stderr.write(`${name}: command not found\n`);
    return 127;
  }

  /** Invoke a command definition with a prepared context. */
  invoke(def: CommandDef, name: string, args: string[], io: IO): number {
    const ctx: CommandContext = {
      name,
      args,
      shell: this,
      state: this.state,
      fs: this.fs,
      who: this.identity,
      cwd: this.cwd,
      now: this.now,
      stdin: io.stdin,
      stdoutIsTTY: io.stdout.tty,
      out: (s) => io.stdout.write(s),
      err: (s) => io.stderr.write(s),
      readAllStdin: () => {
        if (io.stdin.tty) return "";
        const rest = io.stdin.data.slice(io.stdin.pos);
        io.stdin.pos = io.stdin.data.length;
        return rest;
      },
      readLine: (prompt = "", secret = false) => {
        if (io.stdin.tty) return this.readInput(prompt, secret, io.stderr.tty ? io.stderr : this.tty);
        if (io.stdin.pos >= io.stdin.data.length) return null;
        let nl = io.stdin.data.indexOf("\n", io.stdin.pos);
        if (nl === -1) nl = io.stdin.data.length;
        const line = io.stdin.data.slice(io.stdin.pos, nl);
        io.stdin.pos = nl + 1;
        return line;
      },
    };
    try {
      return def.run(ctx);
    } catch (e) {
      if (e instanceof FsError) {
        io.stderr.write(`${name}: ${e.message}\n`);
        return 1;
      }
      if (e instanceof ArithError) {
        io.stderr.write(`${this.errPrefix()}: ${e.message}\n`);
        return 1;
      }
      if (e instanceof ExpansionError) {
        io.stderr.write(`${this.errPrefix()}: ${e.message}\n`);
        return 1;
      }
      throw e;
    }
  }

  // control flow helpers used by builtins
  doReturn(code: number): never {
    throw new ReturnSignal(code);
  }
  doBreak(levels: number): never {
    throw new BreakSignal(levels);
  }
  doContinue(levels: number): never {
    throw new ContinueSignal(levels);
  }
  doExit(code: number): never {
    throw new ExitSignal(code);
  }
  get inScript(): boolean {
    return this.scriptStack.length > 0;
  }

  /** Run a command string capturing stdout (command substitution). */
  captureOutput(cmdText: string, stderr: Sink = this.tty): { out: string; status: number } {
    let out = "";
    const sink: Sink = {
      tty: false,
      write: (s) => {
        out += s;
        if (out.length > this.maxOutput) throw new LimitError("command substitution output too large");
      },
    };
    let status = 0;
    try {
      const list = parse(cmdText);
      status = this.subshell(() => this.execList(list, { stdin: { data: "", pos: 0, tty: true }, stdout: sink, stderr }));
    } catch (e) {
      if (e instanceof ShellSyntaxError || e instanceof IncompleteInputError) {
        stderr.write(`${this.errPrefix()}: command substitution: ${e instanceof ShellSyntaxError ? e.message : "syntax error"}\n`);
        status = 2;
      } else throw e;
    }
    return { out, status };
  }

  // ------------------------------------------------------------ redirection

  private applyRedirects(redirects: Redirect[], io: IO): IO {
    if (!redirects.length) return io;
    const res: IO = { ...io };
    for (const r of redirects) {
      const fd = r.fd ?? (r.op.startsWith("<") ? 0 : 1);
      if (r.op === "<<" || r.op === "<<-") {
        const body = r.heredoc ? (r.heredoc.quoted ? r.heredoc.body : this.expandHeredoc(r.heredoc.body)) : "";
        res.stdin = { data: body, pos: 0, tty: false };
        continue;
      }
      if (r.op === "<<<") {
        const v = this.expandWord(r.target, "single").join(" ");
        res.stdin = { data: v + "\n", pos: 0, tty: false };
        continue;
      }
      if ((r.op === ">&" || r.op === "<&") && /^\d+$|^-$/.test(r.target)) {
        const target = r.target === "1" ? res.stdout : r.target === "2" ? res.stderr : null;
        if (r.target === "-") continue;
        if (!target) throw new RedirectError(`${r.target}: Bad file descriptor`);
        if (fd === 1) res.stdout = target;
        else if (fd === 2) res.stderr = target;
        continue;
      }
      const fields = this.expandWord(r.target);
      if (fields.length !== 1) throw new RedirectError(`${r.target}: ambiguous redirect`);
      const path = fields[0];
      if (r.op === "<") {
        let node: FsNode;
        try {
          node = this.lookup(path);
        } catch (e) {
          throw new RedirectError(`${path}: ${e instanceof FsError ? e.message : String(e)}`);
        }
        if (node.type === "dir") throw new RedirectError(`${path}: Is a directory`);
        if (!this.canRead(node)) throw new RedirectError(`${path}: Permission denied`);
        if (fd === 0) res.stdin = { data: this.readFileContent(node), pos: 0, tty: false };
        continue;
      }
      const append = r.op === ">>" || r.op === "&>>";
      const sink = this.openForWrite(path, append);
      if (r.op === "&>" || r.op === "&>>" || (r.op === ">&" && !/^\d+$/.test(r.target))) {
        res.stdout = sink;
        res.stderr = sink;
      } else if (fd === 1) res.stdout = sink;
      else if (fd === 2) res.stderr = sink;
    }
    return res;
  }

  /** Open a file for writing (bash truncates at redirection time). */
  openForWrite(path: string, append: boolean): Sink {
    if (path === "/dev/null") return { tty: false, write: () => {} };
    if (path === "/dev/stdout" || path === "/dev/tty") return this.tty;
    if (path === "/dev/stderr") return this.tty;
    let node: FsNode | null = null;
    try {
      node = this.lookup(path);
    } catch (e) {
      if (!(e instanceof FsError) || e.code !== "ENOENT") throw new RedirectError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const who = this.identity;
    if (node) {
      if (node.type === "dir") throw new RedirectError(`${path}: Is a directory`);
      if (node.type === "chardev") return { tty: false, write: () => {} };
      if (!canAccess(node, who, W)) throw new RedirectError(`${path}: Permission denied`);
      if (!append) {
        try {
          this.fs.writeContent(node, "", false, this.now);
        } catch (e) {
          throw new RedirectError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } else {
      try {
        const { parent, name } = this.fs.lookupParent(path, this.cwd, who);
        if (!canAccess(parent, who, W | X)) throw new FsError("EACCES");
        node = this.fs.create(parent, name, "file", { uid: who.uid, gid: who.gid, mode: 0o666 & ~this.state.session.umask, now: this.now });
      } catch (e) {
        throw new RedirectError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const id = node.id;
    return {
      tty: false,
      write: (s) => {
        const n = this.fs.get(id);
        if (!n) return;
        this.fs.writeContent(n, s, true, this.now);
      },
    };
  }

  // -------------------------------------------------------------- expansion

  /**
   * Expand a raw word.
   * - "full": brace, tilde, parameter, command, arithmetic, word splitting, globbing
   * - "single": no splitting / globbing (result joined)
   * - "assign": like single plus tilde after the =
   */
  expandWord(raw: string, mode: "full" | "single" | "assign" = "full"): string[] {
    const words = mode === "full" ? braceExpand(raw) : [raw];
    const out: string[] = [];
    for (const w of words) {
      const fields = this.expandToPieces(w, mode);
      for (const f of fields) {
        if (mode === "full" && f.some((p) => !p.q && hasGlobChars(p.s))) {
          const pattern = f.map((p) => (p.q ? escapeGlob(p.s) : p.s)).join("");
          const matches = this.glob(pattern);
          if (matches.length) {
            out.push(...matches);
            continue;
          }
        }
        out.push(f.map((p) => p.s).join(""));
      }
    }
    if (mode !== "full") return [out.join(" ")];
    return out;
  }

  /** Expand to a glob pattern where quoted characters are escaped. */
  expandPattern(raw: string): string {
    const fields = this.expandToPieces(raw, "single");
    return fields.map((f) => f.map((p) => (p.q ? escapeGlob(p.s) : p.s)).join("")).join(" ");
  }

  /** Expand $, ` and \ in a string as inside double quotes (no splitting). */
  expandString(raw: string, allowQuotes = true): string {
    if (!allowQuotes) return this.expandHeredoc(raw).replace(/\n$/, raw.endsWith("\n") ? "\n" : "");
    return this.expandWord(raw, "single").join("");
  }

  private expandHeredoc(body: string): string {
    let out = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === "\\" && i + 1 < body.length && "$`\\\n".includes(body[i + 1])) {
        if (body[i + 1] !== "\n") out += body[i + 1];
        i++;
        continue;
      }
      if (c === "$") {
        const r = this.expandDollar(body, i, true);
        if (r) {
          out += r.values.join(" ");
          i = r.end - 1;
          continue;
        }
      }
      if (c === "`") {
        const end = findBacktickEnd(body, i + 1);
        out += this.commandSubst(body.slice(i + 1, end).replace(/\\([$`\\])/g, "$1"));
        i = end;
        continue;
      }
      out += c;
    }
    return out;
  }

  private commandSubst(cmd: string): string {
    this.commandsUsed.add("command-substitution");
    const { out, status } = this.captureOutput(cmd);
    this.lastSubstStatus = status;
    this.state.session.lastExit = status;
    return out.replace(/\n+$/, "");
  }

  private expandToPieces(raw: string, mode: "full" | "single" | "assign"): Piece[][] {
    const fields: Piece[][] = [];
    let cur: Piece[] = [];
    let has = false;
    const split = mode === "full";
    const endField = () => {
      if (has) fields.push(cur);
      cur = [];
      has = false;
    };
    const lit = (s: string, q: boolean) => {
      cur.push({ s, q });
      if (s.length || q) has = true;
    };
    const expansion = (s: string, quoted: boolean) => {
      if (quoted || !split) {
        cur.push({ s, q: quoted });
        has = true;
        return;
      }
      const ifs = this.getVar("IFS") ?? " \t\n";
      if (ifs === "") {
        if (s) lit(s, true);
        return;
      }
      const wsChars = ifs.split("").filter((ch) => " \t\n".includes(ch));
      const sepChars = ifs.split("").filter((ch) => !" \t\n".includes(ch));
      let buf = "";
      for (let k = 0; k < s.length; k++) {
        const ch = s[k];
        if (wsChars.includes(ch)) {
          if (buf) {
            cur.push({ s: buf, q: false });
            has = true;
            buf = "";
          }
          endField();
        } else if (sepChars.includes(ch)) {
          cur.push({ s: buf, q: false });
          has = true;
          buf = "";
          endField();
        } else buf += ch;
      }
      if (buf) {
        // unquoted expansion results are still subject to globbing
        cur.push({ s: buf, q: false });
        has = true;
      }
    };
    const multi = (values: string[], quoted: boolean) => {
      // "$@" / "${arr[@]}": each element becomes its own field
      if (!quoted) {
        values.forEach((v, idx) => {
          if (idx > 0) endField();
          expansion(v, false);
        });
        return;
      }
      if (values.length === 0) return;
      values.forEach((v, idx) => {
        if (idx > 0) endField();
        cur.push({ s: v, q: true });
        has = true;
      });
    };

    let i = 0;
    // tilde expansion
    const tildeAt = (pos: number) => {
      const m = /^~([a-z_][a-z0-9_-]*)?(?=\/|$|:)/.exec(raw.slice(pos));
      if (!m) return 0;
      const home = m[1] ? findUser(this.state, m[1])?.home : this.getVar("HOME");
      if (home === undefined) return 0;
      lit(home, true);
      return m[0].length;
    };
    if (raw.startsWith("~")) i += tildeAt(0);

    while (i < raw.length) {
      const c = raw[i];
      if (c === "\\") {
        if (i + 1 < raw.length) lit(raw[i + 1], true);
        else lit("\\", false);
        i += 2;
        continue;
      }
      if (c === "'") {
        const end = raw.indexOf("'", i + 1);
        lit(raw.slice(i + 1, end), true);
        i = end + 1;
        continue;
      }
      if (c === '"') {
        i++;
        const piecesBefore = cur.length;
        let sawMultiEmpty = false;
        let buf = "";
        const flush = () => {
          if (buf) cur.push({ s: buf, q: true });
          buf = "";
        };
        while (i < raw.length && raw[i] !== '"') {
          const d = raw[i];
          if (d === "\\" && i + 1 < raw.length && '$`"\\\n'.includes(raw[i + 1])) {
            if (raw[i + 1] !== "\n") buf += raw[i + 1];
            i += 2;
            continue;
          }
          if (d === "$") {
            const r = this.expandDollar(raw, i, true);
            if (r) {
              flush();
              if (r.multi) {
                if (r.values.length === 0) sawMultiEmpty = true;
                multi(r.values, true);
              } else cur.push({ s: r.values.join(" "), q: true });
              i = r.end;
              continue;
            }
          }
          if (d === "`") {
            const end = findBacktickEnd(raw, i + 1);
            flush();
            cur.push({ s: this.commandSubst(raw.slice(i + 1, end).replace(/\\([$`\\])/g, "$1")), q: true });
            i = end + 1;
            continue;
          }
          buf += d;
          i++;
        }
        flush();
        if (cur.length === piecesBefore && !sawMultiEmpty) cur.push({ s: "", q: true });
        if (cur.length > piecesBefore || !sawMultiEmpty) has = has || cur.length > 0;
        i++; // closing quote
        continue;
      }
      if (c === "$") {
        if (raw[i + 1] === "'") {
          // ANSI-C quoting
          let j = i + 2;
          let s = "";
          while (j < raw.length && raw[j] !== "'") {
            if (raw[j] === "\\" && j + 1 < raw.length) {
              const e = raw[j + 1];
              const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', e: "\x1b", a: "\x07", "0": "\0" };
              s += map[e] ?? "\\" + e;
              j += 2;
              continue;
            }
            s += raw[j++];
          }
          lit(s, true);
          i = j + 1;
          continue;
        }
        const r = this.expandDollar(raw, i, false);
        if (r) {
          if (r.multi) multi(r.values, false);
          else expansion(r.values.join(" "), false);
          i = r.end;
          continue;
        }
        lit("$", false);
        i++;
        continue;
      }
      if (c === "`") {
        const end = findBacktickEnd(raw, i + 1);
        expansion(this.commandSubst(raw.slice(i + 1, end).replace(/\\([$`\\])/g, "$1")), false);
        i = end + 1;
        continue;
      }
      if (mode === "assign" && c === ":" && raw[i + 1] === "~") {
        lit(":", false);
        i++;
        const n = tildeAt(i);
        i += n || 0;
        if (!n) {
          lit("~", false);
          i++;
        }
        continue;
      }
      let j = i;
      while (j < raw.length && !"\\'\"$`".includes(raw[j]) && !(mode === "assign" && raw[j] === ":")) j++;
      if (j === i) j = i + 1;
      lit(raw.slice(i, j), false);
      i = j;
    }
    endField();
    if (mode !== "full") {
      // keep a single (possibly empty) field
      const all = fields.flat();
      return [all.length ? all : [{ s: "", q: true }]];
    }
    return fields;
  }

  /** Expand a `$...` construct at position i. Returns null if not an expansion. */
  private expandDollar(raw: string, i: number, quoted: boolean): { values: string[]; end: number; multi: boolean } | null {
    const next = raw[i + 1];
    if (next === "(" && raw[i + 2] === "(") {
      const end = skipBalanced(raw, i + 2, "(", ")");
      if (raw[end - 2] === ")") {
        const expr = raw.slice(i + 3, end - 2);
        try {
          return { values: [String(this.arith(expr))], end, multi: false };
        } catch (e) {
          if (e instanceof ArithError) throw new ExpansionError(`${expr.trim()}: ${e.message}`);
          throw e;
        }
      }
    }
    if (next === "(") {
      const end = skipBalanced(raw, i + 2, "(", ")");
      return { values: [this.commandSubst(raw.slice(i + 2, end - 1))], end, multi: false };
    }
    if (next === "{") {
      const end = skipBalanced(raw, i + 2, "{", "}");
      const inner = raw.slice(i + 2, end - 1);
      const r = this.paramExpand(inner, quoted);
      return { ...r, end };
    }
    if (next === undefined) return null;
    if (/[A-Za-z_]/.test(next)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(raw.slice(i + 1))!;
      return { values: [this.getVar(m[0]) ?? ""], end: i + 1 + m[0].length, multi: false };
    }
    if (/[0-9]/.test(next)) {
      const n = Number(next);
      return { values: [n === 0 ? this.scriptName : (this.positional[n - 1] ?? "")], end: i + 2, multi: false };
    }
    switch (next) {
      case "@":
        return { values: [...this.positional], end: i + 2, multi: true };
      case "*":
        return { values: quoted ? [this.positional.join(" ")] : [...this.positional], end: i + 2, multi: !quoted };
      case "#":
        return { values: [String(this.positional.length)], end: i + 2, multi: false };
      case "?":
        return { values: [String(this.state.session.lastExit)], end: i + 2, multi: false };
      case "$":
        return { values: [String(this.state.processes.find((p) => p.command === "bash" && p.user === this.frame.user)?.pid ?? 4242)], end: i + 2, multi: false };
      case "!":
        return { values: [this.lastBgPid ? String(this.lastBgPid) : ""], end: i + 2, multi: false };
      case "-":
        return { values: ["himBHs"], end: i + 2, multi: false };
    }
    return null;
  }

  private paramExpand(inner: string, quoted: boolean): { values: string[]; multi: boolean } {
    const single = (v: string) => ({ values: [v], multi: false });
    // ${#...}
    if (inner.startsWith("#") && inner.length > 1) {
      const name = inner.slice(1);
      const am = /^([A-Za-z_][A-Za-z0-9_]*)\[([@*])\]$/.exec(name);
      if (am) return single(String((this.getArray(am[1]) ?? []).filter((x) => x !== undefined).length));
      if (name === "@" || name === "*") return single(String(this.positional.length));
      const v = this.lookupParam(name);
      return single(String((v ?? "").length));
    }
    if (inner === "#") return single(String(this.positional.length));
    // ${!arr[@]} indices / ${!name} indirection
    if (inner.startsWith("!")) {
      const am = /^!([A-Za-z_][A-Za-z0-9_]*)\[([@*])\]$/.exec(inner);
      if (am) {
        const arr = this.getArray(am[1]) ?? [];
        return { values: arr.map((_, idx) => String(idx)).filter((_, idx) => arr[idx] !== undefined), multi: true };
      }
      const target = this.getVar(inner.slice(1)) ?? "";
      return single(this.getVar(target) ?? "");
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*?#$!-])(\[[^\]]*\])?(.*)$/s.exec(inner);
    if (!m) throw new ExpansionError(`\${${inner}}: bad substitution`);
    const [, name, sub, rest] = m;

    // arrays
    if (sub) {
      const idx = sub.slice(1, -1);
      const arr = this.getArray(name) ?? (this.state.session.vars[name] !== undefined ? [this.state.session.vars[name]] : []);
      if (idx === "@" || idx === "*") {
        const vals = arr.filter((x) => x !== undefined);
        if (rest) return single(this.applyOperator(vals.join(" "), rest, name));
        if (idx === "*" && quoted) return single(vals.join(" "));
        return { values: vals, multi: true };
      }
      const value = arr[this.arith(idx)];
      return single(this.applyOperator(value, rest, name));
    }
    if ((name === "@" || name === "*") && !rest) {
      if (name === "*" && quoted) return single(this.positional.join(" "));
      return { values: [...this.positional], multi: true };
    }
    const value = this.lookupParam(name);
    return single(this.applyOperator(value, rest, name));
  }

  private lookupParam(name: string): string | undefined {
    if (/^[0-9]+$/.test(name)) {
      const n = Number(name);
      return n === 0 ? this.scriptName : this.positional[n - 1];
    }
    switch (name) {
      case "@":
      case "*":
        return this.positional.join(" ");
      case "?":
        return String(this.state.session.lastExit);
      case "#":
        return String(this.positional.length);
      case "$":
        return "4242";
      case "!":
        return this.lastBgPid ? String(this.lastBgPid) : "";
    }
    return this.getVar(name);
  }

  private applyOperator(value: string | undefined, op: string, name: string): string {
    if (!op) return value ?? "";
    const word = (s: string) => this.expandWord(s, "single").join("");
    let m: RegExpExecArray | null;
    if ((m = /^(:?)([-=+?])(.*)$/s.exec(op))) {
      const [, colon, kind, w] = m;
      const unset = value === undefined || (colon === ":" && value === "");
      switch (kind) {
        case "-":
          return unset ? word(w) : value!;
        case "=":
          if (unset) {
            const v = word(w);
            this.setVar(name, v);
            return v;
          }
          return value!;
        case "+":
          return unset ? "" : word(w);
        case "?":
          if (unset) throw new ExpansionError(`${name}: ${w ? word(w) : "parameter null or not set"}`);
          return value!;
      }
    }
    const v = value ?? "";
    if ((m = /^(##?|%%?)(.*)$/s.exec(op))) {
      const [, kind, patRaw] = m;
      const pat = this.expandPattern(patRaw);
      const re = globToRegExp(pat);
      if (kind.startsWith("#")) {
        const lengths = [...Array(v.length + 1).keys()];
        if (kind === "##") lengths.reverse();
        for (const l of lengths) if (re.test(v.slice(0, l))) return v.slice(l);
        return v;
      }
      const starts = [...Array(v.length + 1).keys()];
      if (kind === "%") starts.reverse();
      for (const s of starts) if (re.test(v.slice(s))) return v.slice(0, s);
      return v;
    }
    if ((m = /^\/(\/|#|%)?((?:\\.|[^/])*)(?:\/(.*))?$/s.exec(op))) {
      const [, mode, patRaw, repRaw = ""] = m;
      const pat = globToRegExp(this.expandPattern(patRaw)).source.slice(1, -1);
      const rep = word(repRaw);
      if (!patRaw) return v;
      const anchored = mode === "#" ? `^(?:${pat})` : mode === "%" ? `(?:${pat})$` : pat;
      const re = new RegExp(anchored, mode === "/" ? "g" : "");
      return v.replace(re, () => rep);
    }
    if ((m = /^:(-?\s*\d+|\s*\(?-\d+\)?)(?::(-?\d+))?$/.exec(op))) {
      let off = Number(m[1].replace(/[()\s]/g, ""));
      if (off < 0) off = Math.max(0, v.length + off);
      if (m[2] === undefined) return v.slice(off);
      const len = Number(m[2]);
      return len < 0 ? v.slice(off, v.length + len) : v.slice(off, off + len);
    }
    if (op === "^^") return v.toUpperCase();
    if (op === ",,") return v.toLowerCase();
    if (op === "^") return v.charAt(0).toUpperCase() + v.slice(1);
    if (op === ",") return v.charAt(0).toLowerCase() + v.slice(1);
    throw new ExpansionError(`\${${name}${op}}: bad substitution`);
  }

  /** Expand a glob pattern against the virtual filesystem. */
  glob(pattern: string): string[] {
    const absolute = pattern.startsWith("/");
    const parts = pattern.split("/").filter((p, idx) => p.length > 0 || idx === 0);
    let paths: string[] = [absolute ? "/" : ""];
    const comps = absolute ? parts.slice(1) : parts;
    for (let ci = 0; ci < comps.length; ci++) {
      const comp = comps[ci];
      const nextPaths: string[] = [];
      const isLast = ci === comps.length - 1;
      for (const base of paths) {
        const join = (name: string) => (base === "" ? name : base === "/" ? `/${name}` : `${base}/${name}`);
        if (!hasGlobChars(comp)) {
          const candidate = join(comp.replace(/\\(.)/g, "$1"));
          if (isLast || this.fs.tryLookup(candidate, this.cwd, this.identity)) nextPaths.push(candidate);
          continue;
        }
        const dir = this.fs.tryLookup(base === "" ? "." : base, this.cwd, this.identity);
        if (!dir || dir.type !== "dir" || !canAccess(dir, this.identity, R)) continue;
        const re = globToRegExp(comp);
        const names = this.fs.childNames(dir).filter((n) => (n.startsWith(".") ? comp.startsWith(".") : true) && re.test(n));
        names.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
        for (const n of names) nextPaths.push(join(n));
      }
      paths = nextPaths;
      if (!paths.length) return [];
    }
    return paths.filter((p) => this.fs.tryLookup(p, this.cwd, this.identity, false));
  }

  // ---------------------------------------------------------------- helpers

  /** Parse+execute text (used by eval / sudo -c / su -c). */
  evalText(text: string, io: IO): number {
    let list: List;
    try {
      list = parse(text);
    } catch (e) {
      if (e instanceof ShellSyntaxError) {
        io.stderr.write(`${this.errPrefix()}: ${e.message}\n`);
        return 2;
      }
      if (e instanceof IncompleteInputError) {
        io.stderr.write(`${this.errPrefix()}: syntax error: unexpected end of file\n`);
        return 2;
      }
      throw e;
    }
    return this.execList(list, io);
  }

  ioFromContext(ctx: CommandContext): IO {
    return {
      stdin: ctx.stdin,
      stdout: { tty: ctx.stdoutIsTTY, write: ctx.out },
      stderr: { tty: true, write: ctx.err },
    };
  }

  uptimeText(): string {
    return uptimeString(this.state, this.now);
  }
}

export class RedirectError extends Error {}
export class ExpansionError extends Error {}

function findBacktickEnd(raw: string, i: number): number {
  while (i < raw.length) {
    if (raw[i] === "\\") {
      i += 2;
      continue;
    }
    if (raw[i] === "`") return i;
    i++;
  }
  return raw.length;
}

function escapeGlob(s: string): string {
  return s.replace(/[*?[\]\\]/g, "\\$&");
}

export function parseDuration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(s);
  if (!m) return 0;
  const n = Number(m[1]);
  return n * ({ "": 1, s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]];
}

function debFor(category: string): string {
  switch (category) {
    case "processes":
      return "procps";
    case "networking":
      return "iproute2";
    case "users":
      return "passwd";
    case "packages":
      return "apt";
    case "storage":
      return "util-linux";
    default:
      return "coreutils";
  }
}

/** Bash brace expansion: a{b,c}d, {1..5}, {a..e}, {01..10..2}. */
export function braceExpand(word: string): string[] {
  // find first top-level unquoted { with a matching }
  let i = 0;
  let quote: string | null = null;
  while (i < word.length) {
    const c = word[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"') i++;
      i++;
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      i++;
      continue;
    }
    if (c === "$" && word[i + 1] === "{") {
      try {
        i = skipBalanced(word, i + 2, "{", "}");
      } catch {
        return [word];
      }
      continue;
    }
    if (c === "{") {
      // find matching close and top-level commas
      let depth = 0;
      const commas: number[] = [];
      let j = i;
      let q: string | null = null;
      for (; j < word.length; j++) {
        const d = word[j];
        if (q) {
          if (d === q) q = null;
          continue;
        }
        if (d === "\\") {
          j++;
          continue;
        }
        if (d === "'" || d === '"') {
          q = d;
          continue;
        }
        if (d === "{") depth++;
        else if (d === "}") {
          depth--;
          if (depth === 0) break;
        } else if (d === "," && depth === 1) commas.push(j);
      }
      if (j >= word.length) return [word];
      const pre = word.slice(0, i);
      const post = word.slice(j + 1);
      const body = word.slice(i + 1, j);
      let alts: string[] | null = null;
      if (commas.length) {
        alts = [];
        let last = i + 1;
        for (const c2 of commas) {
          alts.push(word.slice(last, c2));
          last = c2 + 1;
        }
        alts.push(word.slice(last, j));
      } else {
        const seq = /^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])(?:\.\.(-?\d+))?$/.exec(body);
        if (seq) alts = sequence(seq[1], seq[2], seq[3]);
      }
      if (!alts) {
        // not a valid brace expression: keep literal brace, continue after it
        const restExpanded = braceExpand(word.slice(i + 1));
        return restExpanded.map((r) => word.slice(0, i + 1) + r);
      }
      const results: string[] = [];
      for (const alt of alts) for (const r of braceExpand(pre + alt + post)) results.push(r);
      return results;
    }
    i++;
  }
  return [word];
}

function sequence(a: string, b: string, stepStr?: string): string[] | null {
  const step = Math.abs(Number(stepStr ?? 1)) || 1;
  const out: string[] = [];
  if (/^-?\d+$/.test(a) && /^-?\d+$/.test(b)) {
    const start = Number(a);
    const end = Number(b);
    const width = (a.startsWith("0") && a.length > 1) || (b.startsWith("0") && b.length > 1) ? Math.max(a.length, b.length) : 0;
    const dir = start <= end ? 1 : -1;
    for (let v = start; dir > 0 ? v <= end : v >= end; v += dir * step) {
      out.push(width ? String(v).padStart(width, "0") : String(v));
      if (out.length > 10000) return null;
    }
    return out;
  }
  if (/^[a-zA-Z]$/.test(a) && /^[a-zA-Z]$/.test(b)) {
    const s = a.charCodeAt(0);
    const e = b.charCodeAt(0);
    const dir = s <= e ? 1 : -1;
    for (let v = s; dir > 0 ? v <= e : v >= e; v += dir * step) out.push(String.fromCharCode(v));
    return out;
  }
  return null;
}
