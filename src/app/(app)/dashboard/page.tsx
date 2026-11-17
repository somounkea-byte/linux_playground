import { redirect } from "next/navigation";
import { requireUser, homeFor } from "@/server/auth/session";
import { StudentDashboard } from "./student-dashboard";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  if (!user.studentProfile) redirect(homeFor(user.role));
  return <StudentDashboard user={user} />;
}
