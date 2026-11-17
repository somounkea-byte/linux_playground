"use client";

import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";

export interface QuizFormValue {
  id?: string;
  title: string;
  slug: string;
  description: string;
  moduleId: string | null;
  timeLimitSec: number | null;
  questionsPerAttempt: number | null;
  randomize: boolean;
  passingScore: number;
  xpReward: number;
  isPublished: boolean;
  questions: { id?: string; type: string; prompt: string; explanation: string | null; points: number; options: unknown; answer: unknown }[];
}

const TEMPLATES: Record<string, { options: unknown; answer: unknown; help: string }> = {
  MULTIPLE_CHOICE: { options: { choices: ["Option A", "Option B", "Option C"] }, answer: { correct: [0] }, help: "correct = indexes (0-based) of the right choices; several = multiple answers" },
  TRUE_FALSE: { options: {}, answer: { value: true }, help: "value = true or false" },
  FILL_BLANK: { options: { placeholder: "command" }, answer: { accepted: ["whoami"] }, help: "accepted = every accepted answer (case-insensitive)" },
  PERMISSION: { options: { format: "numeric" }, answer: { accepted: ["755"] }, help: "accepted numeric modes" },
  PREDICT_OUTPUT: { options: { command: "echo $((2+3))", choices: ["5", "2+3", "$((2+3))"] }, answer: { correct: [0] }, help: "with choices use correct; without choices use accepted: [\"exact output\"]" },
  MATCHING: { options: { left: ["pwd", "ls"], right: ["Print working directory", "List files"] }, answer: { pairs: [0, 1] }, help: "pairs[i] = index in right that matches left[i]" },
  PRACTICAL: {
    options: { task: "Create the directory ~/lab", setupScript: "" },
    answer: { checks: [{ id: "c1", type: "file_exists", path: "/home/student/lab", kind: "dir", description: "~/lab exists" }] },
    help: "checks use the same format as exercise tasks; the student's commands run on a fresh machine",
  },
};

