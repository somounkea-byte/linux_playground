import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { requireUser } from "@/server/auth/session";
import { getSettings } from "@/server/services/settings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await getSettings();
  return (
    <div className="flex min-h-screen">
      <Sidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={{ name: user.name, email: user.email, role: user.role, xp: user.studentProfile?.xp, level: user.studentProfile?.level }} />
        {settings.maintenanceMessage && <div className="border-b border-warning/30 bg-warning/10 px-6 py-2 text-center text-sm">{settings.maintenanceMessage}</div>}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
