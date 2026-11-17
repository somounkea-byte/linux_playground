import { ran, type SeedModule } from "./types";

export const modulesPart2: SeedModule[] = [
  {
    slug: "users-groups",
    title: "Users and Groups",
    description: "Root and normal users, UIDs and GIDs, primary and secondary groups, and the tools to manage them.",
    icon: "users",
    lessons: [
      {
        slug: "root-and-users",
        title: "Root, Normal Users and sudo",
        summary: "Who root is, why you should not log in as root, and how sudo works.",
        minutes: 10,
        content: `## Users

Every process and file belongs to a **user**. Each user has a numeric **UID**:

| UID | Who |
|---|---|
| 0 | **root** – the superuser, can do anything |
| 1–999 | system accounts (\`www-data\`, \`syslog\`, \`sshd\`...) |
| 1000+ | real people (you are \`student\`, UID 1000) |

## sudo

Instead of logging in as root, administrators run single commands as root with **sudo**. You type **your own** password, and it is cached for 15 minutes.

\`\`\`bash
sudo apt update     # run as root
sudo -i             # open a root shell (exit to leave)
sudo -l             # what am I allowed to do?
\`\`\`

Only members of the **sudo** group can use sudo. Every sudo command is logged to \`/var/log/auth.log\`.

> Your password in Linux Playground is \`student\`.

> **Practice:** compare \`whoami\` and \`sudo whoami\`, then read the last lines of the auth log.`,
        practice: [
          { command: "whoami", explanation: "student" },
          { command: "sudo whoami", explanation: "root" },
          { command: "sudo -l", explanation: "Your sudo rights" },
          { command: "sudo tail -n 5 /var/log/auth.log", explanation: "sudo usage is logged" },
        ],
        checks: [ran("sudo", "^sudo ", "Run a command with sudo")],
      },
      {
        slug: "uid-gid",
        title: "UIDs, GIDs and /etc/passwd",
        summary: "How accounts are stored in /etc/passwd, /etc/shadow and /etc/group.",
        minutes: 10,
        content: `## /etc/passwd

One line per account, seven fields separated by \`:\`

\`\`\`
student:x:1000:1000:Linux Playground Student,,,:/home/student:/bin/bash
│       │ │    │    │                           │             └ login shell
│       │ │    │    │                           └ home directory
│       │ │    │    └ comment (full name)
│       │ │    └ primary group ID (GID)
│       │ └ user ID (UID)
│       └ password placeholder (real hash is in /etc/shadow)
└ username
\`\`\`

## /etc/shadow

Holds the **hashed** passwords and is readable only by root.

## /etc/group

\`\`\`
sudo:x:27:student
│     │ │  └ members
│     │ └ GID
└ group name
\`\`\`

## Handy commands

\`\`\`bash
id                     # uid, gid and groups
getent passwd student  # one account
getent group sudo      # one group
\`\`\`

> **Practice:** print every username with \`cut -d: -f1 /etc/passwd\` and show your own \`id\`.`,
        practice: [
          { command: "id", explanation: "Your identity" },
          { command: "getent passwd student", explanation: "Your passwd entry" },
          { command: "cut -d: -f1,3 /etc/passwd", explanation: "Usernames and UIDs" },
          { command: "getent group sudo", explanation: "Who can use sudo?" },
        ],
        checks: [ran("id", "^id\\b", "Run id"), ran("passwd", "/etc/passwd|getent passwd", "Inspect the user database")],
      },
      {
        slug: "managing-users",
        title: "Creating and Deleting Users",
        summary: "useradd, adduser, passwd, usermod and userdel.",
        minutes: 14,
        content: `## useradd (low level)

\`\`\`bash
sudo useradd -m -s /bin/bash -c "John Smith" john
sudo passwd john
\`\`\`

| Option | Meaning |
|---|---|
| \`-m\` | create the home directory (copies /etc/skel) |
| \`-s\` | login shell (default /bin/sh) |
| \`-g\` / \`-G\` | primary / supplementary groups |
| \`-u\` | specific UID |

## adduser (friendly, Ubuntu)

\`sudo adduser mary\` asks for a password and details and creates everything.

## Modify and delete

\`\`\`bash
sudo usermod -s /bin/bash john   # change shell
sudo usermod -L john             # lock the account
sudo usermod -U john             # unlock
sudo userdel -r john             # delete with home directory
\`\`\`

> **Practice:** create user **alice** with a home directory and bash as her shell, and give her a password.`,
        practice: [
          { command: "sudo useradd -m -s /bin/bash alice", explanation: "Create the account" },
          { command: "sudo passwd alice", explanation: "Set a password" },
          { command: "id alice", explanation: "Check her identity" },
          { command: "ls -la /home/alice", explanation: "Her home was created from /etc/skel" },
        ],
        checks: [
          { id: "alice", type: "user_exists", username: "alice", shell: "/bin/bash", homeExists: true, description: "User alice exists with /bin/bash and a home directory" },
          { id: "pw", type: "user_has_password", username: "alice", description: "alice has a password" },
        ],
      },
      {
        slug: "managing-groups",
        title: "Primary and Secondary Groups",
        summary: "groupadd, usermod -aG, gpasswd and groupdel.",
        minutes: 12,
        content: `## Primary vs secondary

- The **primary group** (GID in /etc/passwd) is given to files you create.
- **Secondary (supplementary) groups** give extra access – e.g. \`sudo\`, \`developers\`.

## Group commands

\`\`\`bash
sudo groupadd developers             # create
sudo usermod -aG developers alice    # add (APPEND!)
sudo gpasswd -a bob developers       # another way to add
sudo gpasswd -d bob developers       # remove
sudo usermod -g developers alice     # change primary group
sudo groupdel developers             # delete
groups alice                         # list a user's groups
\`\`\`

> ⚠️ \`usermod -G developers alice\` **without -a** replaces all of alice's secondary groups!

> **Practice:** create the group **developers** and add **student** to it.`,
        practice: [
          { command: "sudo groupadd developers", explanation: "Create the group" },
          { command: "sudo usermod -aG developers student", explanation: "Append student to it" },
          { command: "groups student", explanation: "Verify" },
          { command: "getent group developers", explanation: "Members of developers" },
        ],
        checks: [
          { id: "grp", type: "group_exists", group: "developers", description: "Group developers exists" },
          { id: "mem", type: "user_in_group", username: "student", group: "developers", description: "student is a member of developers" },
        ],
      },
      {
        slug: "switching-users",
        title: "Switching Users: su and sudo -u",
        summary: "Become another user to test permissions.",
        minutes: 8,
        content: `## su

\`su - john\` starts a login shell as john and asks for **john's** password. \`exit\` returns to your previous user.

## sudo -u

\`sudo -u john whoami\` runs one command as john using **your** password.

## Root's password

On Ubuntu the root account is **locked** – \`su -\` fails with *Authentication failure*. Use \`sudo -i\` instead.

## Who is logged in?

\`who\`, \`w\`, \`users\` and \`last\` show current and past sessions.

> **Practice:** create user **bob** with a password, switch to him with \`su - bob\`, run \`whoami\` and \`exit\`.`,
        practice: [
          { command: "sudo useradd -m -s /bin/bash bob && sudo passwd bob", explanation: "Prepare bob" },
          { command: "su - bob", explanation: "Become bob (type bob's password)" },
          { command: "whoami", explanation: "bob" },
          { command: "exit", explanation: "Back to student" },
        ],
        checks: [ran("su", "^su ", "Switch user with su")],
      },
    ],
  },
  {
    slug: "process-management",
    title: "Process Management",
    description: "Processes, PIDs, states and priorities; ps, top, jobs, background tasks and signals.",
    icon: "cpu",
    lessons: [
      {
        slug: "processes",
        title: "What is a Process?",
        summary: "PIDs, parent processes, states and ps.",
        minutes: 10,
        content: `## Processes

A **process** is a running program. Each one has:

- a **PID** (process ID) and **PPID** (parent's PID)
- an owner (user)
- a **state**: R running, S sleeping, T stopped, Z zombie
- a priority (**nice** value from -20 high to 19 low)

PID **1** is \`systemd\`, the first process, which starts everything else.

## ps

\`\`\`bash
ps                # processes in this terminal
ps aux            # every process, BSD style (CPU, MEM, STAT)
ps -ef            # every process with PPID
ps -u student     # processes of one user
ps aux --sort=-%mem | head   # biggest memory users
\`\`\`

> **Practice:** list every process and find the SSH daemon with \`ps aux | grep sshd\`.`,
        practice: [
          { command: "ps", explanation: "Your processes" },
          { command: "ps aux", explanation: "All processes" },
          { command: "ps -ef | head", explanation: "With parent PIDs" },
          { command: "ps aux | grep sshd", explanation: "Filter with grep" },
        ],
        checks: [ran("psaux", "^ps (aux|-ef|-e)", "List all processes")],
      },
      {
        slug: "top",
        title: "Monitoring with top",
        summary: "Load average, CPU and memory at a glance.",
        minutes: 7,
        content: `## top

\`top\` shows a live, sorted view of processes. (Linux Playground prints one snapshot.)

\`\`\`
top - 08:30:15 up 47 min,  1 user,  load average: 0.08, 0.03, 0.01
Tasks: 121 total,   1 running, 120 sleeping,   0 stopped,   0 zombie
MiB Mem :   3919.2 total,   2304.1 free,    712.3 used,   1076.6 buff/cache
\`\`\`

- **load average**: average number of runnable processes over 1, 5 and 15 minutes.
- **%CPU / %MEM**: resources used by each process.

Related: \`uptime\`, \`free -h\`, \`htop\` (install with \`sudo apt install htop\`).

> **Practice:** run \`top\` and \`uptime\`.`,
        practice: [
          { command: "top", explanation: "Process overview" },
          { command: "uptime", explanation: "Load average" },
          { command: "free -h", explanation: "Memory" },
        ],
        checks: [ran("top", "^(top|htop)", "Run top")],
      },
      {
        slug: "jobs",
        title: "Foreground, Background and Jobs",
        summary: "Run commands in the background with &, list them with jobs, use fg and bg.",
        minutes: 9,
        content: `## Background jobs

Add **&** to run a command in the background and get your prompt back:

\`\`\`bash
sleep 300 &
[1] 1234          # job number and PID
jobs              # list jobs
fg %1             # bring job 1 to the foreground
kill %1           # stop job 1
\`\`\`

| Command | Effect |
|---|---|
| \`cmd &\` | start in background |
| \`jobs\` | list jobs of this shell |
| \`fg %n\` | foreground |
| \`bg %n\` | resume a stopped job in the background |
| Ctrl+Z | stop (pause) the foreground job on a real terminal |

> **Practice:** start \`sleep 600 &\` and list it with \`jobs\`.`,
        practice: [
          { command: "sleep 600 &", explanation: "Start a background job" },
          { command: "jobs", explanation: "List jobs" },
          { command: "ps -u student", explanation: "The sleep process is visible" },
        ],
        checks: [ran("bg", "&\\s*$", "Start a background job with &"), ran("jobs", "^jobs", "List jobs")],
      },
      {
        slug: "signals",
        title: "Signals: kill, killall, pkill",
        summary: "Ask processes to stop, force them, pause and resume them.",
        minutes: 10,
        content: `## Signals

| Signal | Number | Meaning |
|---|---|---|
| SIGTERM | 15 | please terminate (default) |
| SIGKILL | 9 | terminate immediately (cannot be ignored) |
| SIGHUP | 1 | reload configuration (daemons) |
| SIGSTOP / SIGCONT | 19 / 18 | pause / resume |

\`\`\`bash
kill 1234          # SIGTERM
kill -9 1234       # SIGKILL – last resort
killall nginx      # by name
pkill -u bob       # all of bob's processes
kill -l            # list signals
\`\`\`

You can only signal **your own** processes – root can signal anyone.

> **Practice:** start \`sleep 900 &\`, find its PID with \`pgrep sleep\`, and kill it.`,
        practice: [
          { command: "sleep 900 &", explanation: "Start something to kill" },
          { command: "pgrep -l sleep", explanation: "Find its PID" },
          { command: "pkill sleep", explanation: "Kill it by name" },
          { command: "kill 1", explanation: "Not allowed: PID 1 belongs to root" },
        ],
        checks: [ran("kill", "^(kill|killall|pkill) ", "Send a signal to a process"), { id: "nosleep", type: "process_running", name: "sleep", running: false, description: "No sleep process is left running" }],
      },
      {
        slug: "priorities",
        title: "Priorities: nice and renice",
        summary: "Give processes more or less CPU time.",
        minutes: 6,
        content: `## nice values

From **-20** (highest priority) to **19** (lowest). Normal users can only *lower* the priority of their processes (increase nice).

\`\`\`bash
nice -n 10 ./backup.sh       # start with low priority
renice -n 15 -p 1234         # change a running process
ps -o pid,ni,cmd -u student  # show nice values
\`\`\`

> **Practice:** start \`sleep 500 &\`, then renice it to 10.`,
        practice: [
          { command: "sleep 500 &", explanation: "A process to adjust" },
          { command: "renice -n 10 -p $(pgrep sleep)", explanation: "Lower its priority" },
          { command: "ps -o pid,ni,cmd -u student", explanation: "See the NI column" },
        ],
        checks: [ran("renice", "^renice ", "Change a priority with renice")],
      },
    ],
  },
  {
    slug: "networking",
    title: "Networking",
    description: "IP addresses, routes, DNS, connectivity tests, open ports and HTTP from the command line.",
    icon: "network",
    lessons: [
      {
        slug: "interfaces",
        title: "Interfaces and IP Addresses",
        summary: "ip addr, hostname -I and the loopback interface.",
        minutes: 9,
        content: `## Network interfaces

\`\`\`bash
ip addr        # or: ip a
ip -br a       # brief view
hostname -I    # just the IP addresses
\`\`\`

- **lo** – the *loopback* interface, \`127.0.0.1\`, the machine talking to itself.
- **eth0** – the Ethernet card with this machine's address (\`10.0.2.15/24\`).

\`/24\` is the **netmask** in CIDR notation: the first 24 bits (\`10.0.2\`) are the network.

> \`ifconfig\` is the older tool from the \`net-tools\` package – try it, then install it with apt.

> **Practice:** find your IPv4 address with two different commands.`,
        practice: [
          { command: "ip addr", explanation: "All interfaces" },
          { command: "ip -br a", explanation: "Brief" },
          { command: "hostname -I", explanation: "Addresses only" },
          { command: "ifconfig", explanation: "Not installed by default!" },
        ],
        checks: [ran("ipaddr", "^ip (-br )?a", "Show IP addresses with ip"), ran("hostnameI", "^hostname -I", "Run hostname -I")],
      },
      {
        slug: "routes-and-ping",
        title: "Routes, Gateways and ping",
        summary: "The default gateway and testing connectivity.",
        minutes: 9,
        content: `## Routing

\`\`\`bash
ip route
default via 10.0.2.2 dev eth0 ...
\`\`\`

Traffic for other networks goes to the **default gateway** (\`10.0.2.2\`).

## ping

\`ping\` sends ICMP echo requests and measures the round-trip time:

\`\`\`bash
ping -c 4 google.com
ping localhost
\`\`\`

Without \`-c\`, a real ping runs until you press Ctrl+C.

## Troubleshooting order

1. \`ping 127.0.0.1\` – is the network stack working?
2. \`ping 10.0.2.2\` – can I reach the gateway?
3. \`ping 8.8.8.8\` – can I reach the internet?
4. \`ping google.com\` – does DNS work?

> **Practice:** check the default route and ping \`ubuntu.com\` four times.`,
        practice: [
          { command: "ip route", explanation: "Routing table" },
          { command: "ping -c 4 ubuntu.com", explanation: "Test connectivity" },
          { command: "ping -c 2 8.8.8.8", explanation: "Ping an IP directly" },
        ],
        checks: [ran("route", "^ip r", "Show routes"), ran("ping", "^ping ", "Ping a host")],
      },
      {
        slug: "dns",
        title: "DNS and /etc/hosts",
        summary: "Turning names into addresses with nslookup, dig and /etc/hosts.",
        minutes: 9,
        content: `## DNS

DNS translates names like \`ubuntu.com\` into IP addresses.

\`\`\`bash
nslookup ubuntu.com
dig +short github.com
host example.com
\`\`\`

## /etc/hosts

Checked **before** DNS. Add local names:

\`\`\`bash
echo "10.0.2.50 intranet" | sudo tee -a /etc/hosts
ping -c 1 intranet
\`\`\`

> **Practice:** add an entry \`10.0.2.60 files\` to /etc/hosts and ping it.`,
        practice: [
          { command: "nslookup ubuntu.com", explanation: "DNS lookup" },
          { command: 'echo "10.0.2.60 files" | sudo tee -a /etc/hosts', explanation: "Add a local name" },
          { command: "getent hosts files", explanation: "Resolve it" },
        ],
        checks: [{ id: "hosts", type: "file_matches", path: "/etc/hosts", pattern: "^10\\.0\\.2\\.60\\s+files", description: "/etc/hosts maps files → 10.0.2.60" }],
      },
      {
        slug: "ports-and-http",
        title: "Ports, ss and curl",
        summary: "Which services listen on which ports, and talking HTTP from the terminal.",
        minutes: 11,
        content: `## Ports

A **port** identifies a service on a machine: 22 = SSH, 80 = HTTP, 443 = HTTPS, 3306 = MySQL.

\`\`\`bash
ss -tuln     # t=TCP u=UDP l=listening n=numeric
sudo ss -tulnp   # with the owning process
\`\`\`

## curl and wget

\`\`\`bash
curl http://example.com          # print a web page
curl -I https://ubuntu.com       # headers only
curl -o page.html http://example.com
wget http://example.com          # saves index.html
\`\`\`

## Try it with a web server

\`\`\`bash
sudo apt install -y nginx
ss -tuln | grep :80
curl http://localhost
\`\`\`

> **Practice:** install nginx and fetch your local web page with curl.`,
        practice: [
          { command: "ss -tuln", explanation: "Listening ports" },
          { command: "sudo apt install -y nginx", explanation: "Install a web server" },
          { command: "curl http://localhost", explanation: "Fetch the default page" },
        ],
        checks: [{ id: "nginx", type: "service_active", name: "nginx", active: true, description: "nginx is running" }, ran("curl", "^curl ", "Use curl")],
      },
    ],
  },
  {
    slug: "package-management",
    title: "Package Management",
    description: "Install, upgrade and remove software with apt and inspect packages with dpkg.",
    icon: "package",
    lessons: [
      {
        slug: "apt-basics",
        title: "apt update and apt upgrade",
        summary: "Refresh package lists and install security updates.",
        minutes: 9,
        content: `## Repositories

Ubuntu installs software from **repositories** configured in \`/etc/apt/sources.list.d/\`.

## Updating

\`\`\`bash
sudo apt update     # download the latest package lists
apt list --upgradable
sudo apt upgrade    # install newer versions
\`\`\`

\`update\` changes **nothing** on the system – it just learns what is available. \`upgrade\` actually installs updates.

> **Practice:** update the package lists, see what can be upgraded, and upgrade.`,
        practice: [
          { command: "sudo apt update", explanation: "Refresh lists" },
          { command: "apt list --upgradable", explanation: "What is out of date?" },
          { command: "sudo apt upgrade -y", explanation: "Install updates" },
        ],
        checks: [ran("update", "apt(-get)? update", "Run apt update"), ran("upgrade", "apt(-get)? (full-)?upgrade", "Run apt upgrade")],
      },
      {
        slug: "installing",
        title: "Installing and Removing Software",
        summary: "apt install, remove, purge and autoremove.",
        minutes: 10,
        content: `## Install

\`\`\`bash
sudo apt install tree htop       # one or more packages
sudo apt install -y nginx        # answer yes automatically
\`\`\`

apt resolves **dependencies** automatically and asks before installing extra packages.

## Remove

\`\`\`bash
sudo apt remove nginx      # keep configuration files
sudo apt purge nginx       # remove configuration too
sudo apt autoremove        # remove unused dependencies
\`\`\`

> **Practice:** install \`htop\` (notice its dependency) and \`cowsay\`, then run \`cowsay "I installed software!"\`.`,
        practice: [
          { command: "sudo apt install htop", explanation: "Watch apt install a dependency" },
          { command: "sudo apt install -y cowsay", explanation: "A fun one" },
          { command: 'cowsay "I installed software!"', explanation: "Use it" },
        ],
        checks: [{ id: "htop", type: "package_installed", name: "htop", description: "htop is installed" }, { id: "cowsay", type: "package_installed", name: "cowsay", description: "cowsay is installed" }],
      },
      {
        slug: "searching",
        title: "Searching and Inspecting Packages",
        summary: "apt search, apt show, dpkg -l and dpkg -L.",
        minutes: 8,
        content: `## Find packages

\`\`\`bash
apt search web server
apt show nginx
\`\`\`

## What is installed?

\`\`\`bash
dpkg -l                 # every installed package
dpkg -l | grep ssh      # filter
dpkg -L nginx           # files installed by a package
dpkg -S /usr/bin/tree   # which package owns a file?
\`\`\`

## "Command not found"

When you type a missing command, Ubuntu tells you which package provides it:

\`\`\`
Command 'tree' not found, but can be installed with:
sudo apt install tree
\`\`\`

> **Practice:** search for "firewall" packages and list installed packages containing "ssh".`,
        practice: [
          { command: "apt search firewall", explanation: "Search descriptions" },
          { command: "dpkg -l | grep ssh", explanation: "Installed SSH packages" },
          { command: "apt show curl", explanation: "Package details" },
        ],
        checks: [ran("search", "apt(-cache)? search", "Search packages"), ran("dpkg", "^dpkg -", "Inspect packages with dpkg")],
      },
      {
        slug: "services",
        title: "Services with systemctl",
        summary: "Start, stop, enable and inspect services installed by packages.",
        minutes: 10,
        content: `## systemd services

Packages like nginx and openssh-server install **services** (daemons) managed by \`systemctl\`:

\`\`\`bash
systemctl status ssh
sudo systemctl stop nginx
sudo systemctl start nginx
sudo systemctl restart nginx
sudo systemctl enable nginx    # start at boot
sudo systemctl disable nginx
systemctl list-units --type=service
\`\`\`

Service logs: \`journalctl -u nginx\`.

> **Practice:** install apache2 *after* nginx is running. Why does apache2 fail to start? Stop nginx and start apache2.`,
        practice: [
          { command: "systemctl status ssh", explanation: "Is SSH running?" },
          { command: "sudo apt install -y apache2", explanation: "Port 80 conflict with nginx" },
          { command: "sudo systemctl stop nginx && sudo systemctl start apache2", explanation: "Swap web servers" },
          { command: "journalctl -u apache2", explanation: "See what happened" },
        ],
        checks: [ran("systemctl", "systemctl (status|start|stop|restart)", "Manage a service with systemctl")],
      },
    ],
  },
];
