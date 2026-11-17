"use client";

import { Package, Search, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Cmd {
  name: string;
  category: string;
  description: string;
  syntax: string;
  options: { flag: string; description: string }[];
  examples: { command: string; description: string }[];
  permissions: string | null;
  package: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  basics: "Basics",
  files: "Files",
  text: "Text processing",
  permissions: "Permissions",
  users: "Users & groups",
  processes: "Processes",
  networking: "Networking",
  packages: "Packages",
  storage: "Storage",
  scripting: "Scripting",
  security: "Security",
  system: "System",
};

export function CommandBrowser({ commands }: { commands: Cmd[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("ls");
  const cats = useMemo(() => [...new Set(commands.map((c) => c.category))], [commands]);
  const filtered = commands.filter((c) => (!cat || c.category === cat) && (!q || c.name.includes(q.toLowerCase()) || c.description.toLowerCase().includes(q.toLowerCase())));
  const current = commands.find((c) => c.name === selected) ?? filtered[0];
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search commands…" className="h-9 pl-8" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setCat(null)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", !cat && "border-primary bg-primary/10 text-primary")}>
            All
          </button>
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", cat === c && "border-primary bg-primary/10 text-primary")}>
              {CATEGORY_LABEL[c] ?? c}
            </button>
          ))}
        </div>
        <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto rounded-xl border bg-card p-1.5">
          {filtered.map((c) => (
            <li key={c.name}>
              <button onClick={() => setSelected(c.name)} className={cn("w-full rounded-md px-2.5 py-1.5 text-left", current?.name === c.name ? "bg-accent" : "hover:bg-accent/50")}>
                <span className="font-mono text-sm font-medium">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{c.description}</span>
              </button>
            </li>
          ))}
          {!filtered.length && <li className="p-4 text-center text-sm text-muted-foreground">No commands match.</li>}
        </ul>
      </div>
      {current && (
        <article className="h-fit rounded-xl border bg-card p-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{CATEGORY_LABEL[current.category] ?? current.category}</p>
          <h2 className="font-mono text-2xl font-semibold">{current.name}</h2>
          <p className="mt-1 text-muted-foreground">{current.description}</p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-[var(--terminal-bg)] p-3 font-mono text-sm text-[#7ee787]">{current.syntax}</pre>
          {current.package && (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Package className="size-4" /> Not installed by default: <code className="font-mono">sudo apt install {current.package}</code>
            </p>
          )}
          {current.permissions && (
            <p className="mt-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm">
              <ShieldAlert className="size-4 shrink-0 text-warning" /> {current.permissions}
            </p>
          )}
          {current.options.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 font-semibold">Options</h3>
              <table className="w-full text-sm">
                <tbody>
                  {current.options.map((o) => (
                    <tr key={o.flag} className="border-t">
                      <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-primary">{o.flag}</td>
                      <td className="py-2 text-muted-foreground">{o.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {current.examples.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 font-semibold">Examples</h3>
              <div className="space-y-2">
                {current.examples.map((e) => (
                  <div key={e.command} className="rounded-lg border p-3">
                    <code className="font-mono text-sm">$ {e.command}</code>
                    <p className="mt-0.5 text-xs text-muted-foreground">{e.description}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </article>
      )}
    </div>
  );
}
