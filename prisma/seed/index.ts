/**
 * Idempotent seed: learning content, challenges, quizzes, badges, command
 * reference and (optionally) demo accounts for development.
 *
 *   npm run db:seed              # content + demo users
 *   SEED_DEMO=false npm run db:seed   # content only (production)
 */
import "dotenv/config";
import { randomBytes, scrypt } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../src/generated/prisma/client";
import { ALL_COMMANDS, createDefaultState } from "../../src/lib/linux-engine";
import { levelFromXp } from "../../src/lib/gamification";
import { toRows } from "../../src/server/environments/serialize";
import { badges } from "./badges";
import { challenges } from "./challenges";
import { modulesPart1 } from "./modules-1";
import { modulesPart2 } from "./modules-2";
import { modulesPart3 } from "./modules-3";
import { quizzes } from "./quizzes";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const modules = [...modulesPart1, ...modulesPart2, ...modulesPart3];

function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(`scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`))),
  );
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

async function seedContent() {
  for (const [i, b] of badges.entries()) {
    await prisma.badge.upsert({ where: { slug: b.slug }, update: { ...b, criteria: json(b.criteria), order: i }, create: { ...b, criteria: json(b.criteria), order: i } });
  }
  console.log(`✔ ${badges.length} badges`);

  let lessonCount = 0;
  for (const [i, m] of modules.entries()) {
    const mod = await prisma.learningModule.upsert({
      where: { slug: m.slug },
      update: { title: m.title, description: m.description, icon: m.icon, order: i + 1 },
      create: { slug: m.slug, title: m.title, description: m.description, icon: m.icon, order: i + 1 },
    });
    for (const [j, l] of m.lessons.entries()) {
      const data = { title: l.title, summary: l.summary, content: l.content, practice: json(l.practice), checks: json(l.checks ?? []), order: j + 1, estimatedMinutes: l.minutes };
      await prisma.lesson.upsert({ where: { moduleId_slug: { moduleId: mod.id, slug: l.slug } }, update: data, create: { ...data, slug: l.slug, moduleId: mod.id } });
      lessonCount++;
    }
  }
  console.log(`✔ ${modules.length} modules, ${lessonCount} lessons`);

  const cmds = ALL_COMMANDS.filter((c) => !c.hidden);
  for (const c of cmds) {
    const data = { category: c.category, description: c.description, syntax: c.syntax, options: json(c.options ?? []), examples: json(c.examples ?? []), permissions: c.permissions ?? null, package: c.package ?? null };
    await prisma.commandReference.upsert({ where: { name: c.name }, update: data, create: { name: c.name, ...data } });
  }
  console.log(`✔ ${cmds.length} command reference entries`);

  for (const c of challenges) {
    const data = {
      kind: "CHALLENGE" as const,
      title: c.title,
      difficulty: c.difficulty,
      category: c.category,
      summary: c.summary,
      scenario: c.scenario,
      objectives: c.objectives,
      instructions: c.instructions,
      setupScript: c.setupScript,
      xpReward: c.xpReward,
      hints: c.hints,
      solution: c.solution,
    };
    const ex = await prisma.exercise.upsert({ where: { slug: c.slug }, update: data, create: { slug: c.slug, ...data } });
    await prisma.exerciseTask.deleteMany({ where: { exerciseId: ex.id } });
    await prisma.exerciseTask.createMany({
      data: c.tasks.map((t, i) => {
        const { description, hint, points, ...check } = t;
        return { exerciseId: ex.id, order: i + 1, description, hint: hint ?? null, points: points ?? 1, check: json(check) };
      }),
    });
  }
  console.log(`✔ ${challenges.length} challenges`);

  for (const q of quizzes) {
    const mod = await prisma.learningModule.findUnique({ where: { slug: q.module } });
    const data = { title: q.title, description: q.description, moduleId: mod?.id ?? null, timeLimitSec: q.timeLimitSec ?? null, questionsPerAttempt: q.questionsPerAttempt ?? null };
    const quiz = await prisma.quiz.upsert({ where: { slug: q.slug }, update: data, create: { slug: q.slug, ...data } });
    const attempts = await prisma.quizAttempt.count({ where: { quizId: quiz.id } });
    if (attempts === 0 || !(await prisma.quizQuestion.count({ where: { quizId: quiz.id } }))) {
      await prisma.quizQuestion.deleteMany({ where: { quizId: quiz.id } });
      await prisma.quizQuestion.createMany({
        data: q.questions.map((qq, i) => ({ quizId: quiz.id, type: qq.type, prompt: qq.prompt, options: json(qq.options), answer: json(qq.answer), explanation: qq.explanation ?? null, points: qq.points ?? 1, order: i + 1 })),
      });
    }
  }
  console.log(`✔ ${quizzes.length} quizzes`);

  const settings: Record<string, unknown> = { registrationOpen: true, maintenanceMessage: "", maxCommandsPerMinute: 240, defaultTerminalFontSize: 14 };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.systemSetting.upsert({ where: { key }, update: {}, create: { key, value: json(value) } });
  }
}

