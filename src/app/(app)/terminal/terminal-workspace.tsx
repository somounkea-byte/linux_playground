"use client";

import { Keyboard, Lightbulb } from "lucide-react";
import { useRef } from "react";
import { CommandChip } from "@/components/terminal/command-chips";
import { LinuxTerminal, type TerminalController } from "@/components/terminal/terminal";

const SUGGESTIONS: { title: string; commands: { command: string; explanation: string }[] }[] = [
  {
    title: "Explore",
    commands: [
      { command: "ls -la", explanation: "Everything in your home directory" },
      { command: "cat documents/welcome.txt", explanation: "Read the welcome note" },
      { command: "tree -L 2 ~ || sudo apt install -y tree", explanation: "Visualise the tree" },
    ],
  },
  {
    title: "Administer",
    commands: [
      { command: "sudo useradd -m -s /bin/bash john", explanation: "Create a user (password: student)" },
      { command: "id john", explanation: "Inspect the new account" },
      { command: "ps aux | head", explanation: "Running processes" },
      { command: "df -h", explanation: "Disk usage" },
    ],
  },
  {
    title: "Network & services",
    commands: [
      { command: "ip -br a", explanation: "IP addresses" },
      { command: "sudo apt install -y nginx", explanation: "Install a web server" },
      { command: "curl -s localhost | head -5", explanation: "Talk to it" },
    ],
  },
];

const SHORTCUTS: [string, string][] = [
  ["Tab", "Complete commands & paths"],
  ["↑ / ↓", "Command history"],
  ["Ctrl+C", "Cancel the line"],
  ["Ctrl+L", "Clear the screen"],
  ["Ctrl+A / E", "Start / end of line"],
  ["Ctrl+U / K", "Delete before / after cursor"],
  ["Ctrl+W", "Delete previous word"],
  ["Ctrl+Shift+C / V", "Copy / paste"],
];

export function TerminalWorkspace() {
  const ctrl = useRef<TerminalController | null>(null);
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
      <LinuxTerminal controllerRef={ctrl} height="calc(100vh - 15rem)" className="min-h-[420px]" />
      <aside className="space-y-5">
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Lightbulb className="size-4 text-primary" /> Try these
          </h2>
          <div className="space-y-4">
            {SUGGESTIONS.map((g) => (
              <div key={g.title}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</p>
                <div className="space-y-1.5">
                  {g.commands.map((c) => (
                    <CommandChip key={c.command} {...c} onRun={(cmd) => ctrl.current?.run(cmd)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Keyboard className="size-4 text-primary" /> Keyboard shortcuts
          </h2>
          <dl className="space-y-1.5 text-xs">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.7rem]">{k}</kbd>
                </dt>
                <dd className="text-right text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </aside>
    </div>
  );
}
