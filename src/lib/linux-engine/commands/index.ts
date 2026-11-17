import { builtinCommands } from "./builtins";
import { fileCommands } from "./files";
import { networkCommands } from "./network";
import { packageCommands } from "./packages";
import { permissionCommands } from "./permissions";
import { processCommands } from "./processes";
import { storageCommands } from "./storage";
import { systemCommands } from "./system";
import { textCommands } from "./text";
import type { CommandDef } from "./types";
import { userCommands } from "./users";

export const ALL_COMMANDS: CommandDef[] = [
  ...builtinCommands,
  ...fileCommands,
  ...textCommands,
  ...permissionCommands,
  ...userCommands,
  ...processCommands,
  ...networkCommands,
  ...packageCommands,
  ...storageCommands,
  ...systemCommands,
];

/** Lookup by name and alias. */
export const COMMAND_REGISTRY: Map<string, CommandDef> = (() => {
  const map = new Map<string, CommandDef>();
  for (const def of ALL_COMMANDS) {
    if (map.has(def.name)) throw new Error(`duplicate command ${def.name}`);
    map.set(def.name, def);
  }
  for (const def of ALL_COMMANDS) {
    for (const alias of def.aliases ?? []) if (!map.has(alias)) map.set(alias, def);
  }
  return map;
})();

const SBIN = new Set(["useradd", "userdel", "usermod", "groupadd", "groupdel", "groupmod", "adduser", "addgroup", "deluser", "delgroup", "chpasswd", "mkfs.ext4", "mkfs", "fdisk", "blkid", "reboot", "shutdown", "poweroff", "halt", "service", "ufw", "ip"]);

/** Absolute binary paths for every non-builtin command name (incl. aliases). */
export function binaryPaths(): { name: string; path: string; def: CommandDef }[] {
  const out: { name: string; path: string; def: CommandDef }[] = [];
  for (const def of ALL_COMMANDS) {
    if (def.builtin) continue;
    for (const name of [def.name, ...(def.aliases ?? [])]) {
      const dir = def.binDir ?? (SBIN.has(name) ? "/usr/sbin" : "/usr/bin");
      out.push({ name, path: `${dir}/${name}`, def });
    }
  }
  // builtins that also exist as binaries
  for (const name of ["echo", "printf", "pwd", "test", "[", "true", "false", "kill"]) {
    const def = COMMAND_REGISTRY.get(name);
    if (def?.builtin) out.push({ name, path: `/usr/bin/${name}`, def });
  }
  return out;
}

export type { CommandDef };
