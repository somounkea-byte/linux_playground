"use client";

import { Cpu, HardDrive, Loader2, Network, Package, PackageCheck, RefreshCw, Search, Shield, Skull } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ProgressBar } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CommandResultView, type CommandResult } from "./command-result";
import { linuxAction, useLinuxResource, type ToolTarget } from "./use-resource";

interface Proc {
  pid: number;
  ppid: number;
  user: string;
  command: string;
  args: string;
  state: string;
  cpu: number;
  mem: number;
  rss: number;
  nice: number;
  service: string | null;
  kernel: boolean;
}

export function ProcessViewer({ refreshKey = 0, onChanged, target }: { refreshKey?: number; onChanged?: () => void; target?: ToolTarget }) {
  const [k, setK] = useState(0);
  const { data, loading } = useLinuxResource<Proc[]>("processes", refreshKey + k, target);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [filter, setFilter] = useState("");
  const [showKernel, setShowKernel] = useState(false);
  async function kill(p: Proc, signal: string) {
    try {
      const r = await linuxAction<CommandResult>("processes", { action: "kill", pid: p.pid, signal, sudo: p.user !== "student" }, target);
      setResult(r);
      setK((x) => x + 1);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }
  const rows = (data ?? []).filter((p) => (showKernel || !p.kernel) && (!filter || `${p.command} ${p.args} ${p.user}`.includes(filter)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter like `ps aux | grep …`" className="pl-8" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showKernel} onChange={(e) => setShowKernel(e.target.checked)} /> kernel threads
        </label>
        <Button size="icon-sm" variant="outline" onClick={() => setK((x) => x + 1)} aria-label="Refresh">
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>
      <div className="max-h-[380px] overflow-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 text-muted-foreground backdrop-blur">
            <tr>
              {["PID", "USER", "STAT", "%CPU", "%MEM", "NI", "COMMAND", ""].map((h) => (
                <th key={h} className="px-2.5 py-2 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((p) => (
              <tr key={p.pid} className="border-t">
                <td className="px-2.5 py-1.5">{p.pid}</td>
                <td className="px-2.5 py-1.5">{p.user}</td>
                <td className="px-2.5 py-1.5">{p.state}</td>
                <td className="px-2.5 py-1.5">{p.cpu.toFixed(1)}</td>
                <td className="px-2.5 py-1.5">{p.mem.toFixed(1)}</td>
                <td className="px-2.5 py-1.5">{p.nice}</td>
                <td className="max-w-[18rem] truncate px-2.5 py-1.5" title={p.args}>
                  {p.args}
                </td>
                <td className="px-2.5 py-1.5 text-right">
                  {p.pid !== 1 && !p.kernel && (
                    <span className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => kill(p, "TERM")} title="kill PID (SIGTERM)">
                        kill
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => kill(p, "KILL")} title="kill -9 PID (SIGKILL)" aria-label={`Force kill ${p.pid}`}>
                        <Skull className="text-destructive" />
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CommandResultView result={result} />
    </div>
  );
}

interface Pkg {
  name: string;
  description: string;
  section: string;
  version: string;
  installed: boolean;
  auto: boolean;
  upgradable: boolean;
  service: string | null;
  essential: boolean;
  preinstalled: boolean;
  sizeKb: number;
}

export function PackageManager({ refreshKey = 0, onChanged, target }: { refreshKey?: number; onChanged?: () => void; target?: ToolTarget }) {
  const [k, setK] = useState(0);
  const { data } = useLinuxResource<Pkg[]>("packages", refreshKey + k, target);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [tab, setTab] = useState<"available" | "installed">("available");
  async function act(action: string, name?: string) {
    setBusy(name ?? action);
    try {
      const r = await linuxAction<CommandResult>("packages", { action, name }, target);
      setResult(r);
      setK((x) => x + 1);
      onChanged?.();
      if (r.exitCode !== 0) toast.error("apt reported an error");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }
  const list = (data ?? []).filter((p) => (tab === "installed" ? p.installed : !p.preinstalled || p.installed === false) && (!query || p.name.includes(query) || p.description.toLowerCase().includes(query.toLowerCase())));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border p-0.5 text-xs">
          {(["available", "installed"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1 capitalize", tab === t && "bg-primary text-primary-foreground")}>
              {t}
            </button>
          ))}
        </div>
        <div className="relative min-w-40 flex-1">
          <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="apt search …" className="pl-8" />
        </div>
        <Button size="sm" variant="outline" onClick={() => act("update")} disabled={!!busy}>
          {busy === "update" ? <Loader2 className="animate-spin" /> : <RefreshCw />} apt update
        </Button>
        <Button size="sm" variant="outline" onClick={() => act("upgrade")} disabled={!!busy || !data?.some((p) => p.upgradable)}>
          Upgrade all
        </Button>
      </div>
      <div className="grid max-h-[380px] gap-2 overflow-y-auto sm:grid-cols-2">
        {list.map((p) => (
          <div key={p.name} className="flex items-start gap-3 rounded-lg border p-3">
            {p.installed ? <PackageCheck className="mt-0.5 size-5 shrink-0 text-success" /> : <Package className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 font-mono text-sm font-medium">
                {p.name}
                {p.service && <Badge variant="outline" className="text-[0.6rem]">service</Badge>}
                {p.upgradable && <Badge className="text-[0.6rem]">upgrade</Badge>}
              </p>
              <p className="truncate text-xs text-muted-foreground">{p.description}</p>
              <p className="font-mono text-[0.65rem] text-muted-foreground">{p.version}</p>
            </div>
            {p.installed ? (
              !p.essential && (
                <Button size="xs" variant="outline" disabled={!!busy} onClick={() => act("remove", p.name)}>
                  {busy === p.name ? <Loader2 className="animate-spin" /> : "Remove"}
                </Button>
              )
            ) : (
              <Button size="xs" disabled={!!busy} onClick={() => act("install", p.name)}>
                {busy === p.name ? <Loader2 className="animate-spin" /> : "Install"}
              </Button>
            )}
          </div>
        ))}
      </div>
      <CommandResultView result={result} />
    </div>
  );
}

interface SystemData {
  hostname: string;
  interfaces: { name: string; ipv4: string; prefix: number; mac: string; up: boolean }[];
  gateway: string;
  dns: string[];
  sockets: { proto: string; address: string; port: number; service: string }[];
  firewall: { enabled: boolean; rules: { action: string; port: string; proto?: string; from: string }[] };
  services: { name: string; enabled: boolean; active: boolean }[];
  mounts: { source: string; fstype: string; size: number; used: number; target: string }[];
  disks: { name: string; type: string; size: number; fstype?: string; mountpoint?: string }[];
  memory: { total: number; used: number; available: number; buffCache: number; swapTotal: number; swapUsed: number };
  authLog: { ts: number; source: string; message: string }[];
}

const gib = (b: number) => `${(b / 1024 ** 3).toFixed(1)}G`;

export function SystemPanel({ refreshKey = 0, focus, target, onChanged }: { refreshKey?: number; focus: "network" | "storage" | "security"; target?: ToolTarget; onChanged?: () => void }) {
  const [k, setK] = useState(0);
  const { data, loading } = useLinuxResource<SystemData>("system", refreshKey + k, target);
  const [result, setResult] = useState<CommandResult | null>(null);
  async function svc(action: string, name: string) {
    try {
      const r = await linuxAction<CommandResult>("services", { action, name }, target);
      setResult(r);
      setK((x) => x + 1);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }
  if (!data)
    return (
      <div className="grid h-40 place-items-center text-muted-foreground">
        <Loader2 className="animate-spin" />
      </div>
    );
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="icon-sm" variant="outline" onClick={() => setK((x) => x + 1)} aria-label="Refresh">
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>
      {focus === "network" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel icon={<Network />} title="Interfaces">
            {data.interfaces.map((i) => (
              <div key={i.name} className="flex items-center justify-between border-b py-2 font-mono text-xs last:border-0">
                <span>
                  <span className={cn("mr-2 inline-block size-2 rounded-full", i.up ? "bg-success" : "bg-destructive")} />
                  {i.name}
                </span>
                <span>
                  {i.ipv4}/{i.prefix}
                </span>
                <span className="hidden text-muted-foreground sm:inline">{i.mac}</span>
              </div>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">
              Gateway <span className="font-mono">{data.gateway}</span> · DNS <span className="font-mono">{data.dns.join(", ")}</span>
            </p>
          </Panel>
          <Panel icon={<Network />} title="Listening ports (ss -tuln)">
            {data.sockets.map((s, i) => (
              <div key={i} className="flex justify-between border-b py-1.5 font-mono text-xs last:border-0">
                <span>{s.proto}</span>
                <span>
                  {s.address}:{s.port}
                </span>
                <span className="text-muted-foreground">{s.service}</span>
              </div>
            ))}
          </Panel>
        </div>
      )}
      {focus === "storage" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel icon={<HardDrive />} title="File systems (df -h)">
            {data.mounts.map((m) => (
              <div key={m.target} className="border-b py-2 last:border-0">
                <div className="flex justify-between font-mono text-xs">
                  <span>{m.target}</span>
                  <span className="text-muted-foreground">
                    {gib(m.used)} / {gib(m.size)} · {m.fstype}
                  </span>
                </div>
                <ProgressBar value={(m.used / Math.max(1, m.size)) * 100} className="mt-1.5 h-1.5" tone={m.used / m.size > 0.85 ? "warning" : "primary"} />
              </div>
            ))}
          </Panel>
          <div className="space-y-4">
            <Panel icon={<HardDrive />} title="Block devices (lsblk)">
              {data.disks.map((d) => (
                <div key={d.name} className={cn("flex justify-between py-1 font-mono text-xs", d.type === "part" && "pl-4 text-muted-foreground")}>
                  <span>
                    {d.type === "part" ? "└─" : ""}
                    {d.name}
                  </span>
                  <span>{gib(d.size)}</span>
                  <span>{d.fstype ?? "—"}</span>
                  <span>{d.mountpoint ?? ""}</span>
                </div>
              ))}
            </Panel>
            <Panel icon={<Cpu />} title="Memory (free -h)">
              <div className="flex justify-between text-xs">
                <span>Used {gib(data.memory.used * 1024)}</span>
                <span className="text-muted-foreground">Available {gib(data.memory.available * 1024)}</span>
                <span>Total {gib(data.memory.total * 1024)}</span>
              </div>
              <ProgressBar value={(data.memory.used / data.memory.total) * 100} className="mt-2" />
            </Panel>
          </div>
        </div>
      )}
      {focus === "security" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel icon={<Shield />} title={`Firewall: ${data.firewall.enabled ? "active" : "inactive"}`}>
            {data.firewall.rules.length === 0 ? (
              <p className="text-xs text-muted-foreground">No rules. Try: sudo ufw allow OpenSSH</p>
            ) : (
              data.firewall.rules.map((r, i) => (
                <div key={i} className="flex justify-between border-b py-1.5 font-mono text-xs last:border-0">
                  <span>
                    {r.port}
                    {r.proto ? `/${r.proto}` : ""}
                  </span>
                  <span className={r.action === "allow" ? "text-success" : "text-destructive"}>{r.action.toUpperCase()}</span>
                  <span className="text-muted-foreground">{r.from}</span>
                </div>
              ))
            )}
          </Panel>
          <Panel icon={<Cpu />} title="Services">
            {data.services.map((s) => (
              <div key={s.name} className="flex items-center justify-between border-b py-1.5 text-xs last:border-0">
                <span className="font-mono">
                  <span className={cn("mr-2 inline-block size-2 rounded-full", s.active ? "bg-success" : "bg-muted-foreground/40")} />
                  {s.name}
                </span>
                <span className="text-muted-foreground">{s.enabled ? "enabled" : "disabled"}</span>
                <span className="flex gap-1">
                  <Button size="xs" variant="ghost" onClick={() => svc(s.active ? "stop" : "start", s.name)}>
                    {s.active ? "stop" : "start"}
                  </Button>
                </span>
              </div>
            ))}
          </Panel>
          <Panel icon={<Shield />} title="Recent auth.log entries" className="lg:col-span-2">
            <div className="max-h-56 overflow-y-auto font-mono text-[0.7rem]">
              {data.authLog.map((l, i) => (
                <p key={i} className="border-b py-1 last:border-0">
                  <span className="text-muted-foreground">{new Date(l.ts).toISOString().slice(5, 19).replace("T", " ")} </span>
                  <span className="text-primary">{l.source}</span>: {l.message}
                </p>
              ))}
            </div>
          </Panel>
        </div>
      )}
      <CommandResultView result={result} />
    </div>
  );
}

function Panel({ icon, title, children, className }: { icon: React.ReactNode; title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border p-4", className)}>
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-primary">
        {icon}
        {title}
      </h4>
      {children}
    </div>
  );
}