export function QuizEditor({ initial, modules, readOnly }: { initial: QuizFormValue | null; modules: { id: string; title: string }[]; readOnly: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<QuizFormValue>(
    initial ?? { title: "", slug: "", description: "", moduleId: null, timeLimitSec: 600, questionsPerAttempt: null, randomize: true, passingScore: 70, xpReward: 30, isPublished: true, questions: [{ type: "MULTIPLE_CHOICE", prompt: "", explanation: null, points: 1, ...TEMPLATES.MULTIPLE_CHOICE }] },
  );
  const [defs, setDefs] = useState<string[]>(v.questions.map((q) => JSON.stringify({ options: q.options, answer: q.answer }, null, 1)));
  const [saving, setSaving] = useState(false);
  const setQ = (i: number, patch: Partial<QuizFormValue["questions"][number]>) => setV((p) => ({ ...p, questions: p.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= v.questions.length) return;
    const qs = [...v.questions];
    [qs[i], qs[j]] = [qs[j], qs[i]];
    const ds = [...defs];
    [ds[i], ds[j]] = [ds[j], ds[i]];
    setV({ ...v, questions: qs });
    setDefs(ds);
  };

  async function save() {
    let questions;
    try {
      questions = v.questions.map((q, i) => ({ ...q, ...JSON.parse(defs[i]) }));
    } catch {
      toast.error("A question definition is not valid JSON.");
      return;
    }
    setSaving(true);
    try {
      const r = await api<{ id: string }>(v.id ? `/api/teacher/quizzes/${v.id}` : "/api/teacher/quizzes", { method: v.id ? "PUT" : "POST", body: { ...v, questions } });
      toast.success("Quiz saved");
      router.push(`/teacher/quizzes/${r.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset disabled={readOnly} className="max-w-5xl space-y-6">
      <section className="grid gap-3 rounded-xl border bg-card p-5 md:grid-cols-3">
        <div className="space-y-1.5 md:col-span-2">
          <Label>Title</Label>
          <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Module</Label>
          <NativeSelect value={v.moduleId ?? ""} onChange={(e) => setV({ ...v, moduleId: e.target.value || null })}>
            <option value="">— none —</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5 md:col-span-3">
          <Label>Description</Label>
          <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Time limit (minutes, blank = none)</Label>
          <Input type="number" value={v.timeLimitSec ? v.timeLimitSec / 60 : ""} onChange={(e) => setV({ ...v, timeLimitSec: e.target.value ? Number(e.target.value) * 60 : null })} />
        </div>
        <div className="space-y-1.5">
          <Label>Questions per attempt (blank = all)</Label>
          <Input type="number" value={v.questionsPerAttempt ?? ""} onChange={(e) => setV({ ...v, questionsPerAttempt: e.target.value ? Number(e.target.value) : null })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Pass %</Label>
            <Input type="number" value={v.passingScore} onChange={(e) => setV({ ...v, passingScore: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>XP</Label>
            <Input type="number" value={v.xpReward} onChange={(e) => setV({ ...v, xpReward: Number(e.target.value) })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={v.randomize} onCheckedChange={(c) => setV({ ...v, randomize: !!c })} /> Randomize question order
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={v.isPublished} onCheckedChange={(c) => setV({ ...v, isPublished: !!c })} /> Published
        </label>
      </section>
      {v.questions.map((q, i) => (
        <section key={i} className="space-y-3 rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Question {i + 1}</span>
            <NativeSelect
              className="w-48"
              value={q.type}
              onChange={(e) => {
                const t = TEMPLATES[e.target.value];
                setQ(i, { type: e.target.value });
                setDefs((d) => d.map((x, j) => (j === i ? JSON.stringify({ options: t.options, answer: t.answer }, null, 1) : x)));
              }}
            >
              {Object.keys(TEMPLATES).map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ").toLowerCase()}
                </option>
              ))}
            </NativeSelect>
            <Label className="ml-auto">Points</Label>
            <Input type="number" className="w-16" value={q.points} onChange={(e) => setQ(i, { points: Number(e.target.value) })} />
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => move(i, -1)} aria-label="Move up">
              <ArrowUp />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => move(i, 1)} aria-label="Move down">
              <ArrowDown />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Delete question"
              onClick={() => {
                setV({ ...v, questions: v.questions.filter((_, j) => j !== i) });
                setDefs(defs.filter((_, j) => j !== i));
              }}
            >
              <Trash2 className="text-destructive" />
            </Button>
          </div>
          <Textarea value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} placeholder="Question text (use `backticks` for code)" rows={2} />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Options & answer (JSON)</Label>
              <Textarea value={defs[i]} onChange={(e) => setDefs((d) => d.map((x, j) => (j === i ? e.target.value : x)))} rows={6} className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">{TEMPLATES[q.type]?.help}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Explanation (shown after grading)</Label>
              <Textarea value={q.explanation ?? ""} onChange={(e) => setQ(i, { explanation: e.target.value || null })} rows={6} />
            </div>
          </div>
        </section>
      ))}
      {!readOnly && (
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setV({ ...v, questions: [...v.questions, { type: "MULTIPLE_CHOICE", prompt: "", explanation: null, points: 1, ...TEMPLATES.MULTIPLE_CHOICE }] });
              setDefs([...defs, JSON.stringify({ options: TEMPLATES.MULTIPLE_CHOICE.options, answer: TEMPLATES.MULTIPLE_CHOICE.answer }, null, 1)]);
            }}
          >
            <Plus /> Add question
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save quiz
          </Button>
          {v.id && (
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                if (!window.confirm("Delete this quiz and all attempts?")) return;
                await api(`/api/teacher/quizzes/${v.id}`, { method: "DELETE" });
                router.push("/teacher/quizzes");
                router.refresh();
              }}
            >
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      )}
    </fieldset>
  );
}
