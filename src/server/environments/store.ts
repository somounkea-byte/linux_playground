import "server-only";
import type { EnvKind, Prisma } from "@/generated/prisma/client";
import { createDefaultState, ensureBinaries, LinuxEnvironment } from "@/lib/linux-engine";
import { buildChallengeState } from "@/lib/linux-engine/setup";
import type { EnvState } from "@/lib/linux-engine/types";
import { prisma } from "../db";
import { conflict, notFound } from "../http";
import { BIN_VERSION, diffRows, fromRows, toRows, type EnvMeta, type EnvRows } from "./serialize";

interface CacheEntry {
  version: number;
  rows: EnvRows;
  at: number;
}

const MAX_CACHE = 300;
const globalStore = globalThis as unknown as { envCache?: Map<string, CacheEntry>; envLocks?: Map<string, Promise<unknown>> };
const cache = (globalStore.envCache ??= new Map<string, CacheEntry>());
const locks = (globalStore.envLocks ??= new Map<string, Promise<unknown>>());

function remember(id: string, entry: CacheEntry) {
  cache.delete(id);
  cache.set(id, entry);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
}

/** Serialise operations on one environment within this process. */
async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  const chain = prev.then(() => next);
  locks.set(id, chain);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(id) === chain) locks.delete(id);
  }
}

async function loadRows(id: string): Promise<{ version: number; rows: EnvRows; ownerId: string }> {
  const env = await prisma.virtualEnvironment.findUnique({ where: { id }, select: { version: true, ownerId: true } });
  if (!env) throw notFound("Environment");
  const hit = cache.get(id);
  if (hit && hit.version === env.version) {
    hit.at = Date.now();
    return { version: env.version, rows: hit.rows, ownerId: env.ownerId };
  }
  const full = await prisma.virtualEnvironment.findUnique({
    where: { id },
    include: {
      files: true,
      users: true,
      groups: { include: { members: true } },
      packages: true,
      processes: true,
    },
  });
  if (!full) throw notFound("Environment");
  const rows: EnvRows = {
    meta: full.meta as unknown as EnvMeta,
    files: full.files.map(({ environmentId: _e, ...f }) => (void _e, f)),
    users: full.users.map(({ environmentId: _e, ...u }) => (void _e, u)),
    groups: full.groups.map((g) => ({ name: g.name, gid: g.gid, position: g.position })),
    members: full.groups.flatMap((g) => g.members.map((m) => ({ groupName: m.groupName, username: m.username, position: m.position }))),
    packages: full.packages.map(({ environmentId: _e, ...p }) => (void _e, p)),
    processes: full.processes.map(({ environmentId: _e, ...p }) => (void _e, p)),
  };
  remember(id, { version: full.version, rows, at: Date.now() });
  return { version: full.version, rows, ownerId: full.ownerId };
}

async function writeRows(tx: Prisma.TransactionClient, id: string, before: EnvRows | null, after: EnvRows) {
  const d = diffRows(before, after);
  if (d.empty) return;
  const ids = [...d.fileDeletes, ...(before ? d.fileUpserts.map((f) => f.id) : [])];
  if (ids.length) {
    for (let i = 0; i < ids.length; i += 1000) await tx.virtualFile.deleteMany({ where: { environmentId: id, id: { in: ids.slice(i, i + 1000) } } });
  }
  if (d.fileUpserts.length) {
    for (let i = 0; i < d.fileUpserts.length; i += 500) {
      await tx.virtualFile.createMany({ data: d.fileUpserts.slice(i, i + 500).map((f) => ({ ...f, environmentId: id })) });
    }
  }
  if (d.usersChanged) {
    if (before) await tx.virtualLinuxUser.deleteMany({ where: { environmentId: id } });
    await tx.virtualLinuxUser.createMany({ data: after.users.map((u) => ({ ...u, environmentId: id })) });
  }
  if (d.groupsChanged) {
    if (before) await tx.virtualLinuxGroup.deleteMany({ where: { environmentId: id } });
    await tx.virtualLinuxGroup.createMany({ data: after.groups.map((g) => ({ ...g, environmentId: id })) });
    if (after.members.length) await tx.virtualGroupMember.createMany({ data: after.members.map((m) => ({ ...m, environmentId: id })) });
  }
  if (d.packagesChanged) {
    if (before) await tx.installedPackage.deleteMany({ where: { environmentId: id } });
    await tx.installedPackage.createMany({ data: after.packages.map((p) => ({ ...p, environmentId: id })) });
  }
  if (d.processesChanged) {
    if (before) await tx.simulatedProcess.deleteMany({ where: { environmentId: id } });
    await tx.simulatedProcess.createMany({ data: after.processes.map((p) => ({ ...p, environmentId: id })) });
  }
}

export interface EnvHandle {
  id: string;
  env: LinuxEnvironment;
}

