import { ArithError, evalArith } from "../arith";
import { FsError, normalizePath } from "../filesystem";
import { canAccess, X } from "../permissions";
import { parse as parseOnly } from "../parser";
import { evalTest, TestError } from "../test-expr";
import type { CommandContext, CommandDef } from "./types";

const keywords = new Set(["if", "then", "else", "elif", "fi", "case", "esac", "for", "while", "until", "do", "done", "function", "in", "{", "}", "!", "[[", "]]", "time", "select"]);

/** Interpret backslash escapes for `echo -e` and printf. Returns [text, stop]. */
export function interpretEscapes(s: string, octalNeedsZero = true): [string, boolean] {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\" || i + 1 >= s.length) {
      out += c;
      continue;
    }
    const n = s[++i];
    switch (n) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += "\r";
        break;
      case "a":
        out += "\x07";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "v":
        out += "\v";
        break;
      case "e":
      case "E":
        out += "\x1b";
        break;
      case "\\":
        out += "\\";
        break;
      case "c":
        return [out, true];
      case "x": {
        const m = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 1));
        if (m) {
          out += String.fromCharCode(parseInt(m[0], 16));
          i += m[0].length;
        } else out += "\\x";
        break;
      }
      case "0":
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7": {
        if (octalNeedsZero && n !== "0") {
          out += "\\" + n;
          break;
        }
        const m = /^[0-7]{1,3}/.exec(s.slice(n === "0" && octalNeedsZero ? i + 1 : i));
        if (m) {
          out += String.fromCharCode(parseInt(m[0], 8));
          i += m[0].length - (n === "0" && octalNeedsZero ? 0 : 1);
        } else out += "\0";
        break;
      }
      default:
        out += "\\" + n;
    }
  }
  return [out, false];
}

