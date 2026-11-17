"use client";

import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";

export function NewModuleButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ slug: "", title: "", description: "", icon: "terminal" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus /> New module
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New module</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Label>Title</Label>
          <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value, slug: v.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })} />
          <Label>Slug</Label>
          <Input value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value })} className="font-mono" />
          <Label>Description</Label>
          <Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            onClick={async () => {
              try {
                const r = await api<{ id: string }>("/api/admin/modules", { body: v });
                router.push(`/admin/modules/${r.id}`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              }
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface LessonValue {
  id?: string;
  slug: string;
  title: string;
  summary: string;
  content: string;
  practice: unknown;
  checks: unknown;
  xpReward: number;
  estimatedMinutes: number;
  isPublished: boolean;
  order?: number;
}

export function ModuleEditor({ module, lessons }: { module: { id: string; slug: string; title: string; description: string; icon: string; isPublished: boolean; order: number }; lessons: LessonValue[] }) {
  const router = useRouter();
  const [m, setM] = useState(module);
  const [editing, setEditing] = useState<LessonValue | null>(null);
  const [json, setJson] = useState({ practice: "[]", checks: "[]" });
  const [busy, setBusy] = useState(false);

  function edit(l: LessonValue | null) {
    const v = l ?? { slug: "", title: "", summary: "", content: "## New lesson\n\nWrite the lesson in Markdown.", practice: [], checks: [], xpReward: 20, estimatedMinutes: 10, isPublished: true };
    setEditing(v);
    setJson({ practice: JSON.stringify(v.practice, null, 2), checks: JSON.stringify(v.checks, null, 2) });
  }

  async function saveModule() {
    setBusy(true);
    try {
      await api(`/api/admin/modules/${m.id}`, { method: "PATCH", body: { title: m.title, description: m.description, icon: m.icon, isPublished: m.isPublished, order: m.order } });
      toast.success("Module saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveLesson() {
    if (!editing) return;
    let practice, checks;
    try {
      practice = JSON.parse(json.practice);
      checks = JSON.parse(json.checks);
    } catch {
      toast.error("Practice or checks is not valid JSON");
      return;
    }
    const payload = { slug: editing.slug, title: editing.title, summary: editing.summary, content: editing.content, practice, checks, xpReward: editing.xpReward, estimatedMinutes: editing.estimatedMinutes, isPublished: editing.isPublished };
    try {
      if (editing.id) await api(`/api/admin/lessons/${editing.id}`, { method: "PATCH", body: payload });
      else await api("/api/admin/lessons", { body: { ...payload, moduleId: m.id } });
      toast.success("Lesson saved");
      setEditing(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid max-w-4xl gap-3 rounded-xl border bg-card p-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Order</Label>
            <Input type="number" value={m.order} onChange={(e) => setM({ ...m, order: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <Input value={m.icon} onChange={(e) => setM({ ...m, icon: e.target.value })} />
          </div>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Description</Label>
          <Textarea value={m.description} onChange={(e) => setM({ ...m, description: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={m.isPublished} onCheckedChange={(c) => setM({ ...m, isPublished: !!c })} /> Published
        </label>
        <div className="flex justify-end gap-2">
          <Button
            variant="destructive"
            onClick={async () => {
              if (!window.confirm("Delete this module and all its lessons and student progress?")) return;
              await api(`/api/admin/modules/${m.id}`, { method: "DELETE" });
              router.push("/admin/modules");
            }}
          >
            <Trash2 /> Delete
          </Button>
          <Button onClick={saveModule} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />} Save module
          </Button>
        </div>
      </section>
      <section className="max-w-4xl rounded-xl border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Lessons</h2>
          <Button size="sm" variant="outline" onClick={() => edit(null)}>
            <Plus /> Add lesson
          </Button>
        </div>
        <ul className="divide-y">
          {lessons.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2.5">
              <span className="w-6 text-sm text-muted-foreground">{l.order}</span>
              <span className="flex-1">
                <span className="font-medium">{l.title}</span>
                {!l.isPublished && <span className="ml-2 rounded bg-muted px-1.5 text-xs">hidden</span>}
                <span className="block text-xs text-muted-foreground">
                  {(l.checks as unknown[]).length} checks · {(l.practice as unknown[]).length} practice commands · {l.xpReward} XP
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => edit(l)}>
                Edit
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Delete lesson"
                onClick={async () => {
                  if (!window.confirm(`Delete lesson "${l.title}"?`)) return;
                  await api(`/api/admin/lessons/${l.id}`, { method: "DELETE" });
                  router.refresh();
                }}
              >
                <Trash2 className="text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit lesson" : "New lesson"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} className="font-mono" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Summary</Label>
                <Input value={editing.summary} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Content (Markdown)</Label>
                <Textarea value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} rows={12} className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label>Practice commands (JSON: [{"{"}command, explanation{"}"}])</Label>
                <Textarea value={json.practice} onChange={(e) => setJson({ ...json, practice: e.target.value })} rows={6} className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label>Completion checks (JSON, same format as exercise tasks)</Label>
                <Textarea value={json.checks} onChange={(e) => setJson({ ...json, checks: e.target.value })} rows={6} className="font-mono text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>XP</Label>
                  <Input type="number" value={editing.xpReward} onChange={(e) => setEditing({ ...editing, xpReward: Number(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Minutes</Label>
                  <Input type="number" value={editing.estimatedMinutes} onChange={(e) => setEditing({ ...editing, estimatedMinutes: Number(e.target.value) })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={editing.isPublished} onCheckedChange={(c) => setEditing({ ...editing, isPublished: !!c })} /> Published
              </label>
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={saveLesson}>
              <Save /> Save lesson
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