/**
 * Load an environment, run `fn` against it and persist any changes.
 * Operations on the same environment are serialised; concurrent writers in
 * other processes are detected with the optimistic `version` column.
 */
export async function withEnvironment<T>(id: string, fn: (env: LinuxEnvironment) => T | Promise<T>, opts: { persist?: boolean } = {}): Promise<T> {
  return withLock(id, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { version, rows } = await loadRows(id);
      const state = fromRows(structuredClone(rows));
      let migrated = false;
      if (rows.meta.binVersion !== BIN_VERSION) migrated = ensureBinaries(state) || true;
      const env = new LinuxEnvironment(state);
      const result = await fn(env);
      if (opts.persist === false) return result;
      const after = toRows(env.state);
      const d = diffRows(rows, after);
      if (d.empty && !migrated) return result;
      try {
        await prisma.$transaction(
          async (tx) => {
            const updated = await tx.virtualEnvironment.updateMany({
              where: { id, version },
              data: { version: { increment: 1 }, meta: after.meta as unknown as Prisma.InputJsonValue, hostname: env.state.hostname },
            });
            if (updated.count !== 1) throw conflict("Environment was modified concurrently.");
            await writeRows(tx, id, rows, after);
          },
          { timeout: 20000, maxWait: 10000 },
        );
        remember(id, { version: version + 1, rows: after, at: Date.now() });
        return result;
      } catch (e) {
        cache.delete(id);
        if (attempt < 2 && e instanceof Error && /modified concurrently/.test(e.message)) continue;
        throw e;
      }
    }
    throw conflict("Environment is busy. Please try again.");
  });
}

/** Create and persist a new environment from a state. */
export async function createEnvironment(ownerId: string, key: string, kind: EnvKind, state: EnvState, exerciseId?: string | null): Promise<string> {
  const rows = toRows(state);
  const env = await prisma.$transaction(
    async (tx) => {
      const created = await tx.virtualEnvironment.create({
        data: { ownerId, key, kind, exerciseId: exerciseId ?? null, hostname: state.hostname, meta: rows.meta as unknown as Prisma.InputJsonValue },
      });
      await writeRows(tx, created.id, null, rows);
      return created;
    },
    { timeout: 30000, maxWait: 10000 },
  );
  remember(env.id, { version: env.version, rows, at: Date.now() });
  return env.id;
}

export async function deleteEnvironment(id: string) {
  cache.delete(id);
  await prisma.virtualEnvironment.delete({ where: { id } });
}

export function playgroundState(fullName?: string) {
  return createDefaultState({ username: "student", password: "student", fullName });
}

/** Find (or create) a user's personal playground environment. */
export async function getPlaygroundId(userId: string, fullName?: string): Promise<string> {
  const existing = await prisma.virtualEnvironment.findUnique({ where: { ownerId_key: { ownerId: userId, key: "playground" } }, select: { id: true } });
  if (existing) return existing.id;
  try {
    return await createEnvironment(userId, "playground", "PLAYGROUND", playgroundState(fullName));
  } catch (e) {
    // concurrent creation: return the winner
    const again = await prisma.virtualEnvironment.findUnique({ where: { ownerId_key: { ownerId: userId, key: "playground" } }, select: { id: true } });
    if (again) return again.id;
    throw e;
  }
}

/** Replace a playground with a fresh Ubuntu environment. */
export async function resetPlayground(userId: string, fullName?: string): Promise<string> {
  const existing = await prisma.virtualEnvironment.findUnique({ where: { ownerId_key: { ownerId: userId, key: "playground" } }, select: { id: true } });
  if (existing) {
    await withLock(existing.id, async () => {
      await deleteEnvironment(existing.id);
    });
  }
  return createEnvironment(userId, "playground", "PLAYGROUND", playgroundState(fullName));
}

/** Build the starting state of a challenge by running its setup script as root. */
export function challengeState(setupScript: string, fullName?: string): EnvState {
  return buildChallengeState(setupScript, { fullName });
}

export async function getChallengeEnvId(userId: string, exercise: { id: string; setupScript: string }, fullName?: string, reset = false): Promise<string> {
  const key = `challenge:${exercise.id}`;
  const existing = await prisma.virtualEnvironment.findUnique({ where: { ownerId_key: { ownerId: userId, key } }, select: { id: true } });
  if (existing && !reset) return existing.id;
  if (existing) await withLock(existing.id, () => deleteEnvironment(existing.id));
  return createEnvironment(userId, key, "CHALLENGE", challengeState(exercise.setupScript, fullName), exercise.id);
}

/** Read-only snapshot of an environment state (no persistence). */
export async function readEnvironment(id: string): Promise<EnvState> {
  return withEnvironment(id, (env) => env.state, { persist: false });
}

export async function assertEnvOwner(id: string, userId: string) {
  const env = await prisma.virtualEnvironment.findUnique({ where: { id }, select: { ownerId: true } });
  if (!env || env.ownerId !== userId) throw notFound("Environment");
}
