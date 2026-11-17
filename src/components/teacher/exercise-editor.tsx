"use client";

import { FlaskConical, Loader2, Plus, Save, Trash2 } from "lucide-react";
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

export interface ExerciseFormValue {
  id?: string;
  title: string;
  slug: string;
  kind: "CHALLENGE" | "EXERCISE";
  difficulty: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  category: string;
  summary: string;
  scenario: string;
  objectives: string[];
  instructions: string;
  setupScript: string;
  xpReward: number;
  hints: string[];
  solution: string;
  isPublished: boolean;
  tasks: { description: string; hint: string | null; points: number; check: Record<string, unknown> }[];
}

/** Parameter templates for each check type (shown as editable JSON). */
const CHECK_TEMPLATES: Record<string, Record<string, unknown>> = {
  file_exists: { path: "/home/student/notes", kind: "dir" },
  file_not_exists: { path: "/tmp/old.log" },
  file_contains: { path: "/home/student/notes.txt", text: "hello" },
  file_matches: { path: "/etc/hosts", pattern: "^10\\.0\\.2\\.60\\s+files" },
  file_mode: { path: "/home/student/script.sh", mode: "755" },
  file_owner: { path: "/var/www/project", user: "root", group: "developers" },
  user_exists: { username: "john", shell: "/bin/bash", homeExists: true },
  user_not_exists: { username: "olduser" },
  user_locked: { username: "guest", locked: true },
  user_has_password: { username: "john" },
  group_exists: { group: "developers" },
  group_not_exists: { group: "oldgroup" },
  user_in_group: { username: "john", group: "developers" },
  user_not_in_group: { username: "john", group: "sudo" },
  user_primary_group: { username: "john", group: "developers" },
  package_installed: { name: "nginx" },
  package_not_installed: { name: "apache2" },
  service_active: { name: "nginx", active: true },
  service_enabled: { name: "nginx", enabled: true },
  process_running: { name: "sleep", running: false },
  firewall_enabled: { enabled: true },
  firewall_rule: { port: "22", proto: "tcp", action: "allow" },
  disk_mounted: { device: "/dev/sdb", mountpoint: "/mnt/data" },
  disk_formatted: { device: "/dev/sdb", fstype: "ext4" },
  interface_up: { name: "eth0", up: true },
  cwd: { path: "/var/log" },
  hostname: { value: "webserver01" },
  history_contains: { pattern: "^ls -la" },
  command_output: { command: "cat /home/student/answer.txt", equals: "42", asUser: "student" },
};

