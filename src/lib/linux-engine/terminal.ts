import { COMMAND_REGISTRY } from "./commands";
import { VirtualFileSystem } from "./filesystem";
import { ExitSignal, LimitError, NeedInputSignal, Shell } from "./interpreter";
import { IncompleteInputError, parse, ShellSyntaxError } from "./parser";
import { canAccess, X } from "./permissions";
import { reapProcesses } from "./processes";
import type { EnvState, ExecResult, PromptInfo } from "./types";
import { findUser } from "./users";

export interface ExecuteOptions {
  /** Answers to interactive prompts collected so far (passwords, y/n...). */
  inputs?: string[];
  now?: number;
  maxSteps?: number;
  /** Do not record the line in history (GUI / grading operations). */
  noHistory?: boolean;
}

export interface CompletionResult {
  /** Index in the line where the completed word starts. */
  start: number;
  /** Full replacement candidates for the word. */
  matches: string[];
  /** Short names to display when several matches exist. */
  display: string[];
  /** Longest common prefix of all matches. */
  common: string;
}

export const MAX_HISTORY = 1000;
export const MAX_LINE_LENGTH = 16 * 1024;

/**
 * A student's virtual Linux machine. Wraps the serialisable state and
 * exposes command execution and tab completion.
 */
export class LinuxEnvironment {
  fs: VirtualFileSystem;

  constructor(public state: EnvState) {
    this.fs = new VirtualFileSystem(state);
  }

  prompt(): PromptInfo {
    const frame = this.state.session.userStack[this.state.session.userStack.length - 1];
    const user = findUser(this.state, frame.user);
    const home = user?.home ?? "/";
    let display = frame.cwd;
    if (home !== "/" && (display === home || display.startsWith(home + "/"))) display = "~" + display.slice(home.length);
    return { user: frame.user, host: this.state.hostname, cwd: frame.cwd, display, isRoot: user?.uid === 0 };
  }

