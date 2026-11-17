"use client";

import "@xterm/xterm/css/xterm.css";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import { Copy, Eraser, Loader2, Minus, Plus, RotateCcw, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { EditorDialog, type EditRequest } from "./editor-dialog";

export type EnvTarget = { kind: "playground" } | { kind: "challenge"; slug: string };

interface PromptInfo {
  user: string;
  host: string;
  cwd: string;
  display: string;
  isRoot: boolean;
}

interface ExecResponse {
  output: string;
  exitCode: number;
  prompt: PromptInfo;
  needsInput: { prompt: string; secret: boolean } | null;
  incomplete: boolean;
  actions: ({ type: "clear" } | { type: "reset-terminal" } | { type: "edit"; path: string; editor: string; readOnly: boolean; user: string })[];
  now: number;
  mutated: boolean;
}

interface CompletionResponse {
  start: number;
  matches: string[];
  display: string[];
  common: string;
}

export interface TerminalController {
  run(command: string): void;
  insert(text: string): void;
  focus(): void;
}

const THEME = {
  background: "#0a0d12",
  foreground: "#d7dde6",
  cursor: "#7ee787",
  cursorAccent: "#0a0d12",
  selectionBackground: "#2f4a6b",
  black: "#1c2128",
  red: "#ff7b72",
  green: "#7ee787",
  yellow: "#e3b341",
  blue: "#79c0ff",
  magenta: "#d2a8ff",
  cyan: "#56d4dd",
  white: "#d7dde6",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#aff5b4",
  brightYellow: "#f2cc60",
  brightBlue: "#a5d6ff",
  brightMagenta: "#e2c5ff",
  brightCyan: "#7ee5ea",
  brightWhite: "#ffffff",
};

const FONT_KEY = "lp-terminal-font-size";

function visibleLength(s: string) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").length;
}

function promptString(p: PromptInfo) {
  return `\x1b[01;32m${p.user}@${p.host}\x1b[0m:\x1b[01;34m${p.display}\x1b[0m${p.isRoot ? "#" : "$"} `;
}

function welcomeBanner() {
  const now = new Date();
  return [
    "Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)",
    "",
    " * Documentation:  https://help.ubuntu.com",
    " * This is \x1b[1mLinux Playground\x1b[0m: a safe, simulated Ubuntu machine.",
    "   Type \x1b[1;33mhelp\x1b[0m for tips. Your password is \x1b[1mstudent\x1b[0m.",
    "",
    `Last login: ${now.toUTCString().replace(" GMT", "")} from 10.0.2.2`,
    "",
  ].join("\r\n");
}

