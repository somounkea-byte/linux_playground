"use client";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Small JSON fetch wrapper for the app's REST API. */
export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    credentials: "same-origin",
  });
  let payload: { ok: boolean; data?: T; error?: { code: string; message: string; details?: unknown } } | null = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok || !payload?.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) {
      window.location.href = "/login";
    }
    throw new ApiClientError(payload?.error?.message ?? `Request failed (${res.status})`, res.status, payload?.error?.code ?? "ERROR", payload?.error?.details);
  }
  return payload.data as T;
}