export function printfFormat(format: string, args: string[], onError: (msg: string) => void): string {
  let out = "";
  let argi = 0;
  const nextArg = () => (argi < args.length ? args[argi++] : undefined);
  let consumedAny = false;
  do {
    consumedAny = false;
    const startArg = argi;
    for (let i = 0; i < format.length; i++) {
      const c = format[i];
      if (c === "\\") {
        const [esc] = interpretEscapes(format.slice(i, i + 4).match(/^\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/)?.[0] ?? "\\", false);
        const len = format.slice(i).match(/^\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/)?.[0].length ?? 1;
        out += esc;
        i += len - 1;
        continue;
      }
      if (c !== "%") {
        out += c;
        continue;
      }
      const m = /^%([-+ #0]*)(\d+|\*)?(?:\.(\d+|\*))?([sdifxXoceEgGb%])/.exec(format.slice(i));
      if (!m) {
        out += c;
        continue;
      }
      i += m[0].length - 1;
      const [, flagStr, widthRaw, precRaw, conv] = m;
      if (conv === "%") {
        out += "%";
        continue;
      }
      const width = widthRaw === "*" ? Number(nextArg() ?? 0) : widthRaw ? Number(widthRaw) : 0;
      const prec = precRaw === "*" ? Number(nextArg() ?? 0) : precRaw !== undefined ? Number(precRaw) : undefined;
      const arg = nextArg();
      if (arg !== undefined) consumedAny = true;
      let s: string;
      switch (conv) {
        case "s":
          s = arg ?? "";
          if (prec !== undefined) s = s.slice(0, prec);
          break;
        case "b":
          s = interpretEscapes(arg ?? "", true)[0];
          break;
        case "c":
          s = (arg ?? "").charAt(0);
          break;
        case "d":
        case "i": {
          const v = toNum(arg, onError);
          s = String(Math.trunc(v));
          if (flagStr.includes("+") && v >= 0) s = "+" + s;
          break;
        }
        case "x":
        case "X":
        case "o": {
          const v = Math.trunc(toNum(arg, onError));
          s = v.toString(conv === "o" ? 8 : 16);
          if (conv === "X") s = s.toUpperCase();
          if (flagStr.includes("#") && v !== 0) s = (conv === "o" ? "0" : conv === "x" ? "0x" : "0X") + s;
          break;
        }
        case "f":
        case "e":
        case "E":
        case "g":
        case "G": {
          const v = toNum(arg, onError);
          s = conv === "f" ? v.toFixed(prec ?? 6) : conv.toLowerCase() === "e" ? v.toExponential(prec ?? 6) : String(Number(v.toPrecision(prec || 6)));
          if (conv === "E" || conv === "G") s = s.toUpperCase();
          if (flagStr.includes("+") && v >= 0) s = "+" + s;
          break;
        }
        default:
          s = arg ?? "";
      }
      if (width && s.length < width) {
        if (flagStr.includes("-")) s = s.padEnd(width);
        else if (flagStr.includes("0") && /[dixXofeEgG]/.test(conv)) {
          const neg = s.startsWith("-");
          s = (neg ? "-" : "") + s.replace(/^-/, "").padStart(width - (neg ? 1 : 0), "0");
        } else s = s.padStart(width);
      }
      out += s;
    }
    if (argi === startArg) break;
  } while (argi < args.length && consumedAny);
  return out;
}

function toNum(arg: string | undefined, onError: (msg: string) => void): number {
  if (arg === undefined || arg === "") return 0;
  if (/^'./.test(arg) || /^"./.test(arg)) return arg.charCodeAt(1);
  const v = Number(arg);
  if (Number.isNaN(v)) {
    onError(`${arg}: invalid number`);
    return 0;
  }
  return v;
}

function cdCommand(ctx: CommandContext): number {
  const sh = ctx.shell;
  const args = ctx.args.filter((a) => a !== "-L" && a !== "-P" && a !== "--");
  if (args.length > 1) {
    ctx.err(`${sh.errPrefix()}: cd: too many arguments\n`);
    return 1;
  }
  let target = args[0];
  let print = false;
  if (target === undefined || target === "") target = sh.getVar("HOME") ?? "/";
  else if (target === "-") {
    const old = sh.frame.oldpwd;
    if (!old) {
      ctx.err(`${sh.errPrefix()}: cd: OLDPWD not set\n`);
      return 1;
    }
    target = old;
    print = true;
  }
  const abs = normalizePath(target, ctx.cwd);
  try {
    const node = ctx.fs.lookup(abs, "/", ctx.who);
    if (node.type !== "dir") throw new FsError("ENOTDIR");
    if (!canAccess(node, ctx.who, X)) throw new FsError("EACCES");
  } catch (e) {
    const msg = e instanceof FsError ? e.message : String(e);
    ctx.err(`${sh.errPrefix()}: cd: ${args[0] ?? target}: ${msg}\n`);
    return 1;
  }
  sh.frame.oldpwd = ctx.cwd;
  sh.cwd = abs;
  if (print) ctx.out(abs + "\n");
  return 0;
}

function echoCommand(ctx: CommandContext): number {
  let newline = true;
  let escapes = false;
  let i = 0;
  for (; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (!/^-[neE]+$/.test(a)) break;
    for (const f of a.slice(1)) {
      if (f === "n") newline = false;
      else if (f === "e") escapes = true;
      else if (f === "E") escapes = false;
    }
  }
  let text = ctx.args.slice(i).join(" ");
  if (escapes) {
    const [t, stop] = interpretEscapes(text);
    text = t;
    if (stop) newline = false;
  }
  ctx.out(text + (newline ? "\n" : ""));
  return 0;
}

function readCommand(ctx: CommandContext): number {
  const sh = ctx.shell;
  let prompt = "";
  let raw = false;
  let secret = false;
  let arrayName: string | null = null;
  let nchars: number | null = null;
  const names: string[] = [];
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a.startsWith("-") && a.length > 1 && names.length === 0) {
      for (let j = 1; j < a.length; j++) {
        const f = a[j];
        if (f === "r") raw = true;
        else if (f === "s") secret = true;
        else if (f === "p" || f === "a" || f === "n" || f === "t" || f === "d") {
          const v = a.slice(j + 1) || ctx.args[++i] || "";
          if (f === "p") prompt = v;
          else if (f === "a") arrayName = v;
          else if (f === "n") nchars = Number(v) || null;
          break;
        } else {
          ctx.err(`${sh.errPrefix()}: read: -${f}: invalid option\nread: usage: read [-ers] [-a array] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]\n`);
          return 2;
        }
      }
    } else names.push(a);
  }
  let line: string | null;
  if (ctx.stdin.tty) {
    line = sh.readInput(prompt, secret);
  } else {
    line = ctx.readLine();
  }
  if (line === null) {
    for (const n of names.length ? names : ["REPLY"]) sh.setVar(n, "");
    return 1;
  }
  if (nchars !== null) line = line.slice(0, nchars);
  if (!raw) line = line.replace(/\\(.)/g, "$1");
  if (arrayName) {
    sh.setArray(arrayName, line.trim().split(/\s+/).filter(Boolean));
    return 0;
  }
  if (names.length === 0) {
    sh.setVar("REPLY", line);
    return 0;
  }
  const parts = line.trim().split(/[ \t]+/);
  names.forEach((n, idx) => {
    if (idx === names.length - 1) sh.setVar(n, parts.slice(idx).join(" "));
    else sh.setVar(n, parts[idx] ?? "");
  });
  return 0;
}

function declareCommand(ctx: CommandContext, local: boolean): number {
  const sh = ctx.shell;
  if (local && !sh.inFunction) {
    ctx.err(`${sh.errPrefix()}: local: can only be used in a function\n`);
    return 1;
  }
  let exportFlag = false;
  let arrayFlag = false;
  let print = false;
  const items: string[] = [];
  for (const a of ctx.args) {
    if (/^[-+][aAirxpgfFlu]+$/.test(a) && items.length === 0) {
      if (a.includes("x")) exportFlag = true;
      if (a.includes("a")) arrayFlag = true;
      if (a.includes("p")) print = true;
      continue;
    }
    items.push(a);
  }
  if (items.length === 0 || print) {
    const s = ctx.state.session;
    const names = items.length ? items : Object.keys(s.vars).sort();
    for (const n of names) {
      if (s.arrays[n]) ctx.out(`declare -a ${n}=(${s.arrays[n].map((v, i) => `[${i}]="${v}"`).join(" ")})\n`);
      else if (s.vars[n] !== undefined) ctx.out(`declare ${s.exported.includes(n) ? "-x" : "--"} ${n}="${s.vars[n]}"\n`);
    }
    return 0;
  }
  for (const item of items) {
    const eq = item.indexOf("=");
    const name = eq === -1 ? item : item.slice(0, eq).replace(/\+$/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.replace(/\[.*\]$/, ""))) {
      ctx.err(`${sh.errPrefix()}: ${local ? "local" : "declare"}: \`${item}': not a valid identifier\n`);
      return 1;
    }
    if (local) sh.declareLocal(name);
    if (eq === -1) {
      if (arrayFlag && !sh.getArray(name)) sh.setArray(name, []);
      else if (local) delete ctx.state.session.vars[name];
    } else {
      const value = item.slice(eq + 1);
      if (value.startsWith("(") && value.endsWith(")")) sh.assign(item);
      else if (arrayFlag) sh.setArray(name, [value]);
      else sh.setVar(name, value);
    }
    if (exportFlag) sh.exportVar(name);
  }
  return 0;
}

