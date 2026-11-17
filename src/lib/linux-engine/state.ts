import { binaryPaths } from "./commands";
import { VirtualFileSystem } from "./filesystem";
import { BINARY_MARKER } from "./interpreter";
import { REPOSITORY } from "./packages";
import { baseProcesses, shellProcess, startServiceProcesses } from "./processes";
import { defaultDisks } from "./storage";
import type { EnvState, LinuxGroup, LinuxUser } from "./types";
import { syncEtcFiles } from "./users";
import { hashPassword, newId } from "./util";

export interface CreateEnvOptions {
  username?: string;
  password?: string;
  fullName?: string;
  hostname?: string;
  now?: number;
}

export const DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin";

const BASHRC = `# ~/.bashrc: executed by bash(1) for non-login shells.

# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

# don't put duplicate lines or lines starting with space in the history.
HISTCONTROL=ignoreboth
HISTSIZE=1000
HISTFILESIZE=2000

# set a fancy prompt
PS1='\\u@\\h:\\w\\$ '

# enable color support of ls and also add handy aliases
alias ls='ls --color=auto'
alias grep='grep --color=auto'
alias fgrep='fgrep --color=auto'
alias egrep='egrep --color=auto'

# some more ls aliases
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'
`;

const PROFILE = `# ~/.profile: executed by the command interpreter for login shells.

# if running bash
if [ -n "$BASH_VERSION" ]; then
    # include .bashrc if it exists
    if [ -f "$HOME/.bashrc" ]; then
	. "$HOME/.bashrc"
    fi
fi

# set PATH so it includes user's private bin if it exists
if [ -d "$HOME/bin" ] ; then
    PATH="$HOME/bin:$PATH"
fi
`;

const BASH_LOGOUT = `# ~/.bash_logout: executed by bash(1) when login shell exits.

# when leaving the console clear the screen to increase privacy
if [ "$SHLVL" = 1 ]; then
    [ -x /usr/bin/clear_console ] && /usr/bin/clear_console -q
fi
`;

const WELCOME = `Welcome to Linux Playground!

Start learning Linux commands and become a Linux administrator.

Tips:
  - Run 'help' to see some commands you can try.
  - Run 'man <command>' to read the manual of a command.
  - Your password is 'student' (you will need it for sudo).
`;

const HELLO_SH = `#!/bin/bash
# My first Bash script
# Make it executable with: chmod +x hello.sh
# Then run it with:        ./hello.sh

name="Linux Playground"
echo "Hello from $name!"
echo "You are logged in as: $USER"
echo "Today is $(date +%A)"
`;

const SUDOERS = `#
# This file MUST be edited with the 'visudo' command as root.
#
# See the man page for details on how to write a sudoers file.
#
Defaults\tenv_reset
Defaults\tmail_badpass
Defaults\tsecure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"
Defaults\tuse_pty

# User privilege specification
root\tALL=(ALL:ALL) ALL

# Members of the admin group may gain root privileges
%admin ALL=(ALL) ALL

# Allow members of group sudo to execute any command
%sudo\tALL=(ALL:ALL) ALL

@includedir /etc/sudoers.d
`;

const SSHD_CONFIG = `# This is the sshd server system-wide configuration file.  See
# sshd_config(5) for more information.

Include /etc/ssh/sshd_config.d/*.conf

#Port 22
#AddressFamily any
#ListenAddress 0.0.0.0

#LoginGraceTime 2m
#PermitRootLogin prohibit-password
#StrictModes yes
#MaxAuthTries 6
#MaxSessions 10

#PubkeyAuthentication yes
#PasswordAuthentication yes
#PermitEmptyPasswords no

KbdInteractiveAuthentication no
UsePAM yes
X11Forwarding yes
PrintMotd no
AcceptEnv LANG LC_*
Subsystem\tsftp\t/usr/lib/openssh/sftp-server
`;

const OS_RELEASE = `PRETTY_NAME="Ubuntu 24.04.1 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.1 LTS (Noble Numbat)"
VERSION_CODENAME=noble
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
SUPPORT_URL="https://help.ubuntu.com/"
BUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"
PRIVACY_POLICY_URL="https://www.ubuntu.com/legal/terms-and-policies/privacy-policy"
UBUNTU_CODENAME=noble
LOGO=ubuntu-logo
`;

