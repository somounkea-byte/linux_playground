/**
 * Core types for the Linux Playground simulation engine.
 *
 * The whole virtual machine is represented by a single serialisable
 * `EnvState` object. Commands mutate it in place; the persistence layer
 * diffs it against the previous snapshot and writes changes to PostgreSQL.
 */

export type NodeType = "file" | "dir" | "symlink" | "chardev" | "blockdev";

export interface FsNode {
  id: string;
  parentId: string | null;
  name: string;
  type: NodeType;
  /** File content (UTF-8 text). Empty for directories. */
  content: string;
  /** Symlink target (raw, may be relative). */
  target?: string;
  uid: number;
  gid: number;
  /** Permission bits including setuid/setgid/sticky (0o7777). */
  mode: number;
  /** Optional fake size (e.g. simulated binaries). */
  size?: number;
  ctime: number;
  mtime: number;
}

export interface LinuxUser {
  username: string;
  uid: number;
  gid: number;
  gecos: string;
  home: string;
  shell: string;
  /** Hashed password, `!` (locked / no password) or `*` (no login). Never plain text. */
  passwordHash: string;
  /** Days since epoch of the last password change. */
  lastChange: number;
  locked: boolean;
}

export interface LinuxGroup {
  name: string;
  gid: number;
  members: string[];
}

export type ProcState = "R" | "S" | "D" | "T" | "Z" | "I";

export interface SimProcess {
  pid: number;
  ppid: number;
  user: string;
  /** Executable name (comm). */
  command: string;
  /** Full command line. */
  args: string;
  state: ProcState;
  nice: number;
  startedAt: number;
  /** For background jobs such as `sleep 30 &` — when the process finishes. */
  endsAt?: number | null;
  tty: string;
  cpu: number;
  mem: number;
  vsz: number;
  rss: number;
  service?: string;
  kernel?: boolean;
}

export interface Job {
  id: number;
  pid: number;
  command: string;
  state: "Running" | "Stopped" | "Done";
}

export interface ServiceState {
  name: string;
  enabled: boolean;
  active: boolean;
  since: number;
}

export interface Disk {
  name: string;
  type: "disk" | "part";
  size: number;
  parent?: string;
  fstype?: string;
  uuid?: string;
  mountpoint?: string;
  label?: string;
  model?: string;
  /** Simulated used bytes (excluding files tracked in the VFS). */
  baseUsed?: number;
}

export interface FirewallRule {
  action: "allow" | "deny" | "reject" | "limit";
  port: string;
  proto?: "tcp" | "udp";
  from: string;
}

export interface LogEntry {
  ts: number;
  source: string;
  message: string;
  file: "auth" | "syslog";
  unit?: string;
}

export interface LoginRecord {
  user: string;
  tty: string;
  from: string;
  loginAt: number;
  logoutAt?: number | null;
}

export interface NetInterface {
  name: string;
  mac: string;
  ipv4: string;
  prefix: number;
  ipv6: string;
  mtu: number;
  up: boolean;
}

export interface ShellFrame {
  user: string;
  cwd: string;
  oldpwd?: string;
  login: boolean;
}

export interface SessionState {
  userStack: ShellFrame[];
  vars: Record<string, string>;
  exported: string[];
  arrays: Record<string, string[]>;
  aliases: Record<string, string>;
  functions: Record<string, unknown>;
  history: string[];
  lastExit: number;
  sudoTimestamps: Record<string, number>;
  jobs: Job[];
  umask: number;
  /** Files the user opened with nano/vim; the editor API may only save these. */
  editGrants?: EditGrant[];
}

export interface EditGrant {
  path: string;
  user: string;
  expires: number;
  readOnly: boolean;
}

export interface InstalledPackageInfo {
  version: string;
  installedAt: number;
  auto: boolean;
}

export interface EnvState {
  schemaVersion: 1;
  hostname: string;
  createdAt: number;
  bootTime: number;
  rootId: string;
  nodes: Record<string, FsNode>;
  users: LinuxUser[];
  groups: LinuxGroup[];
  processes: SimProcess[];
  nextPid: number;
  packages: {
    installed: Record<string, InstalledPackageInfo>;
    lastUpdate: number | null;
  };
  services: Record<string, ServiceState>;
  disks: Disk[];
  firewall: {
    enabled: boolean;
    rules: FirewallRule[];
  };
  logs: LogEntry[];
  logins: LoginRecord[];
  network: {
    interfaces: NetInterface[];
    gateway: string;
    dns: string[];
  };
  session: SessionState;
}

/** An interactive prompt the client must collect before re-running. */
export interface InputPrompt {
  prompt: string;
  secret: boolean;
}

export type TerminalAction =
  | { type: "clear" }
  | { type: "edit"; path: string; editor: string; readOnly: boolean; user: string }
  | { type: "reset-terminal" };

export interface ExecResult {
  /** Text written to the terminal (uses \n line endings, may contain ANSI). */
  output: string;
  exitCode: number;
  /** When set, the client must collect this input and re-run with it appended. */
  needsInput?: InputPrompt;
  actions: TerminalAction[];
  prompt: PromptInfo;
  /** Distinct command names executed (for stats / badges). */
  commandsUsed: string[];
  /** True when the virtual state changed and must be persisted. */
  mutated: boolean;
}

export interface PromptInfo {
  user: string;
  host: string;
  cwd: string;
  /** cwd with $HOME abbreviated to ~ */
  display: string;
  isRoot: boolean;
}
