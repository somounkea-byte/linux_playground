"use client";

import { FileCode2, Loader2, Play, Save } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { CommandResult } from "./command-result";
import { linuxAction, type ToolTarget } from "./use-resource";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-muted-foreground">
      <Loader2 className="animate-spin" />
    </div>
  ),
});

const TEMPLATES: Record<string, string> = {
  "Hello world": `#!/bin/bash
# A first script
echo "Hello, $USER!"
echo "Today is $(date +%A)"
`,
  Variables: `#!/bin/bash
name="Linux Playground"
count=$((2 + 3))
echo "Welcome to $name"
echo "2 + 3 = $count"
echo "This script is called $0 and got $# argument(s): $@"
`,
  "User input": `#!/bin/bash
read -p "What is your name? " name
read -p "How old are you? " age
if [ "$age" -ge 18 ]; then
  echo "Hello $name, you are an adult."
else
  echo "Hello $name, you are $((18 - age)) years away from 18."
fi
`,
  Loops: `#!/bin/bash
for user in alice bob carol; do
  echo "Checking account: $user"
done

i=1
while [ $i -le 3 ]; do
  echo "Attempt $i"
  i=$((i + 1))
done
`,
  "Arrays & functions": `#!/bin/bash
services=(ssh cron nginx)

check() {
  local name=$1
  if systemctl is-active --quiet "$name"; then
    echo "[OK]   $name is running"
  else
    echo "[FAIL] $name is not running"
  fi
}

for s in "\${services[@]}"; do
  check "$s"
done
`,
  "Backup script": `#!/bin/bash
# Back up a directory into /tmp with a dated archive name
src=\${1:-$HOME/documents}
dest="/tmp/backup-$(date +%F).tar.gz"

if [ ! -d "$src" ]; then
  echo "Error: $src is not a directory" >&2
  exit 1
fi

tar -czf "$dest" "$src" && echo "Backup written to $dest"
ls -lh "$dest"
`,
};

/** Bash editor that saves into the virtual machine and runs the script in the terminal. */
export function ScriptEditor({ onRun, target, onSaved }: { onRun: (command: string) => void; target?: ToolTarget; onSaved?: () => void }) {
  const [path, setPath] = useState("/home/student/myscript.sh");
  const [code, setCode] = useState(TEMPLATES["Hello world"]);
  const [args, setArgs] = useState("");
  const [executable, setExecutable] = useState(true);
  const [busy, setBusy] = useState(false);

  async function save(run: boolean) {
    setBusy(true);
    try {
      const r = await linuxAction<CommandResult>("files", { action: "write", path, content: code, executable }, target);
      if (r.exitCode !== 0) {
        toast.error(r.output || "Could not save the script");
        return;
      }
      toast.success(`Saved ${path}`);
      onSaved?.();
      if (run) onRun(executable ? `${path}${args ? " " + args : ""}` : `bash ${path}${args ? " " + args : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileCode2 className="size-4 text-primary" />
        <Input value={path} onChange={(e) => setPath(e.target.value)} className="h-8 max-w-xs font-mono text-xs" aria-label="Script path" />
        <NativeSelect className="h-8 w-44" defaultValue="" onChange={(e) => e.target.value && setCode(TEMPLATES[e.target.value])} aria-label="Template">
          <option value="" disabled>
            Load a template…
          </option>
          {Object.keys(TEMPLATES).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox checked={executable} onCheckedChange={(v) => setExecutable(!!v)} /> chmod +x
        </label>
      </div>
      <div className="h-80 overflow-hidden rounded-lg border">
        <MonacoEditor height="100%" theme="vs-dark" language="shell" value={code} onChange={(v) => setCode(v ?? "")} options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, tabSize: 2 }} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="arguments (optional)" className="h-8 max-w-xs font-mono text-xs" />
        <Button size="sm" variant="outline" onClick={() => save(false)} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />} Save
        </Button>
        <Button size="sm" onClick={() => save(true)} disabled={busy}>
          <Play /> Save &amp; run in terminal
        </Button>
      </div>
    </div>
  );
}
