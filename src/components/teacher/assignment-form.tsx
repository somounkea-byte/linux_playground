"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";

export function NewAssignmentButton({ exercises, students }: { exercises: { id: string; title: string; difficulty: string; xpReward: number }[]; students: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({ exerciseId: exercises[0]?.id ?? "", title: "", instructions: "", dueAt: "", xpReward: "", allStudents: true, studentIds: [] as string[] });
  async function submit() {
    setBusy(true);
    try {
      await api("/api/teacher/assignments", {
        body: {
          exerciseId: v.exerciseId,
          title: v.title || exercises.find((e) => e.id === v.exerciseId)?.title,
          instructions: v.instructions || undefined,
          dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : null,
          xpReward: v.xpReward ? Number(v.xpReward) : null,
          allStudents: v.allStudents,
          studentIds: v.studentIds,
        },
      });
      toast.success("Assignment created and students notified");
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
        <Plus /> New assignment
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign an exercise</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Exercise</Label>
            <NativeSelect value={v.exerciseId} onChange={(e) => setV({ ...v, exerciseId: e.target.value })}>
              {exercises.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} ({e.difficulty.toLowerCase()})
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Week 4 lab" />
          </div>
          <div className="space-y-1.5">
            <Label>Instructions for students</Label>
            <Textarea value={v.instructions} onChange={(e) => setV({ ...v, instructions: e.target.value })} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Deadline</Label>
              <Input type="datetime-local" value={v.dueAt} onChange={(e) => setV({ ...v, dueAt: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>XP reward (optional)</Label>
              <Input type="number" value={v.xpReward} onChange={(e) => setV({ ...v, xpReward: e.target.value })} placeholder="default" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={v.allStudents} onCheckedChange={(c) => setV({ ...v, allStudents: !!c })} /> All my students ({students.length})
          </label>
          {!v.allStudents && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
              {students.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={v.studentIds.includes(s.id)} onCheckedChange={(c) => setV({ ...v, studentIds: c ? [...v.studentIds, s.id] : v.studentIds.filter((x) => x !== s.id) })} />
                  {s.name}
                </label>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={busy || !v.exerciseId}>
            {busy && <Loader2 className="animate-spin" />} Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteAssignmentButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Delete assignment"
      onClick={async () => {
        if (!window.confirm("Delete this assignment?")) return;
        await api(`/api/teacher/assignments/${id}`, { method: "DELETE" });
        router.refresh();
      }}
    >
      <Trash2 className="text-destructive" />
    </Button>
  );
}

export function FeedbackForm({ id, initial }: { id: string; initial: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex gap-2">
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write feedback…" className="h-8" />
      <Button
        size="sm"
        disabled={busy || !text.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/teacher/submissions/${id}`, { method: "PATCH", body: { feedback: text } });
            toast.success("Feedback sent");
            router.refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        Send
      </Button>
    </div>
  );
}
