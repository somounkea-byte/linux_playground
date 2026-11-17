import { Settings } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { SettingsForm } from "@/components/app/settings-form";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const teacher = user.studentProfile?.teacherId ? await prisma.teacherProfile.findUnique({ where: { id: user.studentProfile.teacherId }, include: { user: { select: { name: true } } } }) : null;
  return (
    <>
      <PageHeader icon={<Settings className="size-6 text-primary" />} title="Settings" description="Your profile, class, terminal and environment." />
      <SettingsForm
        user={{ name: user.name, email: user.email, role: user.role }}
        isStudent={!!user.studentProfile}
        teacherName={teacher?.user.name ?? null}
        inviteCode={user.teacherProfile?.inviteCode ?? null}
      />
    </>
  );
}
