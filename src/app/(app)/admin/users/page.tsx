import { UserCog } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { CreateUserButton, UserRowActions } from "@/components/admin/user-admin";
import { timeAgo } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "User Management" };
const PAGE = 25;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; page?: string }> }) {
  const me = await requireUser(["ADMIN"]);
  const { q = "", role = "", page = "1" } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const where = {
    ...(["STUDENT", "TEACHER", "ADMIN"].includes(role) ? { role: role as "STUDENT" } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const [users, total, teachers] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p - 1) * PAGE, take: PAGE, include: { studentProfile: { select: { teacherId: true, xp: true } } } }),
    prisma.user.count({ where }),
    prisma.teacherProfile.findMany({ include: { user: { select: { name: true } } } }),
  ]);
  const teacherOptions = teachers.map((t) => ({ id: t.id, name: t.user.name }));
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <>
      <PageHeader
        icon={<UserCog className="size-6 text-primary" />}
        title="User Management"
        description={`${total} users. Change roles, assign students to teachers, disable accounts or revoke sessions.`}
        actions={<CreateUserButton teachers={teacherOptions} />}
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search name or email" className="h-8 rounded-lg border bg-transparent px-2.5 text-sm" />
        <select name="role" defaultValue={role} className="h-8 rounded-lg border bg-transparent px-2 text-sm">
          <option value="">All roles</option>
          <option value="STUDENT">Students</option>
          <option value="TEACHER">Teachers</option>
          <option value="ADMIN">Admins</option>
        </select>
        <button className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Filter</button>
      </form>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              {["User", "Role", "Teacher", "Status", "Last login", ""].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-4 py-3">
                  <span className="font-medium">{u.name}</span>
                  <span className="block text-xs text-muted-foreground">{u.email}</span>
                </td>
                <td className="px-4 py-3 text-xs">{u.role.toLowerCase()}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{u.studentProfile ? (teacherOptions.find((t) => t.id === u.studentProfile!.teacherId)?.name ?? "—") : ""}</td>
                <td className={`px-4 py-3 text-xs ${u.isActive ? "text-success" : "text-destructive"}`}>{u.isActive ? "active" : "disabled"}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}</td>
                <td className="px-4 py-3 text-right">
                  <UserRowActions user={{ id: u.id, name: u.name, role: u.role, isActive: u.isActive, teacherId: u.studentProfile?.teacherId ?? null }} teachers={teacherOptions} isSelf={u.id === me.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <Link key={n} href={`?q=${encodeURIComponent(q)}&role=${role}&page=${n}`} className={`rounded-md border px-2.5 py-1 ${n === p ? "border-primary bg-primary/10" : ""}`}>
              {n}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