export function LinuxTerminal({
  target = { kind: "playground" },
  className,
  height = 480,
  controllerRef,
  onCommand,
  showToolbar = true,
  banner = true,
  title,
}: {
  target?: EnvTarget;
  className?: string;
  height?: number | string;
  controllerRef?: React.RefObject<TerminalController | null>;
  onCommand?: (res: ExecResponse, line: string) => void;
  showToolbar?: boolean;
  banner?: boolean;
  title?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [edit, setEdit] = useState<EditRequest | null>(null);
  const [promptLabel, setPromptLabel] = useState<string>("");
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const targetKey = JSON.stringify(target);

  // mutable line-editor state (kept in a ref: xterm callbacks are not React-aware)
  const st = useRef({
    prompt: null as PromptInfo | null,
    buffer: "",
    cursor: 0,
    history: [] as string[],
    histIndex: -1,
    draft: "",
    mode: "idle" as "idle" | "running" | "input",
    secret: false,
    pending: null as null | { line: string; inputs: string[]; now?: number; shown: string },
    continuation: [] as string[],
    queue: [] as string[],
    cursorRow: 0,
    lastTab: 0,
    completing: false,
  });

  const target_ = useRef(target);
  target_.current = target;
  const submitRef = useRef<() => void>(() => {});

  // ------------------------------------------------------------- rendering
  const currentPrompt = useCallback(() => {
    const s = st.current;
    if (s.mode === "input") return "";
    if (s.continuation.length) return "> ";
    return s.prompt ? promptString(s.prompt) : "$ ";
  }, []);

  const redraw = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    const s = st.current;
    const cols = term.cols;
    const prompt = currentPrompt();
    const shown = s.mode === "input" && s.secret ? "" : s.buffer;
    const plen = s.mode === "input" ? (s.pending ? visibleLength(s.pending.shown.split("\n").pop() ?? "") : 0) : visibleLength(prompt);
    let out = "";
    if (s.cursorRow > 0) out += `\x1b[${s.cursorRow}A`;
    out += "\r";
    if (s.mode === "input") {
      // the prompt text was printed by the program; only redraw after it
      if (plen > 0) out += `\x1b[${plen}C`;
      out += "\x1b[J" + shown;
    } else out += "\x1b[J" + prompt + shown;
    const total = plen + shown.length;
    const cursorPos = plen + (s.mode === "input" && s.secret ? 0 : s.cursor);
    let endRow = Math.floor(total / cols);
    if (total > 0 && total % cols === 0) endRow -= 1;
    const targetRow = Math.floor(cursorPos / cols);
    const targetCol = cursorPos % cols;
    const up = endRow - targetRow;
    if (up > 0) out += `\x1b[${up}A`;
    out += "\r";
    if (targetCol > 0) out += `\x1b[${targetCol}C`;
    s.cursorRow = targetRow;
    term.write(out);
  }, [currentPrompt]);

  const newPrompt = useCallback(() => {
    const s = st.current;
    s.buffer = "";
    s.cursor = 0;
    s.cursorRow = 0;
    s.histIndex = -1;
    termRef.current?.write(currentPrompt());
  }, [currentPrompt]);

  const writeOutput = useCallback((text: string) => {
    if (text) termRef.current?.write(text.replace(/\r?\n/g, "\r\n"));
  }, []);

  // ------------------------------------------------------------- execution
  const finishLine = useCallback(() => {
    const s = st.current;
    s.mode = "idle";
    s.pending = null;
    setBusy(false);
    newPrompt();
    const next = s.queue.shift();
    if (next !== undefined) {
      setTimeout(() => {
        s.buffer = next;
        s.cursor = next.length;
        termRef.current?.write(next);
        submitRef.current();
      }, 0);
    }
  }, [newPrompt]);

  const runPending = useCallback(async () => {
    const s = st.current;
    const p = s.pending;
    if (!p) return;
    s.mode = "running";
    setBusy(true);
    try {
      const res = await api<ExecResponse>("/api/terminal/execute", { body: { target: target_.current, line: p.line, inputs: p.inputs, now: p.now } });
      p.now = res.now;
      const fresh = res.output.startsWith(p.shown) ? res.output.slice(p.shown.length) : (p.shown ? "\n" : "") + res.output;
      writeOutput(fresh);
      p.shown = res.output;
      if (res.needsInput) {
        s.mode = "input";
        s.secret = res.needsInput.secret;
        s.buffer = "";
        s.cursor = 0;
        s.cursorRow = 0;
        setBusy(false);
        return;
      }
      if (res.incomplete) {
        s.continuation.push(p.line.split("\n").pop() ?? "");
        s.mode = "idle";
        s.pending = null;
        setBusy(false);
        newPrompt();
        return;
      }
      s.prompt = res.prompt;
      setPromptLabel(`${res.prompt.user}@${res.prompt.host}: ${res.prompt.display}`);
      for (const a of res.actions) {
        if (a.type === "clear") termRef.current?.clear();
        if (a.type === "reset-terminal") termRef.current?.write("\x1b[2J\x1b[H");
        if (a.type === "edit") setEdit({ path: a.path, editor: a.editor, readOnly: a.readOnly, user: a.user });
      }
      if (res.actions.some((a) => a.type === "clear")) termRef.current?.write("\x1b[2J\x1b[H");
      onCommandRef.current?.(res, p.line);
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : "Connection problem - the command could not be run.";
      writeOutput(`\x1b[31m${msg}\x1b[0m\n`);
    }
    finishLine();
  }, [finishLine, newPrompt, writeOutput]);

  const submit = useCallback(() => {
    const s = st.current;
    const term = termRef.current;
    if (!term || s.mode === "running") return;
    if (s.mode === "input" && s.pending) {
      const value = s.buffer;
      term.write("\r\n");
      s.pending.inputs.push(value);
      // what the program printed so far + the echoed answer
      s.pending.shown += (s.secret ? "" : value) + "\n";
      s.buffer = "";
      s.cursor = 0;
      void runPending();
      return;
    }
    const lineText = s.buffer;
    term.write("\r\n");
    s.cursorRow = 0;
    const full = s.continuation.length ? [...s.continuation, lineText].join("\n") : lineText;
    if (!full.trim() && !s.continuation.length) {
      newPrompt();
      const next = s.queue.shift();
      if (next !== undefined) {
        s.buffer = next;
        s.cursor = next.length;
        term.write(next);
        submit();
      }
      return;
    }
    if (s.continuation.length) s.continuation = [];
    if (full.trim() && !full.startsWith(" ") && s.history[s.history.length - 1] !== full) s.history.push(full);
    s.pending = { line: full, inputs: [], shown: "" };
    void runPending();
  }, [newPrompt, runPending]);
  submitRef.current = submit;

  const complete = useCallback(async () => {
    const s = st.current;
    if (s.mode !== "idle" || s.completing) return;
    s.completing = true;
    const line = s.buffer;
    const cursor = s.cursor;
    try {
      const res = await api<CompletionResponse>("/api/terminal/complete", { body: { target: target_.current, line, cursor } });
      if (s.buffer !== line || s.cursor !== cursor) return; // user kept typing
      const word = line.slice(res.start, cursor);
      if (res.matches.length === 1) {
        const m = res.matches[0];
        const suffix = m.endsWith("/") ? "" : " ";
        s.buffer = line.slice(0, res.start) + m + suffix + line.slice(cursor);
        s.cursor = res.start + m.length + suffix.length;
        redraw();
      } else if (res.matches.length > 1) {
        if (res.common.length > word.length) {
          s.buffer = line.slice(0, res.start) + res.common + line.slice(cursor);
          s.cursor = res.start + res.common.length;
          redraw();
        } else if (Date.now() - s.lastTab < 1500) {
          const term = termRef.current!;
          const width = Math.max(...res.display.map((d) => d.length)) + 2;
          const perRow = Math.max(1, Math.floor(term.cols / width));
          let out = "\r\n";
          res.display.slice(0, 200).forEach((d, i) => {
            out += d.padEnd(width);
            if ((i + 1) % perRow === 0) out += "\r\n";
          });
          if (res.display.length % perRow !== 0) out += "\r\n";
          term.write(out);
          s.cursorRow = 0;
          term.write(currentPrompt());
          redraw();
        } else termRef.current?.write("\x07");
      } else termRef.current?.write("\x07");
      s.lastTab = Date.now();
    } catch {
      // completion is best-effort
    } finally {
      s.completing = false;
    }
  }, [currentPrompt, redraw]);

  const insertText = useCallback(
    (text: string) => {
      const s = st.current;
      if (s.mode === "running") {
        // type-ahead while a command runs: queue whole lines
        const lines = text.split(/\r\n|\r|\n/);
        if (lines.length > 1) s.queue.push(...lines.filter((l, i) => l.length || i < lines.length - 1));
        return;
      }
      const parts = text.split(/\r\n|\r|\n/);
      const first = parts.shift() ?? "";
      s.buffer = s.buffer.slice(0, s.cursor) + first + s.buffer.slice(s.cursor);
      s.cursor += first.length;
      if (parts.length) {
        const rest = parts;
        if (rest[rest.length - 1] === "") rest.pop();
        s.queue.push(...rest);
        redraw();
        submit();
        return;
      }
      redraw();
    },
    [redraw, submit],
  );

  const handleData = useCallback(
    (data: string) => {
      const s = st.current;
      const term = termRef.current;
      if (!term) return;
      if (s.mode === "running") {
        if (data === "\x03") return;
        insertText(data);
        return;
      }
      switch (data) {
        case "\r":
          submit();
          return;
        case "\x7f":
        case "\b":
          if (s.cursor > 0) {
            s.buffer = s.buffer.slice(0, s.cursor - 1) + s.buffer.slice(s.cursor);
            s.cursor--;
            redraw();
          }
          return;
        case "\x1b[3~":
          if (s.cursor < s.buffer.length) {
            s.buffer = s.buffer.slice(0, s.cursor) + s.buffer.slice(s.cursor + 1);
            redraw();
          }
          return;
        case "\x1b[D":
          if (s.cursor > 0) {
            s.cursor--;
            redraw();
          }
          return;
        case "\x1b[C":
          if (s.cursor < s.buffer.length) {
            s.cursor++;
            redraw();
          }
          return;
        case "\x1b[1;5D":
        case "\x1bb": {
          let i = s.cursor;
          while (i > 0 && s.buffer[i - 1] === " ") i--;
          while (i > 0 && s.buffer[i - 1] !== " ") i--;
          s.cursor = i;
          redraw();
          return;
        }
        case "\x1b[1;5C":
        case "\x1bf": {
          let i = s.cursor;
          while (i < s.buffer.length && s.buffer[i] === " ") i++;
          while (i < s.buffer.length && s.buffer[i] !== " ") i++;
          s.cursor = i;
          redraw();
          return;
        }
        case "\x1b[H":
        case "\x1bOH":
        case "\x01":
          s.cursor = 0;
          redraw();
          return;
        case "\x1b[F":
        case "\x1bOF":
        case "\x05":
          s.cursor = s.buffer.length;
          redraw();
          return;
        case "\x1b[A":
          if (s.mode !== "idle" || !s.history.length) return;
          if (s.histIndex === -1) {
            s.draft = s.buffer;
            s.histIndex = s.history.length - 1;
          } else if (s.histIndex > 0) s.histIndex--;
          s.buffer = s.history[s.histIndex];
          s.cursor = s.buffer.length;
          redraw();
          return;
        case "\x1b[B":
          if (s.mode !== "idle" || s.histIndex === -1) return;
          if (s.histIndex < s.history.length - 1) {
            s.histIndex++;
            s.buffer = s.history[s.histIndex];
          } else {
            s.histIndex = -1;
            s.buffer = s.draft;
          }
          s.cursor = s.buffer.length;
          redraw();
          return;
        case "\x15": // Ctrl+U
          s.buffer = s.buffer.slice(s.cursor);
          s.cursor = 0;
          redraw();
          return;
        case "\x0b": // Ctrl+K
          s.buffer = s.buffer.slice(0, s.cursor);
          redraw();
          return;
        case "\x17": {
          // Ctrl+W
          let i = s.cursor;
          while (i > 0 && s.buffer[i - 1] === " ") i--;
          while (i > 0 && s.buffer[i - 1] !== " ") i--;
          s.buffer = s.buffer.slice(0, i) + s.buffer.slice(s.cursor);
          s.cursor = i;
          redraw();
          return;
        }
        case "\x0c": // Ctrl+L
          term.write("\x1b[2J\x1b[H");
          s.cursorRow = 0;
          term.write(currentPrompt());
          redraw();
          return;
        case "\x03": // Ctrl+C
          term.write("^C\r\n");
          s.continuation = [];
          s.queue = [];
          if (s.mode === "input") {
            s.mode = "idle";
            s.pending = null;
          }
          newPrompt();
          return;
        case "\x04": // Ctrl+D
          if (s.mode === "idle" && !s.buffer && !s.continuation.length) {
            s.buffer = "exit";
            term.write("exit");
            submit();
          }
          return;
        case "\t":
          void complete();
          return;
      }
      if (data.startsWith("\x1b")) return; // unhandled escape sequence
      // printable input (typed or pasted)
      // eslint-disable-next-line no-control-regex
      const clean = data.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
      if (clean) insertText(clean);
    },
    [complete, currentPrompt, insertText, newPrompt, redraw, submit],
  );

  // expose an imperative API for lessons ("Run this command")
  useEffect(() => {
    if (!controllerRef) return;
    controllerRef.current = {
      run: (command: string) => {
        const s = st.current;
        termRef.current?.focus();
        if (s.mode === "running" || s.mode === "input") {
          s.queue.push(command);
          return;
        }
        s.buffer = command;
        s.cursor = command.length;
        redraw();
        submit();
      },
      insert: (text: string) => {
        termRef.current?.focus();
        insertText(text);
      },
      focus: () => termRef.current?.focus(),
    };
  }, [controllerRef, insertText, redraw, submit]);

  // ------------------------------------------------------------- lifecycle
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    const saved = Number(typeof window !== "undefined" ? window.localStorage.getItem(FONT_KEY) : 0) || 14;
    setFontSize(saved);
    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit"), import("@xterm/addon-web-links")]);
      if (disposed || !containerRef.current) return;
      const monoVar = getComputedStyle(document.documentElement).getPropertyValue("--font-mono-family").trim();
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: `${monoVar ? monoVar + ", " : ""}'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace`,
        fontSize: saved,
        lineHeight: 1.25,
        theme: THEME,
        scrollback: 5000,
        allowProposedApi: false,
        convertEol: false,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(containerRef.current);
      termRef.current = term;
      fitRef.current = fit;
      try {
        fit.fit();
      } catch {
        /* container not visible yet */
      }
      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== "keydown") return true;
        const ctrlShift = ev.ctrlKey && ev.shiftKey;
        if ((ctrlShift && ev.code === "KeyC") || (ev.ctrlKey && ev.code === "KeyC" && term.hasSelection())) {
          const sel = term.getSelection();
          if (sel) void navigator.clipboard?.writeText(sel).then(() => toast.success("Copied to clipboard"));
          return false;
        }
        if (ctrlShift && ev.code === "KeyV") {
          void navigator.clipboard?.readText().then((t) => t && handleData(t));
          return false;
        }
        return true;
      });
      term.onData((d) => handleData(d));
      observer = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
      });
      observer.observe(containerRef.current);
      try {
        const q = target.kind === "challenge" ? `?challenge=${encodeURIComponent(target.slug)}` : "";
        const info = await api<{ prompt: PromptInfo; history: string[] }>(`/api/terminal/history${q}`);
        if (disposed) return;
        st.current.prompt = info.prompt;
        st.current.history = info.history;
        setPromptLabel(`${info.prompt.user}@${info.prompt.host}: ${info.prompt.display}`);
        if (banner) term.write(welcomeBanner() + "\r\n");
      } catch (e) {
        term.write(`\x1b[31m${e instanceof Error ? e.message : "Could not connect to your environment."}\x1b[0m\r\n`);
      }
      newPrompt();
      setReady(true);
      term.focus();
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
      st.current = { ...st.current, buffer: "", cursor: 0, mode: "idle", pending: null, continuation: [], queue: [], cursorRow: 0 };
    };
    // re-create the terminal only when the target environment changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  function changeFont(delta: number) {
    const size = Math.max(10, Math.min(24, fontSize + delta));
    setFontSize(size);
    try {
      window.localStorage.setItem(FONT_KEY, String(size));
    } catch {
      /* ignore */
    }
    if (termRef.current) {
      termRef.current.options.fontSize = size;
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
    }
  }

  async function reset() {
    setResetting(true);
    try {
      await api("/api/terminal/reset", { body: { target } });
      const term = termRef.current;
      term?.reset();
      const q = target.kind === "challenge" ? `?challenge=${encodeURIComponent(target.slug)}` : "";
      const info = await api<{ prompt: PromptInfo; history: string[] }>(`/api/terminal/history${q}`);
      st.current.prompt = info.prompt;
      st.current.history = info.history;
      st.current.mode = "idle";
      st.current.pending = null;
      st.current.continuation = [];
      if (term && banner) term.write(welcomeBanner() + "\r\n");
      newPrompt();
      toast.success("Your environment was reset to a fresh Ubuntu machine.");
      onCommandRef.current?.({ output: "", exitCode: 0, prompt: info.prompt, needsInput: null, incomplete: false, actions: [], now: Date.now(), mutated: true }, "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  }

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0d12] shadow-lg", className)}>
      {showToolbar && (
        <div className="flex items-center gap-2 border-b border-white/10 bg-[#11161d] px-3 py-1.5 text-[#c9d1d9]">
          <div className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="ml-2 flex min-w-0 items-center gap-1.5 truncate font-mono text-xs text-[#8b949e]">
            <TerminalSquare className="size-3.5 shrink-0" />
            <span className="truncate">{title ?? (promptLabel || "connecting…")}</span>
          </span>
          {busy && <Loader2 className="size-3.5 animate-spin text-[#8b949e]" aria-label="Running" />}
          <div className="ml-auto flex items-center gap-0.5">
            <ToolbarButton label="Smaller font" onClick={() => changeFont(-1)}>
              <Minus />
            </ToolbarButton>
            <span className="w-6 text-center font-mono text-[0.7rem] text-[#8b949e]">{fontSize}</span>
            <ToolbarButton label="Larger font" onClick={() => changeFont(1)}>
              <Plus />
            </ToolbarButton>
            <ToolbarButton
              label="Copy selection (Ctrl+Shift+C)"
              onClick={() => {
                const sel = termRef.current?.getSelection();
                if (sel) void navigator.clipboard?.writeText(sel).then(() => toast.success("Copied"));
                else toast.info("Select text in the terminal first");
              }}
            >
              <Copy />
            </ToolbarButton>
            <ToolbarButton
              label="Clear screen (Ctrl+L)"
              onClick={() => {
                termRef.current?.write("\x1b[2J\x1b[H");
                st.current.cursorRow = 0;
                termRef.current?.write(currentPrompt());
                redraw();
                termRef.current?.focus();
              }}
            >
              <Eraser />
            </ToolbarButton>
            <ToolbarButton label="Reset environment" onClick={() => setConfirmReset(true)}>
              <RotateCcw />
            </ToolbarButton>
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1 px-2 pt-2" style={{ height }} onClick={() => termRef.current?.focus()}>
        {!ready && (
          <div className="absolute inset-0 grid place-items-center text-sm text-[#8b949e]">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Booting your Ubuntu machine…
            </span>
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" data-testid="terminal" />
      </div>
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset environment?</DialogTitle>
            <DialogDescription>
              {target.kind === "challenge"
                ? "The challenge machine will be recreated from its starting state. Your progress on this challenge's tasks will need to be redone."
                : "All files, users, packages and settings you created in your playground will be deleted and replaced with a fresh Ubuntu machine. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={reset} disabled={resetting}>
              {resetting && <Loader2 className="animate-spin" />} Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <EditorDialog
        request={edit}
        target={target}
        onClose={(saved) => {
          setEdit(null);
          if (saved) onCommandRef.current?.({ output: "", exitCode: 0, prompt: st.current.prompt!, needsInput: null, incomplete: false, actions: [], now: Date.now(), mutated: true }, "");
          termRef.current?.focus();
        }}
      />
    </div>
  );
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="grid size-7 place-items-center rounded-md text-[#8b949e] transition-colors hover:bg-white/10 hover:text-white [&_svg]:size-3.5"
            aria-label={label}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
