"use client";

import { Loader2, MoreHorizontal, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { api } from "@/lib/api-client";

type Teacher = { id: string; name: string };

export function CreateUserButton({ teachers }: { teachers: Teacher[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({ name: "", email: "", role: "STUDENT", password: "", teacherId: "" });
  async function submit() {
    setBusy(true);
    try {
      await api("/api/admin/users", { body: { ...v, password: v.password || undefined, teacherId: v.teacherId || null } });
      toast.success("User created");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <UserPlus /> Add user
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <NativeSelect value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
                <option value="STUDENT">Student</option>
                <option value="TEACHER">Teacher</option>
                <option value="ADMIN">Administrator</option>
              </NativeSelect>
            </div>
            {v.role === "STUDENT" && (
              <div className="space-y-1.5">
                <Label>Teacher</Label>
                <NativeSelect value={v.teacherId} onChange={(e) => setV({ ...v, teacherId: e.target.value })}>
                  <option value="">— none —</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Initial password (local accounts only)</Label>
            <Input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} placeholder="With Firebase, users sign in with this email" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={busy || !v.name || !v.email}>
            {busy && <Loader2 className="animate-spin" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserRowActions({ user, teachers, isSelf }: { user: { id: string; name: string; role: string; isActive: boolean; teacherId: string | null }; teachers: Teacher[]; isSelf: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "role" | "teacher" | "password">(null);
  const [value, setValue] = useState("");
  async function patch(body: Record<string, unknown>, msg: string) {
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body });
      toast.success(msg);
      setDialog(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Actions for ${user.name}`} />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            disabled={isSelf}
            onClick={() => {
              setValue(user.role);
              setDialog("role");
            }}
          >
            Change role
          </DropdownMenuItem>
          {user.role === "STUDENT" && (
            <DropdownMenuItem
              onClick={() => {
                setValue(user.teacherId ?? "");
                setDialog("teacher");
              }}
            >
              Assign teacher
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => {
              setValue("");
              setDialog("password");
            }}
          >
            Reset password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => patch({ revokeSessions: true }, "Sessions revoked")}>Sign out everywhere</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={isSelf} variant={user.isActive ? "destructive" : "default"} onClick={() => patch({ isActive: !user.isActive }, user.isActive ? "Account disabled" : "Account enabled")}>
            {user.isActive ? "Disable account" : "Enable account"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isSelf}
            variant="destructive"
            onClick={async () => {
              if (!window.confirm(`Delete ${user.name} and all their data?`)) return;
              await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
              router.refresh();
            }}
          >
            Delete user
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "role" ? "Change role" : dialog === "teacher" ? "Assign teacher" : "Reset password"} – {user.name}
            </DialogTitle>
          </DialogHeader>
          {dialog === "role" && (
            <NativeSelect value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="STUDENT">Student</option>
              <option value="TEACHER">Teacher</option>
              <option value="ADMIN">Administrator</option>
            </NativeSelect>
          )}
          {dialog === "teacher" && (
            <NativeSelect value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">— none —</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          )}
          {dialog === "password" && <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="New password (min 8 characters)" />}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={() =>
                dialog === "role" ? patch({ role: value }, "Role updated") : dialog === "teacher" ? patch({ teacherId: value || null }, "Teacher assigned") : patch({ password: value }, "Password reset")
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