const CPUINFO = `processor\t: 0
vendor_id\t: GenuineIntel
cpu family\t: 6
model\t\t: 154
model name\t: Virtual CPU @ 2.40GHz
cpu MHz\t\t: 2400.000
cache size\t: 12288 KB
cpu cores\t: 2
flags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ht syscall nx rdtscp lm constant_tsc rep_good nopl xtopology nonstop_tsc cpuid pni pclmulqdq ssse3 cx16 pcid sse4_1 sse4_2 x2apic movbe popcnt aes xsave avx rdrand hypervisor lahf_lm abm 3dnowprefetch fsgsbase bmi1 avx2 bmi2 invpcid rdseed adx clflushopt sha_ni arat md_clear flush_l1d arch_capabilities

processor\t: 1
vendor_id\t: GenuineIntel
cpu family\t: 6
model\t\t: 154
model name\t: Virtual CPU @ 2.40GHz
cpu MHz\t\t: 2400.000
cache size\t: 12288 KB
cpu cores\t: 2
`;

function systemUsers(): { users: LinuxUser[]; groups: LinuxGroup[] } {
  const u = (username: string, uid: number, gid: number, gecos: string, home: string, shell = "/usr/sbin/nologin"): LinuxUser => ({
    username,
    uid,
    gid,
    gecos,
    home,
    shell,
    passwordHash: "*",
    lastChange: 19800,
    locked: false,
  });
  const users = [
    { ...u("root", 0, 0, "root", "/root", "/bin/bash"), passwordHash: "!" },
    u("daemon", 1, 1, "daemon", "/usr/sbin"),
    u("bin", 2, 2, "bin", "/bin"),
    u("sys", 3, 3, "sys", "/dev"),
    u("sync", 4, 65534, "sync", "/bin", "/bin/sync"),
    u("games", 5, 60, "games", "/usr/games"),
    u("man", 6, 12, "man", "/var/cache/man"),
    u("lp", 7, 7, "lp", "/var/spool/lpd"),
    u("mail", 8, 8, "mail", "/var/mail"),
    u("news", 9, 9, "news", "/var/spool/news"),
    u("uucp", 10, 10, "uucp", "/var/spool/uucp"),
    u("proxy", 13, 13, "proxy", "/bin"),
    u("www-data", 33, 33, "www-data", "/var/www"),
    u("backup", 34, 34, "backup", "/var/backups"),
    u("list", 38, 38, "Mailing List Manager", "/var/list"),
    u("irc", 39, 39, "ircd", "/run/ircd"),
    u("_apt", 42, 65534, "", "/nonexistent"),
    u("nobody", 65534, 65534, "nobody", "/nonexistent"),
    u("systemd-network", 998, 998, "systemd Network Management", "/"),
    u("systemd-timesync", 996, 996, "systemd Time Synchronization", "/"),
    u("messagebus", 100, 101, "", "/nonexistent"),
    u("systemd-resolve", 991, 991, "systemd Resolver", "/"),
    u("syslog", 102, 102, "", "/nonexistent"),
    u("sshd", 103, 65534, "", "/run/sshd"),
  ];
  const g = (name: string, gid: number, members: string[] = []): LinuxGroup => ({ name, gid, members });
  const groups = [
    g("root", 0),
    g("daemon", 1),
    g("bin", 2),
    g("sys", 3),
    g("adm", 4, ["syslog"]),
    g("tty", 5),
    g("disk", 6),
    g("lp", 7),
    g("mail", 8),
    g("news", 9),
    g("uucp", 10),
    g("man", 12),
    g("proxy", 13),
    g("kmem", 15),
    g("dialout", 20),
    g("fax", 21),
    g("voice", 22),
    g("cdrom", 24),
    g("floppy", 25),
    g("tape", 26),
    g("sudo", 27),
    g("audio", 29),
    g("dip", 30),
    g("www-data", 33),
    g("backup", 34),
    g("operator", 37),
    g("list", 38),
    g("irc", 39),
    g("src", 40),
    g("shadow", 42),
    g("utmp", 43),
    g("video", 44),
    g("sasl", 45),
    g("plugdev", 46),
    g("staff", 50),
    g("games", 60),
    g("users", 100),
    g("messagebus", 101),
    g("syslog", 102),
    g("crontab", 103),
    g("systemd-journal", 999),
    g("systemd-network", 998),
    g("systemd-timesync", 996),
    g("systemd-resolve", 991),
    g("nogroup", 65534),
  ];
  return { users, groups };
}

