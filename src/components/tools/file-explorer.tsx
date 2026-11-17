"use client";

import { ChevronRight, File, FilePlus2, Folder, FolderPlus, Home, KeyRound, Link2, Loader2, Pencil, RefreshCw, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { CommandResultView, type CommandResult } from "./command-result";
import { PermissionCalculator } from "./permission-calculator";
import { linuxAction, useLinuxResource, type ToolTarget } from "./use-resource";

interface Entry {
  name: string;
  path: string;
  type: string;
  mode: string;
  symbolic: string;
  owner: string;
  group: string;
  size: number;
  mtime: number;
  target: string | null;
}

interface Listing {
  path: string;
  readable: boolean;
  writable: boolean;
  entries: Entry[];
  user: string;
}

interface UsersData {
  users: { username: string }[];
  groups: { name: string }[];
}

function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} K`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} M`;
  return `${(n / 1024 ** 3).toFixed(1)} G`;
}

/**
 * Graphical file manager. Every action is executed as the equivalent shell
 * command, so permission rules apply exactly as in the terminal.
 */
export function FileExplorer({ refreshKey = 0, onChanged, target, initialPath = "/home/student", focus = "files" }: { refreshKey?: number; onChanged?: () => void; target?: ToolTarget; initialPath?: string; focus?: "files" | "permissions" }) {
  const [path, setPath] = useState(initialPath);
  const [localKey, setLocalKey] = useState(0);
  const { data, error, loading } = useLinuxResource<Listing>("files", refreshKey + localKey, target, { path });
  const users = useLinuxResource<UsersData>("users", refreshKey + localKey, target);
  const [sudo, setSudo] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "mkdir" | "touch" | "rename" | "chmod" | "chown" | "delete"; entry?: Entry }>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState(0o644);
  const [owner, setOwner] = useState("");
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState(false);

  const segments = (data?.path ?? path).split("/").filter(Boolean);

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await linuxAction<CommandResult>("files", { ...payload, sudo: payload.sudo ?? sudo }, target);
      setResult(r);
      if (r.exitCode === 0) toast.success("Done");
      else toast.error("The command failed – see the output below.");
      setDialog(null);
      setLocalKey((k) => k + 1);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function open(kind: NonNullable<typeof dialog>["kind"], entry?: Entry) {
    setDialog({ kind, entry });
    setName(entry?.name ?? "");
    if (entry) {
      setMode(parseInt(entry.mode, 8));
      setOwner(entry.owner);
      setGroup(entry.group);
    }
  }

  const join = (n: string) => (data?.path === "/" ? `/${n}` : `${data?.path}/${n}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg border bg-muted/30 px-2 py-1 font-mono text-xs" aria-label="Breadcrumb">
          <button className="rounded px-1 py-0.5 hover:bg-accent" onClick={() => setPath("/")}>
            /
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center">
              <button className="rounded px-1 py-0.5 hover:bg-accent" onClick={() => setPath("/" + segments.slice(0, i + 1).join("/"))}>
                {seg}
              </button>
              {i < segments.length - 1 && <ChevronRight className="size-3 text-muted-foreground" />}
            </span>
          ))}
        </nav>
        <Button size="icon-sm" variant="outline" onClick={() => setPath("/home/student")} aria-label="Home">
          <Home />
        </Button>
        <Button size="icon-sm" variant="outline" onClick={() => setLocalKey((k) => k + 1)} aria-label="Refresh">
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
        <Button size="sm" variant="outline" onClick={() => open("mkdir")}>
          <FolderPlus /> Folder
        </Button>
        <Button size="sm" variant="outline" onClick={() => open("touch")}>
          <FilePlus2 /> File
        </Button>
        <label className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs" title="Run actions as root, like prefixing the command with sudo">
          <Checkbox checked={sudo} onCheckedChange={(v) => setSudo(!!v)} /> sudo
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Permissions</th>
                <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Owner</th>
                <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Group</th>
                <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Size</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.path !== "/" && (
                <tr className="border-t hover:bg-accent/40">
                  <td colSpan={6} className="px-3 py-1.5">
                    <button className="flex items-center gap-2 font-mono text-xs" onClick={() => setPath(data?.path.split("/").slice(0, -1).join("/") || "/")}>
                      <Folder className="size-4 text-info" /> ..
                    </button>
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-destructive">
                    {error}
                  </td>
                </tr>
              )}
              {data && !data.readable && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-destructive">
                    ls: cannot open directory &apos;{data.path}&apos;: Permission denied (you are {data.user})
                  </td>
                </tr>
              )}
              {data?.readable && data.entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Empty directory
                  </td>
                </tr>
              )}
              {data?.entries.map((e) => (
                <tr key={e.path} className="group border-t hover:bg-accent/40">
                  <td className="max-w-[16rem] px-3 py-1.5">
                    <button
                      className="flex min-w-0 items-center gap-2 text-left font-mono text-xs"
                      onClick={() => (e.type === "dir" ? setPath(e.path) : e.type === "symlink" ? setPath(e.path) : undefined)}
                      title={e.path}
                    >
                      {e.type === "dir" ? <Folder className="size-4 shrink-0 text-info" /> : e.type === "symlink" ? <Link2 className="size-4 shrink-0 text-cyan-400" /> : <File className="size-4 shrink-0 text-muted-foreground" />}
                      <span className="truncate">
                        {e.name}
                        {e.target && <span className="text-muted-foreground"> → {e.target}</span>}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">
                    <span className="text-muted-foreground">{e.symbolic}</span> <span className="ml-1">{e.mode}</span>
                  </td>
                  <td className="hidden px-3 py-1.5 text-xs sm:table-cell">{e.owner}</td>
                  <td className="hidden px-3 py-1.5 text-xs sm:table-cell">{e.group}</td>
                  <td className="hidden px-3 py-1.5 text-right font-mono text-xs md:table-cell">{e.type === "dir" ? "—" : humanSize(e.size)}</td>
                  <td className="px-3 py-1.5">
                    <div className={cn("flex justify-end gap-0.5", focus === "files" && "opacity-60 group-hover:opacity-100")}>
                      <Button size="icon-xs" variant="ghost" onClick={() => open("chmod", e)} aria-label={`Permissions of ${e.name}`} title="chmod">
                        <ShieldCheck />
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => open("chown", e)} aria-label={`Owner of ${e.name}`} title="chown">
                        <UserCog />
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => open("rename", e)} aria-label={`Rename ${e.name}`} title="mv">
                        <Pencil />
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => open("delete", e)} aria-label={`Delete ${e.name}`} title="rm">
                        <Trash2 className="text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <CommandResultView result={result} />

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className={cn(dialog?.kind === "chmod" && "sm:max-w-2xl")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialog?.kind === "chmod" && (
                <>
                  <KeyRound className="size-4 text-primary" /> Permissions of {dialog.entry?.name}
                </>
              )}
              {dialog?.kind === "chown" && <>Change owner of {dialog.entry?.name}</>}
              {dialog?.kind === "mkdir" && <>New folder</>}
              {dialog?.kind === "touch" && <>New empty file</>}
              {dialog?.kind === "rename" && <>Rename {dialog.entry?.name}</>}
              {dialog?.kind === "delete" && <>Delete {dialog.entry?.name}?</>}
            </DialogTitle>
          </DialogHeader>
          {(dialog?.kind === "mkdir" || dialog?.kind === "touch" || dialog?.kind === "rename") && (
            <div className="space-y-1.5">
              <Label htmlFor="fe-name">Name</Label>
              <Input id="fe-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus className="font-mono" />
            </div>
          )}
          {dialog?.kind === "chmod" && <PermissionCalculator mode={mode} onChange={setMode} fileName={dialog.entry?.name} isDir={dialog.entry?.type === "dir"} />}
          {dialog?.kind === "chown" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Owner</Label>
                <NativeSelect value={owner} onChange={(e) => setOwner(e.target.value)}>
                  {users.data?.users.map((u) => (
                    <option key={u.username}>{u.username}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label>Group</Label>
                <NativeSelect value={group} onChange={(e) => setGroup(e.target.value)}>
                  {users.data?.groups.map((g) => (
                    <option key={g.name}>{g.name}</option>
                  ))}
                </NativeSelect>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">Changing the owner requires root, so this runs with sudo.</p>
            </div>
          )}
          {dialog?.kind === "delete" && <p className="text-sm text-muted-foreground">This runs <code className="font-mono">rm -rf {dialog.entry?.path}</code>. There is no undo.</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant={dialog?.kind === "delete" ? "destructive" : "default"}
              disabled={busy}
              onClick={() => {
                const e = dialog?.entry;
                switch (dialog?.kind) {
                  case "mkdir":
                  case "touch":
                    if (name.trim()) void act({ action: dialog.kind, path: join(name.trim()) });
                    break;
                  case "rename":
                    if (e && name.trim()) void act({ action: "rename", path: e.path, to: join(name.trim()) });
                    break;
                  case "chmod":
                    if (e) void act({ action: "chmod", path: e.path, mode: (mode & 0o7777).toString(8).padStart(3, "0") });
                    break;
                  case "chown":
                    if (e) void act({ action: "chown", path: e.path, owner: owner !== e.owner ? owner : undefined, group: group !== e.group ? group : undefined, sudo: true });
                    break;
                  case "delete":
                    if (e) void act({ action: "delete", path: e.path });
                    break;
                }
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              {dialog?.kind === "delete" ? "Delete" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