const EMPTY: ExerciseFormValue = {
  title: "",
  slug: "",
  kind: "EXERCISE",
  difficulty: "BEGINNER",
  category: "basic-commands",
  summary: "",
  scenario: "",
  objectives: [],
  instructions: "",
  setupScript: "",
  xpReward: 50,
  hints: [],
  solution: "",
  isPublished: true,
  tasks: [{ description: "Create the directory ~/lab", hint: null, points: 1, check: { type: "file_exists", path: "/home/student/lab", kind: "dir" } }],
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ExerciseEditor({ initial, modules, checkTypes, readOnly }: { initial: ExerciseFormValue | null; modules: { slug: string; title: string }[]; checkTypes: Record<string, string>; readOnly: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<ExerciseFormValue>(initial ?? EMPTY);
  const [checkText, setCheckText] = useState<string[]>((initial ?? EMPTY).tasks.map((t) => JSON.stringify(Object.fromEntries(Object.entries(t.check).filter(([k]) => k !== "type")), null, 1)));
  const [saving, setSaving] = useState(false);
  const [testOut, setTestOut] = useState<{ line: string; exitCode: number; output: string }[] | null>(null);
  const set = <K extends keyof ExerciseFormValue>(k: K, val: ExerciseFormValue[K]) => setV((p) => ({ ...p, [k]: val }));

  function setTask(i: number, patch: Partial<ExerciseFormValue["tasks"][number]>) {
    setV((p) => ({ ...p, tasks: p.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  }

  async function save() {
    let tasks;
    try {
      tasks = v.tasks.map((t, i) => ({ ...t, check: { type: t.check.type, ...JSON.parse(checkText[i] || "{}") } }));
    } catch {
      toast.error("A task's check parameters are not valid JSON.");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...v, tasks, objectives: v.objectives.filter(Boolean), hints: v.hints.filter(Boolean) };
      const r = await api<{ id: string }>(v.id ? `/api/teacher/exercises/${v.id}` : "/api/teacher/exercises", { method: v.id ? "PUT" : "POST", body: payload });
      toast.success("Exercise saved");
      router.push(`/teacher/exercises/${r.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!v.id || !window.confirm("Delete this exercise and all submissions?")) return;
    await api(`/api/teacher/exercises/${v.id}`, { method: "DELETE" });
    toast.success("Deleted");
    router.push("/teacher/exercises");
    router.refresh();
  }

  async function testSetup() {
    try {
      setTestOut(await api(`/api/teacher/exercises/${v.id ?? "new"}`, { body: { setupScript: v.setupScript } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <fieldset disabled={readOnly} className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Details</h2>
        <Field label="Title">
          <Input value={v.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <NativeSelect value={v.kind} onChange={(e) => set("kind", e.target.value as never)}>
              <option value="EXERCISE">Exercise (assignable)</option>
              <option value="CHALLENGE">Challenge (public list)</option>
            </NativeSelect>
          </Field>
          <Field label="Difficulty">
            <NativeSelect value={v.difficulty} onChange={(e) => set("difficulty", e.target.value as never)}>
              <option value="BEGINNER">Beginner</option>
              <option value="INTERMEDIATE">Intermediate</option>
              <option value="ADVANCED">Advanced</option>
            </NativeSelect>
          </Field>
          <Field label="Module">
            <NativeSelect value={v.category} onChange={(e) => set("category", e.target.value)}>
              {modules.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="XP reward">
            <Input type="number" value={v.xpReward} onChange={(e) => set("xpReward", Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Summary">
          <Input value={v.summary} onChange={(e) => set("summary", e.target.value)} />
        </Field>
        <Field label="Real-world scenario">
          <Textarea value={v.scenario} onChange={(e) => set("scenario", e.target.value)} rows={3} />
        </Field>
        <Field label="Learning objectives" hint="One per line">
          <Textarea value={v.objectives.join("\n")} onChange={(e) => set("objectives", e.target.value.split("\n"))} rows={3} />
        </Field>
        <Field label="Instructions (Markdown)">
          <Textarea value={v.instructions} onChange={(e) => set("instructions", e.target.value)} rows={6} className="font-mono text-xs" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={v.isPublished} onCheckedChange={(c) => set("isPublished", !!c)} /> Published (visible to students)
        </label>
      </section>
      <div className="space-y-6">
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Initial environment</h2>
          <Field label="Setup script" hint="Commands run as root on a fresh machine before the student starts – one per line.">
            <Textarea value={v.setupScript} onChange={(e) => set("setupScript", e.target.value)} rows={6} className="bg-[var(--terminal-bg)] font-mono text-xs text-[#d7dde6]" placeholder={"useradd -m olduser\nmkdir -p /srv/app\necho 'port=80' > /srv/app/app.conf"} />
          </Field>
          <Button type="button" variant="outline" size="sm" onClick={testSetup}>
            <FlaskConical /> Test setup script
          </Button>
          {testOut && (
            <div className="max-h-48 overflow-auto rounded-lg bg-[var(--terminal-bg)] p-3 font-mono text-xs text-[#d7dde6]">
              {testOut.length === 0 && <p>(empty script)</p>}
              {testOut.map((t, i) => (
                <div key={i}>
                  <p className={t.exitCode ? "text-[#ff7b72]" : "text-[#7ee787]"}># {t.line}</p>
                  {t.output && <pre className="whitespace-pre-wrap text-white/70">{t.output}</pre>}
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Hints & solution</h2>
          <Field label="Hints" hint="One per line, revealed progressively">
            <Textarea value={v.hints.join("\n")} onChange={(e) => set("hints", e.target.value.split("\n"))} rows={3} />
          </Field>
          <Field label="Solution explanation">
            <Textarea value={v.solution} onChange={(e) => set("solution", e.target.value)} rows={5} className="font-mono text-xs" />
          </Field>
        </section>
      </div>
      <section className="space-y-3 rounded-xl border bg-card p-5 lg:col-span-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Tasks & automatic grading</h2>
            <p className="text-sm text-muted-foreground">Each task checks the final state of the machine, so any valid sequence of commands passes.</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setV((p) => ({ ...p, tasks: [...p.tasks, { description: "", hint: null, points: 1, check: { type: "file_exists" } }] }));
              setCheckText((c) => [...c, JSON.stringify(CHECK_TEMPLATES.file_exists, null, 1)]);
            }}
          >
            <Plus /> Add task
          </Button>
        </div>
        {v.tasks.map((t, i) => (
          <div key={i} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_220px_1fr_auto]">
            <Field label={`Task ${i + 1}`}>
              <Input value={t.description} onChange={(e) => setTask(i, { description: e.target.value })} placeholder="What the student must achieve" />
            </Field>
            <Field label="Check type">
              <NativeSelect
                value={String(t.check.type)}
                onChange={(e) => {
                  setTask(i, { check: { type: e.target.value } });
                  setCheckText((c) => c.map((x, j) => (j === i ? JSON.stringify(CHECK_TEMPLATES[e.target.value] ?? {}, null, 1) : x)));
                }}
              >
                {Object.entries(checkTypes).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Parameters (JSON)">
              <Textarea value={checkText[i] ?? "{}"} onChange={(e) => setCheckText((c) => c.map((x, j) => (j === i ? e.target.value : x)))} rows={3} className="font-mono text-xs" />
            </Field>
            <div className="flex items-end gap-2">
              <Field label="Points">
                <Input type="number" min={1} value={t.points} onChange={(e) => setTask(i, { points: Number(e.target.value) })} className="w-16" />
              </Field>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Remove task"
                onClick={() => {
                  setV((p) => ({ ...p, tasks: p.tasks.filter((_, j) => j !== i) }));
                  setCheckText((c) => c.filter((_, j) => j !== i));
                }}
              >
                <Trash2 className="text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </section>
      {!readOnly && (
        <div className="flex gap-3 lg:col-span-2">
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save exercise
          </Button>
          {v.id && (
            <Button type="button" variant="destructive" onClick={remove}>
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      )}
    </fieldset>
  );
}
