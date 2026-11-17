"use client";

import { FileCode2, Loader2, Lock, Save } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import type { EnvTarget } from "./terminal";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">
      <Loader2 className="animate-spin" />
    </div>
  ),
});

export interface EditRequest {
  path: string;
  editor: string;
  readOnly: boolean;
  user: string;
}

export function languageFor(path: string, content = ""): string {
  if (/\.(sh|bash)$/.test(path) || content.startsWith("#!/bin/bash") || content.startsWith("#!/bin/sh") || /\.bashrc$|\.profile$/.test(path)) return "shell";
  if (/\.(conf|cfg|ini)$|sshd_config$/.test(path)) return "ini";
  if (/\.json$/.test(path)) return "json";
  if (/\.(ya?ml)$/.test(path)) return "yaml";
  if (/\.html?$/.test(path)) return "html";
  if (/\.py$/.test(path)) return "python";
  if (/\.md$/.test(path)) return "markdown";
  return "plaintext";
}

/** nano / vim replacement: a Monaco editor that saves through the permission-checked API. */
export function EditorDialog({ request, target, onClose }: { request: EditRequest | null; target: EnvTarget; onClose: (saved: boolean) => void }) {
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exists, setExists] = useState(true);
  const [savedOnce, setSavedOnce] = useState(false);

  useEffect(() => {
    if (!request) return;
    setLoading(true);
    setSavedOnce(false);
    const q = new URLSearchParams({ path: request.path });
    if (target.kind === "challenge") q.set("challenge", target.slug);
    api<{ content: string; exists: boolean }>(`/api/files?${q}`)
      .then((r) => {
        setContent(r.content);
        setOriginal(r.content);
        setExists(r.exists);
      })
      .catch((e) => {
        toast.error(e.message);
        onClose(false);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.path]);

  async function save() {
    if (!request) return;
    setSaving(true);
    try {
      const r = await api<{ lines: number }>("/api/files", { method: "PUT", body: { target, path: request.path, content } });
      setOriginal(content);
      setExists(true);
      setSavedOnce(true);
      toast.success(`[ Wrote ${r.lines} line${r.lines === 1 ? "" : "s"} ]`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const dirty = content !== original;
  return (
    <Dialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open) {
          if (dirty && !window.confirm("Discard unsaved changes?")) return;
          onClose(savedOnce);
        }
      }}
    >
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-3 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-base">
            <FileCode2 className="size-4 text-primary" />
            {request?.editor ?? "nano"} — {request?.path}
            {dirty && <span className="text-xs font-normal text-warning">(modified)</span>}
          </DialogTitle>
          <DialogDescription>
            {request?.readOnly ? (
              <span className="flex items-center gap-1.5 text-warning">
                <Lock className="size-3.5" /> Read-only: {request.user} does not have write permission for this file.
              </span>
            ) : (
              <>
                Editing as <b>{request?.user}</b>
                {!exists && " · new file"}. Press <kbd className="rounded border px-1 font-mono text-[0.7rem]">Ctrl+S</kbd> to save.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div
          className="min-h-0 flex-1 overflow-hidden rounded-lg border"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              if (!request?.readOnly) void save();
            }
          }}
        >
          {loading ? (
            <div className="grid h-full place-items-center">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : (
            <MonacoEditor
              height="100%"
              theme="vs-dark"
              language={languageFor(request?.path ?? "", content)}
              value={content}
              onChange={(v) => setContent(v ?? "")}
              options={{ readOnly: request?.readOnly, minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 4 }}
            />
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (dirty && !window.confirm("Discard unsaved changes?")) return;
              onClose(savedOnce);
            }}
          >
            Exit
          </Button>
          {!request?.readOnly && (
            <Button onClick={save} disabled={saving || (!dirty && exists)}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
