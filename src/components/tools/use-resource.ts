"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";

export type ToolTarget = { kind: "playground" } | { kind: "challenge"; slug: string };

export function targetQuery(target: ToolTarget | undefined, extra: Record<string, string> = {}) {
  const q = new URLSearchParams(extra);
  if (target?.kind === "challenge") q.set("challenge", target.slug);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Load a /api/linux/<resource> view and reload it whenever `refreshKey` changes. */
export function useLinuxResource<T>(resource: string, refreshKey: number, target?: ToolTarget, extra: Record<string, string> = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const extraKey = JSON.stringify(extra);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<T>(`/api/linux/${resource}${targetQuery(target, JSON.parse(extraKey))}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [resource, target, extraKey]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  return { data, error, loading, reload: load };
}

export async function linuxAction<T = unknown>(resource: string, payload: unknown, target?: ToolTarget): Promise<T> {
  return api<T>(`/api/linux/${resource}${targetQuery(target)}`, { body: payload });
}
