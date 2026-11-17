"use client";

import { Calculator, Copy } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ROLES = [
  { key: "owner", label: "Owner", shift: 6, hint: "u – the file's owner" },
  { key: "group", label: "Group", shift: 3, hint: "g – members of the file's group" },
  { key: "others", label: "Others", shift: 0, hint: "o – everyone else" },
] as const;
const BITS = [
  { label: "Read", short: "r", value: 4 },
  { label: "Write", short: "w", value: 2 },
  { label: "Execute", short: "x", value: 1 },
] as const;
const SPECIAL = [
  { label: "setuid", value: 0o4000, hint: "run as the file owner" },
  { label: "setgid", value: 0o2000, hint: "run as group / inherit group in directories" },
  { label: "sticky", value: 0o1000, hint: "only owners may delete (like /tmp)" },
];

export function symbolic(mode: number, isDir = false) {
  let s = isDir ? "d" : "-";
  for (const r of ROLES) {
    const v = (mode >> r.shift) & 7;
    const special = r.key === "owner" ? mode & 0o4000 : r.key === "group" ? mode & 0o2000 : mode & 0o1000;
    s += v & 4 ? "r" : "-";
    s += v & 2 ? "w" : "-";
    const x = v & 1;
    s += special ? (r.key === "others" ? (x ? "t" : "T") : x ? "s" : "S") : x ? "x" : "-";
  }
  return s;
}

/** Interactive rwx ↔ octal ↔ chmod calculator. Controlled by `mode`. */
export function PermissionCalculator({ mode, onChange, fileName = "file.txt", isDir = false, compact = false }: { mode: number; onChange: (m: number) => void; fileName?: string; isDir?: boolean; compact?: boolean }) {
  const octal = (mode & 0o7777).toString(8).padStart(mode > 0o777 ? 4 : 3, "0");
  const symbolicStr = symbolic(mode, isDir);
  const command = `chmod ${octal} ${fileName}`;
  const breakdown = useMemo(
    () =>
      ROLES.map((r) => {
        const v = (mode >> r.shift) & 7;
        return { ...r, v, rwx: `${v & 4 ? "r" : "-"}${v & 2 ? "w" : "-"}${v & 1 ? "x" : "-"}` };
      }),
    [mode],
  );
  const toggle = (shift: number, bit: number) => onChange(mode ^ (bit << shift));
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              {BITS.map((b) => (
                <th key={b.short} className="px-3 py-2 text-center font-medium">
                  {b.label} <span className="font-mono">({b.value})</span>
                </th>
              ))}
              <th className="px-3 py-2 text-center font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((r) => (
              <tr key={r.key} className="border-t">
                <td className="px-3 py-2.5">
                  <span className="font-medium">{r.label}</span>
                  {!compact && <span className="block text-xs text-muted-foreground">{r.hint}</span>}
                </td>
                {BITS.map((b) => (
                  <td key={b.short} className="px-3 py-2.5 text-center">
                    <Checkbox checked={!!(r.v & b.value)} onCheckedChange={() => toggle(r.shift, b.value)} aria-label={`${r.label} ${b.label}`} />
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center font-mono">
                  <span className="text-muted-foreground">{r.rwx}</span> = <b>{r.v}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-4">
          {SPECIAL.map((s) => (
            <label key={s.label} className="flex items-center gap-2 text-sm" title={s.hint}>
              <Checkbox checked={!!(mode & s.value)} onCheckedChange={() => onChange(mode ^ s.value)} />
              <span className="font-mono">{s.label}</span>
              <span className="text-xs text-muted-foreground">({s.hint})</span>
            </label>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Numeric</p>
          <Input
            value={octal}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-7]/g, "").slice(0, 4);
              if (v.length >= 3) onChange(parseInt(v, 8));
            }}
            className="mt-1 h-9 font-mono text-lg font-semibold"
            aria-label="Numeric permission"
          />
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Symbolic</p>
          <p className="mt-2 font-mono text-lg font-semibold tracking-wider">{symbolicStr}</p>
        </div>
        <div className="rounded-lg border bg-[var(--terminal-bg)] p-3 text-[#d7dde6]">
          <p className="flex items-center justify-between text-xs text-white/60">
            Command
            <button
              type="button"
              className="hover:text-white"
              onClick={() => void navigator.clipboard?.writeText(command).then(() => toast.success("Copied"))}
              aria-label="Copy command"
            >
              <Copy className="size-3.5" />
            </button>
          </p>
          <p className="mt-2 truncate font-mono text-sm text-[#7ee787]">{command}</p>
        </div>
      </div>
    </div>
  );
}

export function PermissionCalculatorCard({ value, onValue }: { value: number; onValue: (n: number) => void }) {
  return (
    <section className={cn("rounded-xl border bg-card p-5")}>
      <h3 className="mb-1 flex items-center gap-2 font-semibold">
        <Calculator className="size-4 text-primary" /> Permission calculator
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">Tick the boxes to build a permission and see its numeric and symbolic forms.</p>
      <PermissionCalculator mode={value} onChange={onValue} />
    </section>
  );
}