async function createPlayground(ownerId: string, fullName: string) {
  const existing = await prisma.virtualEnvironment.findUnique({ where: { ownerId_key: { ownerId, key: "playground" } } });
  if (existing) return;
  const rows = toRows(createDefaultState({ fullName }));
  const env = await prisma.virtualEnvironment.create({ data: { ownerId, key: "playground", kind: "PLAYGROUND", meta: json(rows.meta), hostname: rows.meta.hostname } });
  const id = env.id;
  await prisma.virtualFile.createMany({ data: rows.files.map((f) => ({ ...f, environmentId: id })) });
  await prisma.virtualLinuxUser.createMany({ data: rows.users.map((u) => ({ ...u, environmentId: id })) });
  await prisma.virtualLinuxGroup.createMany({ data: rows.groups.map((g) => ({ ...g, environmentId: id })) });
  await prisma.virtualGroupMember.createMany({ data: rows.members.map((m) => ({ ...m, environmentId: id })) });
  await prisma.installedPackage.createMany({ data: rows.packages.map((p) => ({ ...p, environmentId: id })) });
  await prisma.simulatedProcess.createMany({ data: rows.processes.map((p) => ({ ...p, environmentId: id })) });
}

const DAY = 86400000;

async function seedDemo() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@linuxplayground.dev" },
    update: {},
    create: { email: "admin@linuxplayground.dev", name: "Ada Admin", role: "ADMIN", passwordHash: await hashPassword("Admin123!") },
  });
  const teacherUser = await prisma.user.upsert({
    where: { email: "teacher@linuxplayground.dev" },
    update: {},
    create: { email: "teacher@linuxplayground.dev", name: "Tom Teacher", role: "TEACHER", passwordHash: await hashPassword("Teacher123!") },
  });
  const teacher = await prisma.teacherProfile.upsert({ where: { userId: teacherUser.id }, update: {}, create: { userId: teacherUser.id, inviteCode: "LINUX101", department: "IT Department" } });

  const students = [
    { email: "student@linuxplayground.dev", name: "Sam Student", password: "Student123!", lessons: 8, challenges: 2, quizzes: 1, streak: 3, daysAgo: 0 },
    { email: "lina@linuxplayground.dev", name: "Lina Chen", password: "Student123!", lessons: 22, challenges: 6, quizzes: 4, streak: 9, daysAgo: 0 },
    { email: "marco@linuxplayground.dev", name: "Marco Rossi", password: "Student123!", lessons: 14, challenges: 3, quizzes: 2, streak: 2, daysAgo: 1 },
    { email: "aisha@linuxplayground.dev", name: "Aisha Bello", password: "Student123!", lessons: 31, challenges: 9, quizzes: 6, streak: 14, daysAgo: 0 },
    { email: "kenji@linuxplayground.dev", name: "Kenji Sato", password: "Student123!", lessons: 3, challenges: 0, quizzes: 0, streak: 0, daysAgo: 12 },
    { email: "sofia@linuxplayground.dev", name: "Sofia Garcia", password: "Student123!", lessons: 1, challenges: 0, quizzes: 1, streak: 0, daysAgo: 20 },
  ];
  const lessons = await prisma.lesson.findMany({ orderBy: [{ module: { order: "asc" } }, { order: "asc" }], include: { module: true } });
  const exercises = await prisma.exercise.findMany({ orderBy: [{ difficulty: "asc" }, { createdAt: "asc" }] });
  const quizList = await prisma.quiz.findMany({ include: { questions: true }, orderBy: { createdAt: "asc" } });
  const allBadges = await prisma.badge.findMany();
  const now = Date.now();

  for (const s of students) {
    const user = await prisma.user.upsert({ where: { email: s.email }, update: {}, create: { email: s.email, name: s.name, role: "STUDENT", passwordHash: await hashPassword(s.password), lastLoginAt: new Date(now - s.daysAgo * DAY) } });
    const existing = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
    if (existing) continue;
    const profile = await prisma.studentProfile.create({ data: { userId: user.id, teacherId: teacher.id } });
    await createPlayground(user.id, s.name);

    let xp = 0;
    const tx: Prisma.StudentXPTransactionCreateManyInput[] = [];
    const acts: Prisma.StudentActivityCreateManyInput[] = [];
    const when = (i: number, total: number) => new Date(now - s.daysAgo * DAY - Math.max(0, total - i) * (DAY / 2) - 3600_000 * (i % 5));
    for (const [i, l] of lessons.slice(0, s.lessons).entries()) {
      const at = when(i, s.lessons);
      await prisma.studentProgress.create({ data: { studentId: profile.id, lessonId: l.id, status: "COMPLETED", startedAt: at, completedAt: at } });
      tx.push({ studentId: profile.id, amount: l.xpReward, reason: `Lesson: ${l.title}`, sourceType: "lesson", sourceId: l.id, createdAt: at });
      acts.push({ studentId: profile.id, type: "LESSON_COMPLETED", title: `Completed lesson "${l.title}"`, createdAt: at, metadata: { module: l.module.slug } });
      xp += l.xpReward;
    }
    for (const [i, e] of exercises.slice(0, s.challenges).entries()) {
      const at = when(i * 3, s.challenges * 3);
      const total = await prisma.exerciseTask.count({ where: { exerciseId: e.id } });
      await prisma.exerciseSubmission.create({ data: { exerciseId: e.id, studentId: profile.id, status: "PASSED", score: 100, passedTasks: total, totalTasks: total, attempts: 1 + (i % 3), startedAt: at, completedAt: at, lastCheckedAt: at } });
      tx.push({ studentId: profile.id, amount: e.xpReward, reason: `Challenge: ${e.title}`, sourceType: "challenge", sourceId: e.id, createdAt: at });
      acts.push({ studentId: profile.id, type: "CHALLENGE_PASSED", title: `Solved "${e.title}"`, createdAt: at });
      xp += e.xpReward;
    }
    if (s.challenges < exercises.length && s.lessons > 5) {
      const e = exercises[s.challenges];
      const total = await prisma.exerciseTask.count({ where: { exerciseId: e.id } });
      await prisma.exerciseSubmission.create({ data: { exerciseId: e.id, studentId: profile.id, status: "FAILED", score: 40, passedTasks: Math.floor(total * 0.4), totalTasks: total, attempts: 2, startedAt: new Date(now - DAY), lastCheckedAt: new Date(now - DAY) } });
    }
    for (const [i, q] of quizList.slice(0, s.quizzes).entries()) {
      const at = when(i * 4, s.quizzes * 4);
      const score = [95, 80, 72, 88, 100, 65][i % 6];
      const totalPoints = q.questions.reduce((a, b) => a + b.points, 0);
      await prisma.quizAttempt.create({ data: { quizId: q.id, studentId: profile.id, questionIds: q.questions.map((x) => x.id), totalPoints, earnedPoints: Math.round((totalPoints * score) / 100), score, passed: score >= q.passingScore, startedAt: at, submittedAt: at, answers: {}, results: [] } });
      if (score >= q.passingScore) {
        tx.push({ studentId: profile.id, amount: q.xpReward, reason: `Quiz: ${q.title}`, sourceType: "quiz", sourceId: q.id, createdAt: at });
        xp += q.xpReward;
      }
      acts.push({ studentId: profile.id, type: "QUIZ_COMPLETED", title: `Scored ${score}% on "${q.title}"`, createdAt: at });
    }
    for (let d = 0; d < s.streak; d++) {
      const day = new Date(now - (s.daysAgo + d) * DAY).toISOString().slice(0, 10);
      tx.push({ studentId: profile.id, amount: 10, reason: "Daily learning activity", sourceType: "daily", sourceId: day, createdAt: new Date(day) });
      xp += 10;
    }
    if (tx.length) await prisma.studentXPTransaction.createMany({ data: tx, skipDuplicates: true });
    if (acts.length) await prisma.studentActivity.createMany({ data: acts });
    const earned = allBadges.filter((b) => {
      const c = b.criteria as { type: string; count?: number; days?: number };
      if (c.type === "lessons_completed") return s.lessons >= (c.count ?? 1);
      if (c.type === "challenges_passed") return s.challenges >= (c.count ?? 1) && !("difficulty" in c);
      if (c.type === "quizzes_passed") return s.quizzes >= (c.count ?? 1);
      if (c.type === "streak") return s.streak >= (c.days ?? 99);
      return false;
    });
    for (const b of earned) await prisma.studentBadge.create({ data: { studentId: profile.id, badgeId: b.id, earnedAt: new Date(now - s.daysAgo * DAY) } });
    const commands = ["ls", "cd", "pwd", "cat", "mkdir", "touch", "echo", "cp", "mv", "rm", "chmod", "grep", "sudo", "useradd", "ps", "id", "find", "head", "tail", "apt"].slice(0, Math.min(20, 4 + s.lessons));
    await prisma.studentProfile.update({
      where: { id: profile.id },
      data: {
        xp,
        level: levelFromXp(xp),
        currentStreak: s.streak,
        longestStreak: Math.max(s.streak, 2),
        lastActiveDate: s.streak ? new Date(new Date(now - s.daysAgo * DAY).toISOString().slice(0, 10)) : null,
        commandsRun: s.lessons * 12 + s.challenges * 20,
        distinctCommands: commands,
      },
    });
  }

  // an assignment from the teacher
  const sharedFolder = exercises.find((e) => e.slug === "shared-project-folder");
  if (sharedFolder && !(await prisma.assignment.findFirst({ where: { teacherId: teacher.id, exerciseId: sharedFolder.id } }))) {
    const studentsOfTeacher = await prisma.studentProfile.findMany({ where: { teacherId: teacher.id } });
    await prisma.assignment.create({
      data: {
        exerciseId: sharedFolder.id,
        teacherId: teacher.id,
        title: "Week 3 lab: shared project folder",
        instructions: "Complete the challenge before Friday's class. We will discuss group permissions.",
        dueAt: new Date(now + 5 * DAY),
        students: { create: studentsOfTeacher.map((s) => ({ studentId: s.id })) },
      },
    });
  }
  console.log(`✔ demo accounts: admin@linuxplayground.dev / Admin123!, teacher@linuxplayground.dev / Teacher123!, student@linuxplayground.dev / Student123!`);
  void admin;
}

async function main() {
  await seedContent();
  if (process.env.SEED_DEMO !== "false") await seedDemo();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
