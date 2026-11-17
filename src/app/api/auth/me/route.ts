import { route } from "@/server/http";

export const GET = route({}, async ({ user }) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  student: user.studentProfile ? { xp: user.studentProfile.xp, level: user.studentProfile.level, streak: user.studentProfile.currentStreak } : null,
}));