/** Build a fresh Ubuntu 24.04-like virtual machine. */
export function createDefaultState(opts: CreateEnvOptions = {}): EnvState {
  const now = opts.now ?? Date.now();
  const username = opts.username ?? "student";
  const password = opts.password ?? "student";
  const hostname = opts.hostname ?? "linux-playground";
  const rootId = newId();
  const bootTime = now - 47 * 60 * 1000;

  const { users, groups } = systemUsers();
  const state: EnvState = {
    schemaVersion: 1,
    hostname,
    createdAt: now,
    bootTime,
    rootId,
    nodes: {
      [rootId]: { id: rootId, parentId: null, name: "", type: "dir", content: "", uid: 0, gid: 0, mode: 0o755, ctime: bootTime, mtime: bootTime },
    },
    users,
    groups,
    processes: [],
    nextPid: 1200,
    packages: { installed: {}, lastUpdate: null },
    services: {},
    disks: defaultDisks(),
    firewall: { enabled: false, rules: [] },
    logs: [],
    logins: [],
    network: {
      interfaces: [
        { name: "lo", mac: "00:00:00:00:00:00", ipv4: "127.0.0.1", prefix: 8, ipv6: "::1", mtu: 65536, up: true },
        { name: "eth0", mac: "08:00:27:3a:5c:9e", ipv4: "10.0.2.15", prefix: 24, ipv6: "fe80::a00:27ff:fe3a:5c9e", mtu: 1500, up: true },
      ],
      gateway: "10.0.2.2",
      dns: ["127.0.0.53"],
    },
    session: {
      userStack: [],
      vars: {},
      exported: [],
      arrays: {},
      aliases: {},
      functions: {},
      history: [],
      lastExit: 0,
      sudoTimestamps: {},
      jobs: [],
      umask: 0o002,
      editGrants: [],
    },
  };

  const fs = new VirtualFileSystem(state);
  const root = { uid: 0, gid: 0 };
  const dir = (path: string, mode = 0o755, owner = root) => {
    const d = fs.mkdirp(path, root, 0o755, bootTime);
    d.mode = mode;
    d.uid = owner.uid;
    d.gid = owner.gid;
    return d;
  };
  const file = (path: string, content: string, mode = 0o644, owner = root, size?: number) => fs.writeFileAt(path, content, { ...owner, mode, now: bootTime, size });
  const link = (path: string, target: string) => {
    const { parent, name } = fs.lookupParent(path, "/");
    fs.create(parent, name, "symlink", { uid: 0, gid: 0, mode: 0o777, target, now: bootTime });
  };

  // ---- top-level hierarchy
  for (const d of ["usr/bin", "usr/sbin", "usr/lib", "usr/lib64", "usr/share/doc", "usr/share/man/man1", "usr/share/man/man8", "usr/include", "usr/games", "usr/src", "usr/local/bin", "usr/local/sbin", "usr/local/lib", "usr/local/share", "usr/local/games"]) dir(`/${d}`);
  link("/bin", "usr/bin");
  link("/sbin", "usr/sbin");
  link("/lib", "usr/lib");
  link("/lib64", "usr/lib64");
  for (const d of ["boot/grub", "boot/efi", "etc", "home", "media", "mnt", "opt", "srv", "snap", "sys/class", "sys/kernel", "proc", "run/lock", "run/sshd", "run/user"]) dir(`/${d}`);
  dir("/run/user/1000", 0o700);
  dir("/root", 0o700);
  dir("/tmp", 0o1777);
  dir("/dev", 0o755);
  dir("/var/tmp", 0o1777);
  for (const d of ["var/cache/apt/archives", "var/cache/man", "var/lib/apt/lists", "var/lib/dpkg", "var/lib/systemd", "var/backups", "var/opt", "var/local", "var/spool", "var/www", "var/log/apt", "var/log/journal"]) dir(`/${d}`);
  dir("/var/mail", 0o2775, { uid: 0, gid: 8 });
  dir("/var/spool/cron", 0o755);
  dir("/var/spool/cron/crontabs", 0o1730, { uid: 0, gid: 103 });
  link("/var/run", "/run");
  link("/var/lock", "/run/lock");

  // ---- devices
  const dev = (name: string, type: "chardev" | "blockdev", mode: number, gid = 0) => fs.create(fs.lookup("/dev", "/"), name, type, { uid: 0, gid, mode, now: bootTime });
  dev("null", "chardev", 0o666);
  dev("zero", "chardev", 0o666);
  dev("random", "chardev", 0o666);
  dev("urandom", "chardev", 0o666);
  dev("tty", "chardev", 0o666, 5);
  dev("console", "chardev", 0o600);
  dev("sda", "blockdev", 0o660, 6);
  dev("sda1", "blockdev", 0o660, 6);
  dev("sda2", "blockdev", 0o660, 6);
  dev("sdb", "blockdev", 0o660, 6);
  dev("sr0", "blockdev", 0o660, 24);
  dir("/dev/pts");
  dir("/dev/shm", 0o1777);

  // ---- /proc (dynamic files are generated on read)
  file("/proc/cpuinfo", CPUINFO, 0o444);
  file("/proc/meminfo", "", 0o444);
  file("/proc/uptime", "", 0o444);
  file("/proc/loadavg", "", 0o444);
  file("/proc/version", "Linux version 6.8.0-45-generic (buildd@lcy02-amd64-001) (x86_64-linux-gnu-gcc-13 (Ubuntu 13.2.0-23ubuntu4) 13.2.0, GNU ld (GNU Binutils for Ubuntu) 2.42) #45-Ubuntu SMP PREEMPT_DYNAMIC Fri Aug 30 12:02:04 UTC 2024\n", 0o444);
  file("/proc/cmdline", "BOOT_IMAGE=/vmlinuz-6.8.0-45-generic root=UUID=8f0e2c41-7a3b-4c55-9d2e-1b6f0a9c3d71 ro quiet splash\n", 0o444);
  file("/proc/filesystems", "nodev\tsysfs\nnodev\ttmpfs\nnodev\tproc\n\text4\n\tvfat\n", 0o444);

  // ---- /boot
  file("/boot/vmlinuz-6.8.0-45-generic", "", 0o600, root, 14_980_000);
  file("/boot/initrd.img-6.8.0-45-generic", "", 0o644, root, 68_200_000);
  file("/boot/config-6.8.0-45-generic", "CONFIG_64BIT=y\nCONFIG_X86_64=y\nCONFIG_EXT4_FS=y\n", 0o644);
  file("/boot/System.map-6.8.0-45-generic", "", 0o600, root, 9_100_000);
  link("/boot/vmlinuz", "vmlinuz-6.8.0-45-generic");
  link("/boot/initrd.img", "initrd.img-6.8.0-45-generic");
  file("/boot/grub/grub.cfg", "# DO NOT EDIT THIS FILE\nset default=\"0\"\nset timeout=0\nmenuentry 'Ubuntu' {\n\tlinux /boot/vmlinuz-6.8.0-45-generic root=UUID=8f0e2c41 ro quiet splash\n}\n", 0o444);

  // ---- /etc
  file("/etc/hostname", `${hostname}\n`);
  file("/etc/hosts", `127.0.0.1 localhost\n127.0.1.1 ${hostname}\n\n# The following lines are desirable for IPv6 capable hosts\n::1     ip6-localhost ip6-loopback\nfe00::0 ip6-localnet\nff00::0 ip6-mcastprefix\nff02::1 ip6-allnodes\nff02::2 ip6-allrouters\n`);
  file("/etc/os-release", OS_RELEASE);
  file("/etc/lsb-release", "DISTRIB_ID=Ubuntu\nDISTRIB_RELEASE=24.04\nDISTRIB_CODENAME=noble\nDISTRIB_DESCRIPTION=\"Ubuntu 24.04.1 LTS\"\n");
  file("/etc/issue", "Ubuntu 24.04.1 LTS \\n \\l\n\n");
  file("/etc/issue.net", "Ubuntu 24.04.1 LTS\n");
  file("/etc/shells", "# /etc/shells: valid login shells\n/bin/sh\n/usr/bin/sh\n/bin/bash\n/usr/bin/bash\n/bin/rbash\n/usr/bin/rbash\n/usr/bin/dash\n");
  file("/etc/fstab", "# /etc/fstab: static file system information.\n#\n# <file system> <mount point>   <type>  <options>       <dump>  <pass>\nUUID=8f0e2c41-7a3b-4c55-9d2e-1b6f0a9c3d71 /               ext4    errors=remount-ro 0       1\nUUID=5A1C-3F2E  /boot/efi       vfat    umask=0077      0       1\n/swap.img\tnone\tswap\tsw\t0\t0\n");
  file("/etc/resolv.conf", "# This is /run/systemd/resolve/stub-resolv.conf managed by man:systemd-resolved(8).\n# Do not edit.\nnameserver 127.0.0.53\noptions edns0 trust-ad\nsearch .\n");
  file("/etc/timezone", "Etc/UTC\n");
  file("/etc/environment", `PATH="${DEFAULT_PATH}"\n`);
  file("/etc/sudoers", SUDOERS, 0o440);
  dir("/etc/sudoers.d", 0o750);
  file("/etc/sudoers.d/README", "#\n# Files in /etc/sudoers.d are parsed by sudo.\n#\n", 0o440);
  file("/etc/login.defs", "MAIL_DIR        /var/mail\nPASS_MAX_DAYS\t99999\nPASS_MIN_DAYS\t0\nPASS_WARN_AGE\t7\nUID_MIN\t\t\t 1000\nUID_MAX\t\t\t60000\nGID_MIN\t\t\t 1000\nGID_MAX\t\t\t60000\nUMASK\t\t022\nHOME_MODE\t0750\nENCRYPT_METHOD YESCRYPT\n");
  file("/etc/default/useradd", "# Default values for useradd(8)\nSHELL=/bin/sh\n# GROUP=100\n# HOME=/home\n# SKEL=/etc/skel\n");
  file("/etc/adduser.conf", "DSHELL=/bin/bash\nDHOME=/home\nGROUPHOMES=no\nLETTERHOMES=no\nSKEL=/etc/skel\nFIRST_SYSTEM_UID=100\nLAST_SYSTEM_UID=999\nFIRST_UID=1000\nLAST_UID=59999\nUSERGROUPS=yes\nDIR_MODE=0750\n");
  file("/etc/skel/.bashrc", BASHRC);
  file("/etc/skel/.profile", PROFILE);
  file("/etc/skel/.bash_logout", BASH_LOGOUT);
  file("/etc/profile", 'if [ "${PS1-}" ]; then\n  if [ "${BASH-}" ] && [ "$BASH" != "/bin/sh" ]; then\n    if [ -f /etc/bash.bashrc ]; then\n      . /etc/bash.bashrc\n    fi\n  fi\nfi\n');
  file("/etc/bash.bashrc", "# System-wide .bashrc file for interactive bash(1) shells.\n[ -z \"$PS1\" ] && return\nshopt -s checkwinsize\n");
  file("/etc/ssh/sshd_config", SSHD_CONFIG);
  dir("/etc/ssh/sshd_config.d");
  file("/etc/ssh/ssh_config", "Host *\n    SendEnv LANG LC_*\n    HashKnownHosts yes\n    GSSAPIAuthentication yes\n");
  file("/etc/ssh/ssh_host_ed25519_key", "-----BEGIN OPENSSH PRIVATE KEY-----\n(simulated host key)\n-----END OPENSSH PRIVATE KEY-----\n", 0o600);
  file("/etc/ssh/ssh_host_ed25519_key.pub", `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISimulatedHostKey root@${hostname}\n`);
  file("/etc/apt/sources.list", "# Ubuntu sources have moved to /etc/apt/sources.list.d/ubuntu.sources\n");
  file("/etc/apt/sources.list.d/ubuntu.sources", "Types: deb\nURIs: http://archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates noble-backports\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: http://security.ubuntu.com/ubuntu/\nSuites: noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n");
  file("/etc/crontab", "# /etc/crontab: system-wide crontab\nSHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin\n\n# m h dom mon dow user\tcommand\n17 *\t* * *\troot\tcd / && run-parts --report /etc/cron.hourly\n25 6\t* * *\troot\ttest -x /usr/sbin/anacron || run-parts --report /etc/cron.daily\n");
  dir("/etc/cron.d");
  dir("/etc/cron.daily");
  dir("/etc/cron.hourly");
  file("/etc/netplan/50-cloud-init.yaml", "network:\n  version: 2\n  ethernets:\n    eth0:\n      dhcp4: true\n", 0o600);
  file("/etc/ufw/ufw.conf", "# /etc/ufw/ufw.conf\n#\n# Set to yes to start on boot.\nENABLED=no\n\n# Please use the 'ufw' command to set the loglevel.\nLOGLEVEL=low\n");
  file("/etc/nanorc", "## Sample initialization file for GNU nano.\n# set linenumbers\n# set autoindent\n");
  file("/etc/motd", "");
  file("/etc/services", "ssh\t\t22/tcp\nsmtp\t\t25/tcp\t\tmail\ndomain\t\t53/tcp\ndomain\t\t53/udp\nhttp\t\t80/tcp\t\twww\nhttps\t\t443/tcp\nmysql\t\t3306/tcp\n");
  dir("/etc/systemd/system");
  dir("/etc/security");
  file("/etc/security/limits.conf", "# /etc/security/limits.conf\n#<domain>      <type>  <item>         <value>\n");

  // ---- binaries
  const installedNames = new Set(REPOSITORY.filter((p) => p.preinstalled).map((p) => p.name));
  for (const { name, path, def } of binaryPaths()) {
    if (def.package && !installedNames.has(def.package)) continue;
    if (fs.tryLookup(path, "/")) continue;
    file(path, BINARY_MARKER + name, 0o755, root, 30000 + name.length * 2731);
  }
  // sudo / passwd are setuid root on real systems
  for (const p of ["/usr/bin/sudo", "/usr/bin/passwd", "/usr/bin/su", "/usr/bin/chsh"]) {
    const n = fs.tryLookup(p, "/");
    if (n) n.mode = 0o4755;
  }

  // ---- users
  for (const g of state.groups) if (g.name === "systemd-journal") g.members = [];
  const student: LinuxUser = {
    username,
    uid: 1000,
    gid: 1000,
    gecos: opts.fullName ? `${opts.fullName},,,` : "Linux Playground Student,,,",
    home: `/home/${username}`,
    shell: "/bin/bash",
    passwordHash: hashPassword(password),
    lastChange: Math.floor(now / 86400000),
    locked: false,
  };
  state.users.push(student);
  state.groups.push({ name: username, gid: 1000, members: [] });
  for (const gname of ["adm", "cdrom", "sudo", "dip", "plugdev", "users"]) state.groups.find((g) => g.name === gname)!.members.push(username);
  const me = { uid: 1000, gid: 1000 };

  // root home
  file("/root/.bashrc", BASHRC, 0o644);
  file("/root/.profile", PROFILE, 0o644);

  // student home
  const home = `/home/${username}`;
  dir(home, 0o750, me);
  file(`${home}/.bashrc`, BASHRC, 0o644, me);
  file(`${home}/.profile`, PROFILE, 0o644, me);
  file(`${home}/.bash_logout`, BASH_LOGOUT, 0o644, me);
  dir(`${home}/projects`, 0o775, me);
  dir(`${home}/documents`, 0o775, me);
  dir(`${home}/downloads`, 0o775, me);
  file(`${home}/documents/welcome.txt`, WELCOME, 0o664, me);
  file(`${home}/projects/hello.sh`, HELLO_SH, 0o664, me);

  // ---- logs
  const logFile = (path: string, content: string, mode = 0o640, owner = { uid: 102, gid: 4 }) => file(path, content, mode, owner);
  logFile("/var/log/syslog", "");
  logFile("/var/log/auth.log", "");
  logFile("/var/log/kern.log", "");
  file("/var/log/dpkg.log", "", 0o644);
  file("/var/log/apt/history.log", "", 0o644);
  file("/var/log/apt/term.log", "", 0o640, { uid: 0, gid: 4 });
  file("/var/log/lastlog", "", 0o664, { uid: 0, gid: 43 }, 292292);
  file("/var/log/wtmp", "", 0o664, { uid: 0, gid: 43 }, 15360);
  file("/var/log/btmp", "", 0o660, { uid: 0, gid: 43 }, 0);

  // ---- packages & services
  for (const p of REPOSITORY.filter((x) => x.preinstalled)) {
    state.packages.installed[p.name] = { version: p.version, installedAt: bootTime, auto: false };
  }
  state.processes = baseProcesses(state, bootTime);
  state.nextPid = 812;
  const baseUnits = ["cron", "rsyslog", "systemd-journald", "systemd-networkd", "systemd-resolved", "systemd-logind", "dbus"];
  for (const u of baseUnits) state.services[u] = { name: u, enabled: true, active: true, since: bootTime + 4000 };
  state.services.ufw = { name: "ufw", enabled: true, active: false, since: bootTime + 4000 };
  state.services.ssh = { name: "ssh", enabled: true, active: true, since: bootTime + 5000 };
  startServiceProcesses(state, "ssh", bootTime + 5000);
  state.nextPid = 1001;
  state.processes.push({
    pid: state.nextPid++,
    ppid: 812,
    user: "root",
    command: "sshd",
    args: `sshd: ${username} [priv]`,
    state: "S",
    nice: 0,
    startedAt: now - 60000,
    tty: "?",
    cpu: 0,
    mem: 0.2,
    vsz: 17448,
    rss: 10880,
  });
  state.nextPid = 1150;
  state.processes.push({ ...shellProcess(state, username, now - 60000), ppid: 1001 });
  state.nextPid = 1200;

  const log = (ts: number, f: "auth" | "syslog", source: string, message: string, unit?: string) => state.logs.push({ ts, file: f, source, message, unit });
  log(bootTime, "syslog", "kernel", "Linux version 6.8.0-45-generic (buildd@lcy02-amd64-001) #45-Ubuntu SMP PREEMPT_DYNAMIC");
  log(bootTime + 900, "syslog", "kernel", "EXT4-fs (sda2): mounted filesystem 8f0e2c41-7a3b-4c55-9d2e-1b6f0a9c3d71 ro with ordered data mode.");
  log(bootTime + 2000, "syslog", "systemd[1]", "Started systemd-journald.service - Journal Service.", "systemd-journald");
  log(bootTime + 3000, "syslog", "systemd-networkd[512]", "eth0: DHCPv4 address 10.0.2.15/24, gateway 10.0.2.2 acquired from 10.0.2.2", "systemd-networkd");
  log(bootTime + 4000, "syslog", "systemd[1]", "Started cron.service - Regular background program processing daemon.", "cron");
  log(bootTime + 4100, "syslog", "systemd[1]", "Started rsyslog.service - System Logging Service.", "rsyslog");
  log(bootTime + 5000, "syslog", "systemd[1]", "Starting ssh.service - OpenBSD Secure Shell server...", "ssh");
  log(bootTime + 5100, "syslog", "sshd[812]", "Server listening on 0.0.0.0 port 22.", "ssh");
  log(bootTime + 5100, "syslog", "sshd[812]", "Server listening on :: port 22.", "ssh");
  log(bootTime + 5200, "syslog", "systemd[1]", "Started ssh.service - OpenBSD Secure Shell server.", "ssh");
  log(now - 60000, "auth", "sshd[1001]", `Accepted password for ${username} from 10.0.2.2 port 51432 ssh2`, "ssh");
  log(now - 60000, "auth", "sshd[1001]", `pam_unix(sshd:session): session opened for user ${username}(uid=1000) by ${username}(uid=0)`, "ssh");
  log(now - 60000, "auth", "systemd-logind[622]", `New session 1 of user ${username}.`);
  state.logins.push({ user: username, tty: "pts/0", from: "10.0.2.2", loginAt: now - 60000, logoutAt: null });

  // ---- session
  state.session.userStack = [{ user: username, cwd: home, login: true }];
  state.session.vars = {
    PATH: DEFAULT_PATH,
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    EDITOR: "nano",
    HISTSIZE: "1000",
    HISTCONTROL: "ignoreboth",
    PS1: "\\u@\\h:\\w\\$ ",
    MAIL: `/var/mail/${username}`,
    SHLVL: "1",
  };
  state.session.exported = ["PATH", "TERM", "LANG", "EDITOR", "MAIL", "SHLVL"];
  state.session.aliases = {
    ls: "ls --color=auto",
    grep: "grep --color=auto",
    fgrep: "fgrep --color=auto",
    egrep: "egrep --color=auto",
    ll: "ls -alF",
    la: "ls -A",
    l: "ls -CF",
  };

  syncEtcFiles(state, fs, bootTime);
  return state;
}

/** Add binaries for commands introduced after an environment was created. */
export function ensureBinaries(state: EnvState): boolean {
  const fs = new VirtualFileSystem(state);
  let changed = false;
  for (const { name, path, def } of binaryPaths()) {
    if (def.package && !state.packages.installed[def.package]) continue;
    const dirPath = path.slice(0, path.lastIndexOf("/"));
    const d = fs.tryLookup(dirPath, "/");
    if (!d || d.type !== "dir") continue;
    if (fs.child(d, name)) continue;
    fs.create(d, name, "file", { uid: 0, gid: 0, mode: 0o755, content: BINARY_MARKER + name, size: 30000 + name.length * 2731, now: state.createdAt });
    changed = true;
  }
  return changed;
}
