import { z } from "zod";
import { withEnvironment } from "@/server/environments/store";
import { badRequest, body, notFound, route } from "@/server/http";
import { targetFromQuery } from "@/server/schemas";
import {
  applyGroupAction,
  applyUserAction,
  fileActionCommand,
  fileActionSchema,
  groupActionSchema,
  listDirectory,
  listPackages,
  listProcesses,
  listUsersAndGroups,
  runGuiCommand,
  systemInfo,
  userActionSchema,
} from "@/server/services/linux-tools";
import { resolveEnvId } from "@/server/services/terminal";

/**
 * Graphical system administration tools. They read and modify the SAME
 * virtual machine as the terminal, so both views always agree.
 */
export const GET = route<{ resource: string }>({}, async ({ req, user, params }) => {
  const { envId } = await resolveEnvId(user, targetFromQuery(req.nextUrl.searchParams));
  return withEnvironment(
    envId,
    (env) => {
      switch (params.resource) {
        case "users":
          return listUsersAndGroups(env);
        case "files":
          return listDirectory(env, req.nextUrl.searchParams.get("path") || "/home/student");
        case "processes":
          return listProcesses(env);
        case "packages":
          return listPackages(env);
        case "system":
          return systemInfo(env);
        default:
          throw notFound("Resource");
      }
    },
    { persist: false },
  );
});

const killSchema = z.object({ action: z.literal("kill"), pid: z.number().int().positive(), signal: z.enum(["TERM", "KILL", "STOP", "CONT", "HUP"]).default("TERM"), sudo: z.boolean().default(false) });
const pkgSchema = z.object({ action: z.enum(["install", "remove", "purge", "update", "upgrade"]), name: z.string().regex(/^[a-z0-9][a-z0-9+.-]*$/).max(60).optional() });
const svcSchema = z.object({ action: z.enum(["start", "stop", "restart", "enable", "disable"]), name: z.string().regex(/^[a-z0-9-]+$/).max(60) });

export const POST = route<{ resource: string }>({ rateLimit: { bucket: "linux-tools", limit: 120 } }, async ({ req, user, params }) => {
  const { envId } = await resolveEnvId(user, targetFromQuery(req.nextUrl.searchParams));
  switch (params.resource) {
    case "users": {
      const a = await body(req, userActionSchema);
      await withEnvironment(envId, (env) => applyUserAction(env, a));
      return { ok: true };
    }
    case "groups": {
      const a = await body(req, groupActionSchema);
      await withEnvironment(envId, (env) => applyGroupAction(env, a));
      return { ok: true };
    }
    case "files": {
      const a = await body(req, fileActionSchema);
      const cmd = fileActionCommand(a);
      return withEnvironment(envId, (env) => runGuiCommand(env, cmd, a.sudo));
    }
    case "processes": {
      const a = await body(req, killSchema);
      return withEnvironment(envId, (env) => runGuiCommand(env, `kill -${a.signal} ${a.pid}`, a.sudo));
    }
    case "packages": {
      const a = await body(req, pkgSchema);
      if ((a.action === "install" || a.action === "remove" || a.action === "purge") && !a.name) throw badRequest("Package name required");
      const cmd = a.action === "update" ? "apt update" : a.action === "upgrade" ? "apt upgrade -y" : `apt ${a.action} -y ${a.name}`;
      return withEnvironment(envId, (env) => runGuiCommand(env, cmd, true));
    }
    case "services": {
      const a = await body(req, svcSchema);
      return withEnvironment(envId, (env) => runGuiCommand(env, `systemctl ${a.action} ${a.name}`, true));
    }
    default:
      throw notFound("Resource");
  }
});
