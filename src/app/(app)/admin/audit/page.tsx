import { ScrollText } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Audit Log" };
const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  await requireUser(["ADMIN"]);
  const { action = "", page = "1" } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const where = action ? { action: { startsWith: action } } : {};
  const [logs, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p - 1) * PAGE, take: PAGE, include: { actor: { select: { name: true, email: true } } } }), prisma.auditLog.count({ where })]);
  return (
    <>
      <PageHeader icon={<ScrollText className="size-6 text-primary" />} title="Audit Log" description="Security-relevant actions: logins, account changes, content changes and environment resets." />
      <form className="mb-4 flex gap-2">
        <input name="action" defaultValue={action} placeholder="Filter by action prefix, e.g. auth." className="h-8 w-72 rounded-lg border bg-transparent px-2.5 text-sm" />
        <button className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Filter</button>
      </form>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              {["Time", "Actor", "Action", "Target", "IP", "Details"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t align-top">
                <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{formatDate(l.createdAt, true)}</td>
                <td className="px-4 py-2 text-xs">{l.actor ? `${l.actor.name}` : "—"}</td>
                <td className="px-4 py-2 font-mono text-xs text-primary">{l.action}</td>
                <td className="px-4 py-2 text-xs">{l.targetType ? `${l.targetType}:${l.targetId}` : ""}</td>
                <td className="px-4 py-2 font-mono text-xs">{l.ip ?? ""}</td>
                <td className="max-w-xs truncate px-4 py-2 font-mono text-xs text-muted-foreground">{l.metadata ? JSON.stringify(l.metadata) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-between text-sm">
        {p > 1 ? <Link href={`?action=${action}&page=${p - 1}`} className="text-primary">← Newer</Link> : <span />}
        {p * PAGE < total && (
          <Link href={`?action=${action}&page=${p + 1}`} className="text-primary">
            Older →
          </Link>
        )}
      </div>
    </>
  );
}