function testCommand(ctx: CommandContext, bracket: boolean): number {
  let args = ctx.args;
  if (bracket) {
    if (args[args.length - 1] !== "]") {
      ctx.err(`${ctx.shell.errPrefix()}: [: missing \`]'\n`);
      return 2;
    }
    args = args.slice(0, -1);
  }
  try {
    return evalTest(args, ctx.shell.testHost(), "test") ? 0 : 1;
  } catch (e) {
    if (e instanceof TestError) {
      ctx.err(`${ctx.shell.errPrefix()}: ${bracket ? "[" : "test"}: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

function jobSpec(ctx: CommandContext, spec: string | undefined) {
  const jobs = ctx.state.session.jobs;
  if (!jobs.length) return null;
  if (!spec || spec === "%" || spec === "%+" || spec === "%%") return jobs[jobs.length - 1];
  if (spec === "%-") return jobs[jobs.length - 2] ?? null;
  const n = Number(spec.replace(/^%/, ""));
  return jobs.find((j) => j.id === n) ?? null;
}

function bashCommand(ctx: CommandContext): number {
  const sh = ctx.shell;
  const args = [...ctx.args];
  let checkOnly = false;
  while (args.length && /^-[nxveli]+$/.test(args[0]) && args[0] !== "-c") {
    if (args[0].includes("n")) checkOnly = true;
    args.shift();
  }
  if (args[0] === "-c") {
    const text = args[1];
    if (text === undefined) {
      ctx.err(`${ctx.name}: -c: option requires an argument
`);
      return 2;
    }
    const saved = sh.positional;
    sh.positional = args.slice(3);
    try {
      return sh.subshell(() => sh.evalText(text, sh.ioFromContext(ctx)));
    } finally {
      sh.positional = saved;
    }
  }
  if (args.length === 0) {
    if (!ctx.stdin.tty) {
      const text = ctx.readAllStdin();
      return sh.subshell(() => sh.evalText(text, sh.ioFromContext(ctx)));
    }
    // interactive sub-shell: `exit` returns to the parent shell
    ctx.state.session.userStack.push({ user: ctx.who.username, cwd: ctx.cwd, login: false });
    const lvl = Number(sh.getVar("SHLVL") ?? "1") + 1;
    sh.setVar("SHLVL", String(lvl));
    return 0;
  }
  const file = args[0];
  try {
    const node = ctx.fs.lookup(file, ctx.cwd, ctx.who);
    if (node.type === "dir") {
      ctx.err(`${ctx.name}: ${file}: Is a directory
`);
      return 126;
    }
    if (!sh.canRead(node)) {
      ctx.err(`${ctx.name}: ${file}: Permission denied
`);
      return 126;
    }
    if (checkOnly) {
      try {
        parseOnly(node.content);
        return 0;
      } catch (e) {
        ctx.err(`${file}: ${(e as Error).message}
`);
        return 2;
      }
    }
    return sh.runScript(sh.readFileContent(node), file, args.slice(1), sh.ioFromContext(ctx), false);
  } catch (e) {
    if (e instanceof FsError) {
      ctx.err(`${ctx.name}: ${file}: ${e.message}
`);
      return 127;
    }
    throw e;
  }
}

export const builtinCommands: CommandDef[] = [
  {
    name: "bash",
    aliases: ["sh", "dash", "rbash"],
    category: "scripting",
    description: "GNU Bourne-Again SHell: run scripts or commands.",
    syntax: "bash [-c COMMAND] [SCRIPT [ARGS...]]",
    options: [
      { flag: "-c CMD", description: "run the commands in the string CMD" },
      { flag: "-n", description: "check a script for syntax errors without running it" },
    ],
    examples: [
      { command: "bash hello.sh", description: "Run a script (only read permission needed)" },
      { command: 'bash -c "echo hi; whoami"', description: "Run commands in a child shell" },
    ],
    run: bashCommand,
  },
  {
    name: "cd",
    builtin: true,
    category: "basics",
    description: "Change the current working directory.",
    syntax: "cd [DIRECTORY]",
    options: [
      { flag: "cd", description: "go to your home directory" },
      { flag: "cd -", description: "go back to the previous directory" },
      { flag: "cd ..", description: "go up one level" },
    ],
    examples: [
      { command: "cd /var/log", description: "Go to an absolute path" },
      { command: "cd ..", description: "Move to the parent directory" },
      { command: "cd ~", description: "Return to your home directory" },
    ],
    permissions: "Requires execute (x) permission on the directory.",
    run: cdCommand,
  },
  {
    name: "pwd",
    builtin: true,
    category: "basics",
    description: "Print the name of the current working directory.",
    syntax: "pwd [-LP]",
    examples: [{ command: "pwd", description: "Show where you are" }],
    run: (ctx) => {
      ctx.out(ctx.cwd + "\n");
      return 0;
    },
  },
  {
    name: "echo",
    builtin: true,
    category: "basics",
    description: "Display a line of text.",
    syntax: "echo [-neE] [STRING]...",
    options: [
      { flag: "-n", description: "do not output the trailing newline" },
      { flag: "-e", description: "enable interpretation of backslash escapes" },
    ],
    examples: [
      { command: 'echo "Hello Linux"', description: "Print text" },
      { command: 'echo "Hello" > hello.txt', description: "Write text into a file" },
      { command: "echo $HOME", description: "Print a variable" },
    ],
    run: echoCommand,
  },
  {
    name: "printf",
    builtin: true,
    category: "scripting",
    description: "Format and print data.",
    syntax: "printf FORMAT [ARGUMENT]...",
    examples: [{ command: 'printf "%-10s %5d\\n" apples 3', description: "Formatted columns" }],
    run: (ctx) => {
      if (!ctx.args.length) {
        ctx.err(`${ctx.shell.errPrefix()}: printf: usage: printf [-v var] format [arguments]\n`);
        return 2;
      }
      let args = ctx.args;
      let varName: string | null = null;
      if (args[0] === "-v") {
        varName = args[1];
        args = args.slice(2);
      }
      let status = 0;
      const text = printfFormat(args[0], args.slice(1), (m) => {
        ctx.err(`${ctx.shell.errPrefix()}: printf: ${m}\n`);
        status = 1;
      });
      if (varName) ctx.shell.setVar(varName, text);
      else ctx.out(text);
      return status;
    },
  },
  {
    name: "export",
    builtin: true,
    category: "scripting",
    description: "Set export attribute for shell variables (make them environment variables).",
    syntax: "export [NAME[=VALUE]]...",
    examples: [{ command: "export EDITOR=nano", description: "Set and export a variable" }],
    run: (ctx) => {
      const sh = ctx.shell;
      const items = ctx.args.filter((a) => a !== "-n" && a !== "-p");
      if (!items.length) {
        const env = sh.environment();
        for (const k of Object.keys(env).sort()) ctx.out(`declare -x ${k}="${env[k]}"\n`);
        return 0;
      }
      let status = 0;
      for (const item of items) {
        const eq = item.indexOf("=");
        const name = eq === -1 ? item : item.slice(0, eq);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          ctx.err(`${sh.errPrefix()}: export: \`${item}': not a valid identifier\n`);
          status = 1;
          continue;
        }
        if (eq !== -1) sh.setVar(name, item.slice(eq + 1));
        sh.exportVar(name);
      }
      return status;
    },
  },
  {
    name: "unset",
    builtin: true,
    category: "scripting",
    description: "Unset values and attributes of shell variables and functions.",
    syntax: "unset [-fv] NAME...",
    run: (ctx) => {
      const fn = ctx.args.includes("-f");
      for (const n of ctx.args.filter((a) => !a.startsWith("-"))) {
        if (fn) delete ctx.state.session.functions[n];
        else {
          const am = /^([A-Za-z_][A-Za-z0-9_]*)\[(.+)\]$/.exec(n);
          if (am) {
            const arr = ctx.shell.getArray(am[1]);
            if (arr) delete arr[Number(am[2])];
          } else ctx.shell.unsetVar(n);
          if (!ctx.args.includes("-v")) delete ctx.state.session.functions[n];
        }
      }
      return 0;
    },
  },
  {
    name: "set",
    builtin: true,
    category: "scripting",
    description: "Set or unset shell options and positional parameters.",
    syntax: "set [--] [ARG]...",
    run: (ctx) => {
      if (!ctx.args.length) {
        const env = { ...ctx.state.session.vars, ...ctx.shell.environment() };
        for (const k of Object.keys(env).sort()) if (k !== "HOME_OVERRIDE") ctx.out(`${k}=${/\s/.test(env[k]) ? `'${env[k]}'` : env[k]}\n`);
        return 0;
      }
      const idx = ctx.args.indexOf("--");
      if (idx !== -1) ctx.shell.positional = ctx.args.slice(idx + 1);
      else if (!ctx.args[0].startsWith("-") && !ctx.args[0].startsWith("+")) ctx.shell.positional = [...ctx.args];
      return 0;
    },
  },
  {
    name: "alias",
    builtin: true,
    category: "basics",
    description: "Define or display aliases.",
    syntax: "alias [NAME[=VALUE] ...]",
    examples: [{ command: "alias ll='ls -alF'", description: "Create a shortcut" }],
    run: (ctx) => {
      const aliases = ctx.state.session.aliases;
      const items = ctx.args.filter((a) => a !== "-p");
      if (!items.length) {
        for (const k of Object.keys(aliases).sort()) ctx.out(`alias ${k}='${aliases[k]}'\n`);
        return 0;
      }
      let status = 0;
      for (const item of items) {
        const eq = item.indexOf("=");
        if (eq === -1) {
          if (aliases[item] !== undefined) ctx.out(`alias ${item}='${aliases[item]}'\n`);
          else {
            ctx.err(`${ctx.shell.errPrefix()}: alias: ${item}: not found\n`);
            status = 1;
          }
        } else aliases[item.slice(0, eq)] = item.slice(eq + 1);
      }
      return status;
    },
  },
  {
    name: "unalias",
    builtin: true,
    category: "basics",
    description: "Remove alias definitions.",
    syntax: "unalias [-a] NAME...",
    run: (ctx) => {
      if (ctx.args.includes("-a")) {
        ctx.state.session.aliases = {};
        return 0;
      }
      let status = 0;
      for (const n of ctx.args) {
        if (ctx.state.session.aliases[n] === undefined) {
          ctx.err(`${ctx.shell.errPrefix()}: unalias: ${n}: not found\n`);
          status = 1;
        } else delete ctx.state.session.aliases[n];
      }
      return status;
    },
  },
  {
    name: "read",
    builtin: true,
    category: "scripting",
    description: "Read a line from standard input and split it into variables.",
    syntax: "read [-rs] [-p PROMPT] [-a ARRAY] [NAME...]",
    examples: [{ command: 'read -p "Your name: " name', description: "Ask the user for input" }],
    run: readCommand,
  },
  {
    name: "exit",
    builtin: true,
    category: "basics",
    description: "Exit the shell (or the current su / sudo -i session).",
    syntax: "exit [N]",
    run: (ctx) => {
      const code = ctx.args[0] !== undefined ? Number(ctx.args[0]) & 255 : ctx.state.session.lastExit;
      if (ctx.shell.inScript) ctx.shell.doExit(code);
      return ctx.shell.registry.get("logout")!.run({ ...ctx, args: [String(code)], name: "exit" });
    },
  },
  {
    name: "logout",
    builtin: true,
    category: "basics",
    description: "Exit a login shell.",
    syntax: "logout",
    run: (ctx) => {
      const stack = ctx.state.session.userStack;
      const code = ctx.args[0] !== undefined ? Number(ctx.args[0]) : 0;
      const top = stack[stack.length - 1];
      if (ctx.name === "logout" && !top.login) {
        ctx.err(`${ctx.shell.errPrefix()}: logout: not login shell: use \`exit'\n`);
        return 1;
      }
      ctx.out(top.login ? "logout\n" : "exit\n");
      if (stack.length > 1) {
        const left = stack.pop()!;
        ctx.shell.log("auth", "su[2211]", `pam_unix(su:session): session closed for user ${left.user}`);
        // processes of the closed shell
        const idx = ctx.state.processes.findIndex((p) => p.command === "bash" && p.user === left.user && p.tty === "pts/0");
        if (idx !== -1 && left.user !== stack[0].user) ctx.state.processes.splice(idx, 1);
        return code;
      }
      ctx.out("\x1b[33m(Linux Playground keeps your session open — the terminal has been restarted.)\x1b[0m\n");
      const home = ctx.shell.homeOf(stack[0].user);
      stack[0].cwd = home;
      ctx.shell.actions.push({ type: "reset-terminal" });
      return code;
    },
  },
  {
    name: "return",
    builtin: true,
    category: "scripting",
    description: "Return from a shell function.",
    syntax: "return [N]",
    run: (ctx) => {
      const code = ctx.args[0] !== undefined ? Number(ctx.args[0]) & 255 : ctx.state.session.lastExit;
      if (!ctx.shell.inFunction && !ctx.shell.inScript) {
        ctx.err(`${ctx.shell.errPrefix()}: return: can only \`return' from a function or sourced script\n`);
        return 2;
      }
      return ctx.shell.doReturn(code);
    },
  },
  {
    name: "break",
    builtin: true,
    category: "scripting",
    description: "Exit for, while, or until loops.",
    syntax: "break [N]",
    run: (ctx) => ctx.shell.doBreak(Math.max(1, Number(ctx.args[0] ?? 1))),
  },
  {
    name: "continue",
    builtin: true,
    category: "scripting",
    description: "Resume the next iteration of a loop.",
    syntax: "continue [N]",
    run: (ctx) => ctx.shell.doContinue(Math.max(1, Number(ctx.args[0] ?? 1))),
  },
  {
    name: "shift",
    builtin: true,
    category: "scripting",
    description: "Shift positional parameters.",
    syntax: "shift [N]",
    run: (ctx) => {
      const n = Number(ctx.args[0] ?? 1);
      if (n > ctx.shell.positional.length) return 1;
      ctx.shell.positional = ctx.shell.positional.slice(n);
      return 0;
    },
  },
  {
    name: "source",
    aliases: ["."],
    builtin: true,
    category: "scripting",
    description: "Execute commands from a file in the current shell.",
    syntax: "source FILENAME [ARGUMENTS]",
    examples: [{ command: "source ~/.bashrc", description: "Reload your shell configuration" }],
    run: (ctx) => {
      const file = ctx.args[0];
      if (!file) {
        ctx.err(`${ctx.shell.errPrefix()}: ${ctx.name}: filename argument required\n${ctx.name}: usage: ${ctx.name} filename [arguments]\n`);
        return 2;
      }
      try {
        const node = ctx.fs.lookup(file, ctx.cwd, ctx.who);
        if (node.type === "dir") throw new FsError("EISDIR");
        if (!ctx.shell.canRead(node)) throw new FsError("EACCES");
        return ctx.shell.runScript(node.content, file, ctx.args.slice(1), ctx.shell.ioFromContext(ctx), true);
      } catch (e) {
        if (e instanceof FsError) {
          ctx.err(`${ctx.shell.errPrefix()}: ${file}: ${e.message}\n`);
          return 1;
        }
        throw e;
      }
    },
  },
  {
    name: "eval",
    builtin: true,
    category: "scripting",
    description: "Execute arguments as a shell command.",
    syntax: "eval [ARG]...",
    run: (ctx) => ctx.shell.evalText(ctx.args.join(" "), ctx.shell.ioFromContext(ctx)),
  },
  {
    name: "local",
    builtin: true,
    category: "scripting",
    description: "Define local variables inside a function.",
    syntax: "local NAME[=VALUE]...",
    run: (ctx) => declareCommand(ctx, true),
  },
  {
    name: "declare",
    aliases: ["typeset"],
    builtin: true,
    category: "scripting",
    description: "Declare variables and give them attributes.",
    syntax: "declare [-aixp] [NAME[=VALUE]]...",
    run: (ctx) => declareCommand(ctx, false),
  },
  {
    name: "readonly",
    builtin: true,
    category: "scripting",
    description: "Mark shell variables as unchangeable.",
    syntax: "readonly NAME[=VALUE]...",
    run: (ctx) => declareCommand(ctx, false),
  },
  {
    name: "let",
    builtin: true,
    category: "scripting",
    description: "Evaluate arithmetic expressions.",
    syntax: "let ARG [ARG...]",
    examples: [{ command: "let count=count+1", description: "Increment a counter" }],
    run: (ctx) => {
      let last = 0;
      for (const a of ctx.args) {
        try {
          last = ctx.shell.arith(a);
        } catch (e) {
          if (e instanceof ArithError) {
            ctx.err(`${ctx.shell.errPrefix()}: let: ${a}: ${e.message}\n`);
            return 1;
          }
          throw e;
        }
      }
      return last !== 0 ? 0 : 1;
    },
  },
  {
    name: "test",
    builtin: true,
    category: "scripting",
    description: "Evaluate a conditional expression.",
    syntax: "test EXPRESSION",
    examples: [{ command: "test -f /etc/passwd && echo exists", description: "Check that a file exists" }],
    run: (ctx) => testCommand(ctx, false),
  },
  {
    name: "[",
    builtin: true,
    category: "scripting",
    description: "Evaluate a conditional expression (same as test).",
    syntax: "[ EXPRESSION ]",
    examples: [{ command: '[ -d /tmp ] && echo "tmp exists"', description: "Check for a directory" }],
    run: (ctx) => testCommand(ctx, true),
  },
  { name: "true", builtin: true, category: "scripting", description: "Do nothing, successfully.", syntax: "true", run: () => 0 },
  { name: "false", builtin: true, category: "scripting", description: "Do nothing, unsuccessfully.", syntax: "false", run: () => 1 },
  { name: ":", builtin: true, hidden: true, category: "scripting", description: "Null command.", syntax: ":", run: () => 0 },
  {
    name: "type",
    builtin: true,
    category: "basics",
    description: "Display information about command type.",
    syntax: "type NAME...",
    examples: [{ command: "type ls cd", description: "Is it an alias, builtin or file?" }],
    run: (ctx) => {
      let status = 0;
      const sh = ctx.shell;
      for (const n of ctx.args.filter((a) => !a.startsWith("-"))) {
        if (ctx.state.session.aliases[n] !== undefined) ctx.out(`${n} is aliased to \`${ctx.state.session.aliases[n]}'\n`);
        else if (keywords.has(n)) ctx.out(`${n} is a shell keyword\n`);
        else if (ctx.state.session.functions[n]) ctx.out(`${n} is a function\n`);
        else if (sh.registry.get(n)?.builtin) ctx.out(`${n} is a shell builtin\n`);
        else {
          const found = sh.searchPath(n);
          if (found) ctx.out(`${n} is ${found.path}\n`);
          else {
            ctx.err(`${sh.errPrefix()}: type: ${n}: not found\n`);
            status = 1;
          }
        }
      }
      return status;
    },
  },
  {
    name: "command",
    builtin: true,
    category: "scripting",
    description: "Run a command bypassing functions, or describe it with -v.",
    syntax: "command [-v] COMMAND [ARG...]",
    run: (ctx) => {
      if (ctx.args[0] === "-v" || ctx.args[0] === "-V") {
        const n = ctx.args[1];
        if (!n) return 1;
        if (ctx.shell.registry.get(n)?.builtin) {
          ctx.out(n + "\n");
          return 0;
        }
        const found = ctx.shell.searchPath(n);
        if (found) {
          ctx.out(found.path + "\n");
          return 0;
        }
        return 1;
      }
      if (!ctx.args.length) return 0;
      return ctx.shell.runArgv(ctx.args, ctx.shell.ioFromContext(ctx));
    },
  },
  {
    name: "history",
    builtin: true,
    category: "basics",
    description: "Display or manipulate the command history list.",
    syntax: "history [-c] [N]",
    options: [
      { flag: "-c", description: "clear the history list" },
      { flag: "N", description: "show only the last N entries" },
    ],
    examples: [
      { command: "history", description: "Show your command history" },
      { command: "!!", description: "Re-run the last command" },
      { command: "!5", description: "Re-run command number 5" },
    ],
    run: (ctx) => {
      const h = ctx.state.session.history;
      if (ctx.args[0] === "-c") {
        h.length = 0;
        return 0;
      }
      const n = ctx.args[0] ? Number(ctx.args[0]) : h.length;
      if (Number.isNaN(n)) {
        ctx.err(`${ctx.shell.errPrefix()}: history: ${ctx.args[0]}: numeric argument required\n`);
        return 1;
      }
      const start = Math.max(0, h.length - n);
      for (let i = start; i < h.length; i++) ctx.out(`${String(i + 1).padStart(5)}  ${h[i]}\n`);
      return 0;
    },
  },
  {
    name: "jobs",
    builtin: true,
    category: "processes",
    description: "Display status of jobs started in the background.",
    syntax: "jobs [-l]",
    examples: [
      { command: "sleep 60 &", description: "Start a background job" },
      { command: "jobs", description: "List background jobs" },
    ],
    run: (ctx) => {
      const jobs = ctx.state.session.jobs;
      jobs.forEach((j, idx) => {
        const marker = idx === jobs.length - 1 ? "+" : idx === jobs.length - 2 ? "-" : " ";
        const pid = ctx.args.includes("-l") ? ` ${j.pid}` : "";
        const stateText = j.state === "Stopped" ? "Stopped" : "Running";
        ctx.out(`[${j.id}]${marker}${pid}  ${stateText.padEnd(24)}${j.command}${j.state === "Running" ? " &" : ""}\n`);
      });
      return 0;
    },
  },
  {
    name: "fg",
    builtin: true,
    category: "processes",
    description: "Move a job to the foreground (the simulator lets it run to completion).",
    syntax: "fg [%JOB]",
    run: (ctx) => {
      const job = jobSpec(ctx, ctx.args[0]);
      if (!job) {
        ctx.err(`${ctx.shell.errPrefix()}: fg: ${ctx.args[0] ?? "current"}: no such job\n`);
        return 1;
      }
      ctx.out(job.command + "\n");
      ctx.state.processes = ctx.state.processes.filter((p) => p.pid !== job.pid);
      ctx.state.session.jobs = ctx.state.session.jobs.filter((j) => j !== job);
      return 0;
    },
  },
  {
    name: "bg",
    builtin: true,
    category: "processes",
    description: "Resume a stopped job in the background.",
    syntax: "bg [%JOB]",
    run: (ctx) => {
      const job = jobSpec(ctx, ctx.args[0]);
      if (!job) {
        ctx.err(`${ctx.shell.errPrefix()}: bg: ${ctx.args[0] ?? "current"}: no such job\n`);
        return 1;
      }
      if (job.state === "Running") {
        ctx.err(`${ctx.shell.errPrefix()}: bg: job ${job.id} already in background\n`);
        return 0;
      }
      job.state = "Running";
      const p = ctx.state.processes.find((x) => x.pid === job.pid);
      if (p) p.state = "S";
      ctx.out(`[${job.id}]+ ${job.command} &\n`);
      return 0;
    },
  },
  {
    name: "wait",
    builtin: true,
    category: "processes",
    description: "Wait for background jobs to finish.",
    syntax: "wait [PID]",
    run: (ctx) => {
      const pids = new Set(ctx.state.session.jobs.map((j) => j.pid));
      ctx.state.processes = ctx.state.processes.filter((p) => !pids.has(p.pid) || p.state === "T");
      ctx.state.session.jobs = ctx.state.session.jobs.filter((j) => j.state === "Stopped");
      return 0;
    },
  },
  {
    name: "umask",
    builtin: true,
    category: "permissions",
    description: "Display or set the file mode creation mask.",
    syntax: "umask [-S] [MODE]",
    examples: [
      { command: "umask", description: "Show the current mask (e.g. 0002)" },
      { command: "umask 027", description: "New files will not be readable by others" },
    ],
    run: (ctx) => {
      const s = ctx.state.session;
      const arg = ctx.args.find((a) => a !== "-S");
      if (!arg) {
        if (ctx.args.includes("-S")) {
          const p = (shift: number) => {
            const v = ~(s.umask >> shift) & 7;
            return (v & 4 ? "r" : "") + (v & 2 ? "w" : "") + (v & 1 ? "x" : "");
          };
          ctx.out(`u=${p(6)},g=${p(3)},o=${p(0)}\n`);
        } else ctx.out(s.umask.toString(8).padStart(4, "0") + "\n");
        return 0;
      }
      if (!/^[0-7]{1,4}$/.test(arg)) {
        ctx.err(`${ctx.shell.errPrefix()}: umask: ${arg}: octal number out of range\n`);
        return 1;
      }
      s.umask = parseInt(arg, 8) & 0o777;
      return 0;
    },
  },
  {
    name: "hash",
    builtin: true,
    hidden: true,
    category: "basics",
    description: "Remember or display program locations.",
    syntax: "hash [-r]",
    run: (ctx) => {
      if (!ctx.args.length) ctx.out("hash: hash table empty\n");
      return 0;
    },
  },
  {
    name: "help",
    builtin: true,
    category: "basics",
    description: "Display information about builtin commands and the playground.",
    syntax: "help [COMMAND]",
    run: (ctx) => {
      const name = ctx.args[0];
      if (name) {
        const def = ctx.shell.registry.get(name);
        if (!def) {
          ctx.err(`${ctx.shell.errPrefix()}: help: no help topics match \`${name}'.  Try \`man ${name}' or \`info ${name}'.\n`);
          return 1;
        }
        ctx.out(`${def.name}: ${def.syntax}\n    ${def.description}\n`);
        if (def.options?.length) {
          ctx.out("\n    Options:\n");
          for (const o of def.options) ctx.out(`      ${o.flag.padEnd(14)}${o.description}\n`);
        }
        return 0;
      }
      const y = (s: string) => `\x1b[1;33m${s}\x1b[0m`;
      ctx.out(
        [
          y("Linux Playground — a safe, simulated Ubuntu terminal"),
          "",
          "Try these commands to get started:",
          "  pwd, ls -la, cd, mkdir, touch, cat, echo, cp, mv, rm",
          "  chmod, chown, sudo, useradd, groupadd, id, groups",
          "  ps aux, top, kill, ip addr, ping, apt, df -h, free -h",
          "",
          "Useful tips:",
          "  man <command>     read the manual for a command",
          "  <command> --help  quick help for most commands",
          "  Tab               auto-complete commands and paths",
          "  Up / Down         browse your command history",
          "  Ctrl+L / clear    clear the screen",
          "  Ctrl+C            cancel the current line",
          "",
          "The default password for 'student' is: student",
          "",
        ].join("\n"),
      );
      return 0;
    },
  },
];

// exported for tests
export { evalArith };
