import { SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { SystemSettingsForm } from "@/components/admin/system-settings";
import { requireUser } from "@/server/auth/session";
import { config, localAuthEnabled } from "@/server/config";
import { getSettings } from "@/server/services/settings";

export const metadata = { title: "System Settings" };

export default async function AdminSettingsPage() {
  await requireUser(["ADMIN"]);
  const settings = await getSettings();
  const c = config();
  return (
    <>
      <PageHeader icon={<SlidersHorizontal className="size-6 text-primary" />} title="System Settings" />
      <SystemSettingsForm
        initial={settings}
        env={{ authProvider: c.AUTH_PROVIDER, localAuth: localAuthEnabled(), redis: !!c.REDIS_URL, nodeEnv: c.NODE_ENV, appUrl: c.APP_URL, terminalRate: c.RATE_LIMIT_TERMINAL_PER_MIN, adminEmails: c.ADMIN_EMAILS }}
      />
    </>
  );
}
