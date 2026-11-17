"use client";

import { KeyRound, Loader2, Lock, LockOpen, Plus, RefreshCw, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { linuxAction, useLinuxResource, type ToolTarget } from "./use-resource";

interface LUser {
  username: string;
  uid: number;
  gid: number;
  gecos: string;
  primaryGroup: string;
  groups: string[];
  home: string;
  shell: string;
  locked: boolean;
  hasPassword: boolean;
  system: boolean;
}
interface LGroup {
  name: string;
  gid: number;
  members: string[];
  system: boolean;
  primaryOf: string[];
}

/** Visual user & group administration on the same virtual machine as the terminal. */
export function UserManager({ refreshKey = 0, onChanged, target }: { refreshKey?: number; onChanged?: () => void; target?: ToolTarget }) {
  const [localKey, setLocalKey] = useState(0);
  const { data, loading } = useLinuxResource<{ users: LUser[]; groups: LGroup[] }>("users", refreshKey + localKey, target);
  const [showSystem, setShowSystem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "createUser" | "createGroup" | "password" | "groups" | "deleteUser"; user?: LUser }>(null);
  const [form, setForm] = useState({ username: "", fullName: "", shell: "/bin/bash", createHome: true, groups: [] as string[], password: "", group: "", removeHome: true });

  async function run(resource: "users" | "groups", payload: Record<string, unknown>, equivalent: string) {
    setBusy(true);
    try {
      await linuxAction(resource, payload, target);
      setLastCommand(equivalent);
      toast.success("Saved");
      setDialog(null);
      setLocalKey((k) => k + 1);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const users = (data?.users ?? []).filter((u) => showSystem || !u.system);
  const groups = (data?.groups ?? []).filter((g) => showSystem || !g.system);
  const allGroups = data?.groups ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            setForm({ ...form, username: "", fullName: "", password: "", groups: [], createHome: true, shell: "/bin/bash" });
            setDialog({ kind: "createUser" });
          }}
        >
          <UserPlus /> Add user
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setForm({ ...form, group: "" });
            setDialog({ kind: "createGroup" });
          }}
        >
          <Plus /> Add group
        </Button>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={showSystem} onCheckedChange={(v) => setShowSystem(!!v)} /> Show system accounts
        </label>
        <Button size="icon-sm" variant="ghost" onClick={() => setLocalKey((k) => k + 1)} aria-label="Refresh">
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>

      {lastCommand && (
        <div className="rounded-lg border bg-[var(--terminal-bg)] px-3 py-2 font-mono text-xs text-[#d7dde6]">
          <span className="text-white/50">Terminal equivalent: </span>
          <span className="text-[#7ee787]">$</span> {lastCommand}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Username</th>
              <th className="px-3 py-2 text-left font-medium">UID</th>
              <th className="px-3 py-2 text-left font-medium">Primary group</th>
              <th className="px-3 py-2 text-left font-medium">Secondary groups</th>
              <th className="hidden px-3 py-2 text-left font-medium lg:table-cell">Home</th>
              <th className="hidden px-3 py-2 text-left font-medium md:table-cell">Shell</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username} className="border-t">
                <td className="px-3 py-2 font-mono text-xs font-medium">{u.username}</td>
                <td className="px-3 py-2 font-mono text-xs">{u.uid}</td>
                <td className="px-3 py-2 text-xs">
                  {u.primaryGroup} <span className="text-muted-foreground">({u.gid})</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {u.groups.length ? u.groups.map((g) => <Badge key={g} variant="secondary" className="font-mono text-[0.65rem]">{g}</Badge>) : <span className="text-xs text-muted-foreground">—</span>}
                  </div>
                </td>
                <td className="hidden px-3 py-2 font-mono text-xs lg:table-cell">{u.home}</td>
                <td className="hidden px-3 py-2 font-mono text-xs md:table-cell">{u.shell}</td>
                <td className="px-3 py-2 text-xs">
                  {u.locked ? <span className="text-destructive">Locked</span> : u.hasPassword ? <span className="text-success">Active</span> : <span className="text-muted-foreground">No password</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-0.5">
                    <Button size="icon-xs" variant="ghost" title="Edit groups (usermod -G)" aria-label={`Groups of ${u.username}`} onClick={() => {
                      setForm({ ...form, groups: u.groups });
                      setDialog({ kind: "groups", user: u });
                    }}>
                      <Users />
                    </Button>
                    <Button size="icon-xs" variant="ghost" title="Set password (passwd)" aria-label={`Password of ${u.username}`} onClick={() => {
                      setForm({ ...form, password: "" });
                      setDialog({ kind: "password", user: u });
                    }}>
                      <KeyRound />
                    </Button>
                    {u.uid !== 0 && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title={u.locked ? "Unlock (usermod -U)" : "Lock (usermod -L)"}
                        aria-label={u.locked ? `Unlock ${u.username}` : `Lock ${u.username}`}
                        onClick={() => run("users", { action: u.locked ? "unlock" : "lock", username: u.username }, `sudo usermod -${u.locked ? "U" : "L"} ${u.username}`)}
                      >
                        {u.locked ? <LockOpen /> : <Lock />}
                      </Button>
                    )}
                    {u.uid >= 1000 && u.username !== "student" && u.uid !== 65534 && (
                      <Button size="icon-xs" variant="ghost" title="Delete (userdel)" aria-label={`Delete ${u.username}`} onClick={() => {
                        setForm({ ...form, removeHome: true });
                        setDialog({ kind: "deleteUser", user: u });
                      }}>
                        <Trash2 className="text-destructive" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Groups</h4>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <div key={g.name} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-medium">
                  {g.name} <span className="text-xs font-normal text-muted-foreground">GID {g.gid}</span>
                </span>
                {!g.system && g.primaryOf.length === 0 && (
                  <Button size="icon-xs" variant="ghost" aria-label={`Delete group ${g.name}`} onClick={() => run("groups", { action: "delete", name: g.name }, `sudo groupdel ${g.name}`)}>
                    <Trash2 className="text-destructive" />
                  </Button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {g.primaryOf.map((m) => (
                  <Badge key={`p-${m}`} variant="outline" className="font-mono text-[0.65rem]" title="primary group">
                    {m}*
                  </Badge>
                ))}
                {g.members.map((m) => (
                  <Badge key={m} variant="secondary" className="gap-1 font-mono text-[0.65rem]">
                    {m}
                    <button aria-label={`Remove ${m} from ${g.name}`} className="hover:text-destructive" onClick={() => run("groups", { action: "removeMember", name: g.name, username: m }, `sudo gpasswd -d ${m} ${g.name}`)}>
                      ×
                    </button>
                  </Badge>
                ))}
                {!g.members.length && !g.primaryOf.length && <span className="text-xs text-muted-foreground">no members</span>}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">* primary group of that user</p>
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog?.kind === "createUser" && (
            <>
              <DialogHeader>
                <DialogTitle>Add user</DialogTitle>
                <DialogDescription>Same as <code className="font-mono">sudo useradd -m -s SHELL -G GROUPS NAME</code>.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Username</Label>
                    <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} className="font-mono" placeholder="john" autoFocus />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Full name</Label>
                    <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="John Smith" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Shell</Label>
                    <NativeSelect value={form.shell} onChange={(e) => setForm({ ...form, shell: e.target.value })}>
                      <option>/bin/bash</option>
                      <option>/bin/sh</option>
                      <option>/usr/sbin/nologin</option>
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Password (optional)</Label>
                    <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.createHome} onCheckedChange={(v) => setForm({ ...form, createHome: !!v })} /> Create home directory (-m)
                </label>
                <div>
                  <Label className="mb-1.5">Secondary groups</Label>
                  <GroupPicker groups={allGroups} value={form.groups} onChange={(groups) => setForm({ ...form, groups })} />
                </div>
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button
                  disabled={busy || !form.username}
                  onClick={() =>
                    run(
                      "users",
                      { action: "create", username: form.username, fullName: form.fullName || undefined, shell: form.shell, createHome: form.createHome, groups: form.groups, password: form.password || undefined },
                      `sudo useradd${form.createHome ? " -m" : ""} -s ${form.shell}${form.groups.length ? ` -G ${form.groups.join(",")}` : ""} ${form.username}${form.password ? ` && sudo passwd ${form.username}` : ""}`,
                    )
                  }
                >
                  {busy && <Loader2 className="animate-spin" />} Create user
                </Button>
              </DialogFooter>
            </>
          )}
          {dialog?.kind === "createGroup" && (
            <>
              <DialogHeader>
                <DialogTitle>Add group</DialogTitle>
                <DialogDescription>Same as <code className="font-mono">sudo groupadd NAME</code>.</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label>Group name</Label>
                <Input value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value.toLowerCase() })} className="font-mono" placeholder="developers" autoFocus />
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button disabled={busy || !form.group} onClick={() => run("groups", { action: "create", name: form.group }, `sudo groupadd ${form.group}`)}>
                  {busy && <Loader2 className="animate-spin" />} Create group
                </Button>
              </DialogFooter>
            </>
          )}
          {dialog?.kind === "password" && dialog.user && (
            <>
              <DialogHeader>
                <DialogTitle>Set password for {dialog.user.username}</DialogTitle>
                <DialogDescription>Stored as a salted hash in /etc/shadow – never in plain text.</DialogDescription>
              </DialogHeader>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoFocus />
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button disabled={busy || !form.password} onClick={() => run("users", { action: "password", username: dialog.user!.username, password: form.password }, `sudo passwd ${dialog.user!.username}`)}>
                  Save password
                </Button>
              </DialogFooter>
            </>
          )}
          {dialog?.kind === "groups" && dialog.user && (
            <>
              <DialogHeader>
                <DialogTitle>Secondary groups of {dialog.user.username}</DialogTitle>
                <DialogDescription>Primary group: {dialog.user.primaryGroup}</DialogDescription>
              </DialogHeader>
              <GroupPicker groups={allGroups.filter((g) => g.name !== dialog.user!.primaryGroup)} value={form.groups} onChange={(groups) => setForm({ ...form, groups })} />
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button disabled={busy} onClick={() => run("users", { action: "setGroups", username: dialog.user!.username, groups: form.groups }, `sudo usermod -G ${form.groups.join(",") || '""'} ${dialog.user!.username}`)}>
                  Save groups
                </Button>
              </DialogFooter>
            </>
          )}
          {dialog?.kind === "deleteUser" && dialog.user && (
            <>
              <DialogHeader>
                <DialogTitle>Delete user {dialog.user.username}?</DialogTitle>
              </DialogHeader>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.removeHome} onCheckedChange={(v) => setForm({ ...form, removeHome: !!v })} /> Also remove {dialog.user.home} (-r)
              </label>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button variant="destructive" disabled={busy} onClick={() => run("users", { action: "delete", username: dialog.user!.username, removeHome: form.removeHome }, `sudo userdel${form.removeHome ? " -r" : ""} ${dialog.user!.username}`)}>
                  Delete user
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupPicker({ groups, value, onChange }: { groups: LGroup[]; value: string[]; onChange: (v: string[]) => void }) {
  const [showAll, setShowAll] = useState(false);
  const list = groups.filter((g) => showAll || !g.system || value.includes(g.name) || ["sudo", "adm", "www-data", "users"].includes(g.name));
  return (
    <div>
      <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
        {list.map((g) => {
          const on = value.includes(g.name);
          return (
            <button
              key={g.name}
              type="button"
              onClick={() => onChange(on ? value.filter((v) => v !== g.name) : [...value, g.name])}
              className={cn("rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors", on ? "border-primary bg-primary/15 text-primary" : "hover:bg-accent")}
            >
              {g.name}
            </button>
          );
        })}
      </div>
      <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setShowAll(!showAll)}>
        {showAll ? "Hide system groups" : "Show all groups"}
      </button>
    </div>
  );
}
