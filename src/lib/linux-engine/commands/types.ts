import type { VirtualFileSystem } from "../filesystem";
import type { Shell, InputStream } from "../interpreter";
import type { Identity } from "../permissions";
import type { EnvState } from "../types";

export type CommandCategory =
  | "basics"
  | "files"
  | "text"
  | "permissions"
  | "users"
  | "processes"
  | "networking"
  | "packages"
  | "storage"
  | "scripting"
  | "security"
  | "system";

export interface CommandOption {
  flag: string;
  description: string;
}

export interface CommandExample {
  command: string;
  description: string;
}

export interface CommandContext {
  /** Name the command was invoked as (argv[0]). */
  name: string;
  args: string[];
  shell: Shell;
  state: EnvState;
  fs: VirtualFileSystem;
  /** Effective identity (root under sudo). */
  who: Identity;
  cwd: string;
  now: number;
  stdin: InputStream;
  stdoutIsTTY: boolean;
  out(text: string): void;
  err(text: string): void;
  /** Read all remaining stdin (empty when stdin is the terminal). */
  readAllStdin(): string;
  /** Read one line from stdin, or interactively from the terminal. Returns null on EOF. */
  readLine(prompt?: string, secret?: boolean): string | null;
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  category: CommandCategory;
  description: string;
  syntax: string;
  options?: CommandOption[];
  examples?: CommandExample[];
  /** Human readable permission requirement shown in the command reference. */
  permissions?: string;
  /** Shell builtin: no binary in PATH, runs inside the shell. */
  builtin?: boolean;
  /** Package that must be installed for the command to exist. */
  package?: string;
  /** Install directory of the binary (default /usr/bin). */
  binDir?: string;
  /** Hidden from the reference listing. */
  hidden?: boolean;
  run(ctx: CommandContext): number;
}