  /** Expand !!, !n, !-n and !prefix like bash history expansion. */
  private historyExpand(line: string): { line: string; changed: boolean; error?: string } {
    // only the first line of pasted multi-line input is subject to expansion
    const firstNl = line.indexOf("\n");
    if (firstNl !== -1) {
      const head = this.historyExpand(line.slice(0, firstNl));
      return { ...head, line: head.line + line.slice(firstNl) };
    }
    if (!line.includes("!")) return { line, changed: false };
    const hist = this.state.session.history;
    let out = "";
    let changed = false;
    let inSingle = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "'" && line[i - 1] !== "\\") inSingle = !inSingle;
      if (c !== "!" || inSingle || line[i - 1] === "\\" || line[i - 1] === "#") {
        out += c;
        continue;
      }
      const rest = line.slice(i + 1);
      let m: RegExpExecArray | null;
      let replacement: string | undefined;
      let len = 0;
      if (rest.startsWith("!")) {
        replacement = hist[hist.length - 1];
        len = 1;
        if (replacement === undefined) return { line, changed: false, error: "!!: event not found" };
      } else if ((m = /^-?\d+/.exec(rest))) {
        const n = Number(m[0]);
        replacement = n < 0 ? hist[hist.length + n] : hist[n - 1];
        len = m[0].length;
        if (replacement === undefined) return { line, changed: false, error: `!${m[0]}: event not found` };
      } else if ((m = /^[A-Za-z_./][^\s;|&]*/.exec(rest))) {
        const prefix = m[0];
        replacement = [...hist].reverse().find((h) => h.startsWith(prefix));
        len = prefix.length;
        if (replacement === undefined) return { line, changed: false, error: `!${prefix}: event not found` };
      }
      if (replacement === undefined) {
        out += c;
        continue;
      }
      out += replacement;
      i += len;
      changed = true;
    }
    return { line: out, changed };
  }

  execute(rawLine: string, opts: ExecuteOptions = {}): ExecResult & { incomplete?: boolean } {
    const now = opts.now ?? Date.now();
    const before = JSON.stringify(this.state);
    const snapshot = JSON.parse(before) as EnvState;
    let output = "";
    let exitCode = 0;

    const finish = (extra: Partial<ExecResult> & { incomplete?: boolean }, shell?: Shell): ExecResult & { incomplete?: boolean } => {
      const after = JSON.stringify(this.state);
      return {
        output,
        exitCode,
        actions: shell?.actions ?? [],
        prompt: this.prompt(),
        commandsUsed: shell ? [...shell.commandsUsed] : [],
        mutated: after !== before,
        ...extra,
      };
    };

    if (rawLine.length > MAX_LINE_LENGTH) {
      output = "bash: command line too long\n";
      exitCode = 1;
      return finish({});
    }

    let line = rawLine.replace(/\r/g, "");
    const expanded = this.historyExpand(line);
    if (expanded.error) {
      output = `bash: ${expanded.error}\n`;
      exitCode = 1;
      this.state.session.lastExit = 1;
      return finish({});
    }
    if (expanded.changed) {
      line = expanded.line;
      output += line + "\n";
    }

    let list;
    try {
      list = parse(line);
    } catch (e) {
      if (e instanceof IncompleteInputError) {
        return finish({ incomplete: true, output: "" });
      }
      if (e instanceof ShellSyntaxError) {
        this.addHistory(line, opts);
        output += `bash: ${e.message}\n`;
        exitCode = 2;
        this.state.session.lastExit = 2;
        return finish({});
      }
      throw e;
    }

    this.addHistory(line, opts);
    const shell = new Shell(this.state, this.fs, { now, inputs: opts.inputs ?? [], registry: COMMAND_REGISTRY, maxSteps: opts.maxSteps });
    try {
      exitCode = shell.execList(list, { stdin: { data: "", pos: 0, tty: true }, stdout: shell.tty, stderr: shell.tty });
    } catch (e) {
      if (e instanceof NeedInputSignal) {
        // roll back: the whole line is replayed once the input is available
        this.restore(snapshot);
        output += shell.output;
        return { output, exitCode: 0, needsInput: e.prompt, actions: [], prompt: this.prompt(), commandsUsed: [], mutated: false };
      }
      if (e instanceof ExitSignal) exitCode = e.code;
      else if (e instanceof LimitError) {
        output += shell.output.slice(0, 64 * 1024);
        output += `\nbash: ${e.message}\n`;
        exitCode = 1;
        this.state.session.lastExit = exitCode;
        return finish({}, shell);
      } else throw e;
    }
    this.state.session.lastExit = exitCode;
    output += shell.output;
    const notices = [...shell.jobNotices, ...reapProcesses(this.state, now)];
    if (notices.length) output += notices.join("\n") + "\n";
    return finish({}, shell);
  }

  private addHistory(line: string, opts: ExecuteOptions) {
    if (opts.noHistory) return;
    const h = this.state.session.history;
    const trimmed = line.trim();
    if (!trimmed || line.startsWith(" ")) return;
    if (h[h.length - 1] === line) return;
    h.push(line);
    if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
  }

  private restore(snapshot: EnvState) {
    for (const k of Object.keys(this.state) as (keyof EnvState)[]) delete (this.state as unknown as Record<string, unknown>)[k];
    Object.assign(this.state, snapshot);
    this.fs = new VirtualFileSystem(this.state);
  }

  /**
   * Run a command line as root without touching the user's session
   * (used by the graphical tools and challenge setup scripts).
   */
  runAsRoot(line: string, opts: { now?: number } = {}): { output: string; exitCode: number } {
    const stack = this.state.session.userStack;
    const savedHistory = [...this.state.session.history];
    const savedLastExit = this.state.session.lastExit;
    const savedVars = { ...this.state.session.vars };
    stack.push({ user: "root", cwd: "/root", login: true });
    const depth = stack.length;
    try {
      const res = this.execute(line, { now: opts.now, noHistory: true, inputs: [] });
      if (res.needsInput) return { output: res.output + `\n(command needs interactive input: ${res.needsInput.prompt})\n`, exitCode: 1 };
      return { output: res.output, exitCode: res.exitCode };
    } finally {
      // drop root frame (and any frames the command pushed)
      this.state.session.userStack.length = Math.max(1, depth - 1);
      this.state.session.history = savedHistory;
      this.state.session.lastExit = savedLastExit;
      this.state.session.vars = savedVars;
    }
  }

  complete(line: string, cursor = line.length): CompletionResult {
    const prefix = line.slice(0, cursor);
    let start = prefix.length;
    while (start > 0 && !/[\s;|&<>()]/.test(prefix[start - 1])) start--;
    const word = prefix.slice(start);
    const before = prefix.slice(0, start).trimEnd();
    const frame = this.state.session.userStack[this.state.session.userStack.length - 1];
    const shell = new Shell(this.state, this.fs, { now: Date.now(), inputs: [], registry: COMMAND_REGISTRY });
    const who = shell.identity;

    const result = (matches: string[], display: string[]): CompletionResult => {
      const uniq = [...new Set(matches)].sort();
      let common = uniq[0] ?? "";
      for (const m of uniq) while (!m.startsWith(common)) common = common.slice(0, -1);
      return { start, matches: uniq, display: [...new Set(display)].sort(), common };
    };

    if (word.startsWith("$")) {
      const names = [...Object.keys(this.state.session.vars), "HOME", "USER", "PWD", "OLDPWD", "HOSTNAME", "SHELL", "UID", "RANDOM"].filter((n) => n !== "HOME_OVERRIDE");
      const m = names.filter((n) => n.startsWith(word.slice(1))).map((n) => "$" + n);
      return result(m, m);
    }

    const cmdPos = before === "" || /[|;&(]$/.test(before) || /(^|[|;&(]\s*)(sudo|time|nohup|xargs|which|man|type|whatis|whereis|exec|command)$/.test(before);
    if (cmdPos && !word.includes("/")) {
      const names = new Set<string>();
      for (const [n, d] of COMMAND_REGISTRY) if (d.builtin) names.add(n);
      Object.keys(this.state.session.aliases).forEach((n) => names.add(n));
      Object.keys(this.state.session.functions).forEach((n) => names.add(n));
      for (const dir of (shell.getVar("PATH") ?? "").split(":")) {
        const d = this.fs.tryLookup(dir, "/", who);
        if (!d || d.type !== "dir" || !canAccess(d, who, X)) continue;
        for (const c of this.fs.list(d)) if (c.type !== "dir") names.add(c.name);
      }
      const m = [...names].filter((n) => n.startsWith(word) && n !== "[" && n !== ":");
      return result(m, m);
    }

    // path completion
    const home = findUser(this.state, frame.user)?.home ?? "/";
    const unescaped = word.replace(/\\(.)/g, "$1");
    const slash = unescaped.lastIndexOf("/");
    const dirPart = slash === -1 ? "" : unescaped.slice(0, slash + 1);
    const base = slash === -1 ? unescaped : unescaped.slice(slash + 1);
    let dirPath = dirPart === "" ? "." : dirPart;
    if (dirPath.startsWith("~")) dirPath = home + dirPath.slice(1);
    const dir = this.fs.tryLookup(dirPath, frame.cwd, who);
    if (!dir || dir.type !== "dir" || !canAccess(dir, who, X) || !canAccess(dir, who, 4)) return result([], []);
    const firstWord = before.split(/\s+/).filter(Boolean).pop();
    const dirsOnly = before.split(/[|;&]/).pop()?.trim().split(/\s+/)[0] === "cd" || firstWord === "cd";
    const entries = this.fs
      .list(dir)
      .filter((c) => c.name.startsWith(base) && (base.startsWith(".") || !c.name.startsWith(".")))
      .map((c) => {
        let isDir = c.type === "dir";
        if (c.type === "symlink") {
          const target = this.fs.tryLookup(this.fs.pathOf(c), "/", who);
          isDir = target?.type === "dir";
        }
        return { name: c.name, isDir };
      })
      .filter((e) => !dirsOnly || e.isDir);
    const esc = (s: string) => s.replace(/([ \\'"$`!&;|<>()*?[\]{}])/g, "\\$1");
    const matches = entries.map((e) => esc(dirPart) + esc(e.name) + (e.isDir ? "/" : ""));
    const display = entries.map((e) => e.name + (e.isDir ? "/" : ""));
    return result(matches, display);
  }
}
