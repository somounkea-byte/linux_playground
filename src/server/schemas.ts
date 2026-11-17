import { z } from "zod";

export const targetSchema = z
  .union([z.object({ kind: z.literal("playground") }), z.object({ kind: z.literal("challenge"), slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/) })])
  .default({ kind: "playground" });

/** `?challenge=slug` query string → environment target. */
export function targetFromQuery(searchParams: URLSearchParams) {
  const slug = searchParams.get("challenge");
  return slug ? ({ kind: "challenge", slug } as const) : ({ kind: "playground" } as const);
}
