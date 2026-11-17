import { ran, type SeedModule } from "./types";

export const modulesPart3: SeedModule[] = [
  {
    slug: "storage-management",
    title: "Storage Management",
    description: "Disks, partitions, file systems, mounting, and checking disk and memory usage.",
    icon: "hard-drive",
    lessons: [
      {
        slug: "disk-usage",
        title: "Disk Space: df and du",
        summary: "How full are the file systems, and what is using the space?",
        minutes: 8,
        content: `## df – file system usage

\`\`\`bash
df -h          # human readable
df -hT         # with file system type
df -h /home    # the file system containing /home
\`\`\`

## du – directory usage

\`\`\`bash
du -sh ~                 # total size of your home
du -h -d 1 /var | sort -h   # biggest folders in /var
\`\`\`

A full root file system (\`/\` at 100%) stops services from writing logs and data – check it first when something breaks.

> **Practice:** show disk usage in human-readable form and the total size of your home directory.`,
        practice: [
          { command: "df -h", explanation: "File systems" },
          { command: "du -sh ~", explanation: "Your home directory" },
          { command: "du -h -d 1 /var", explanation: "Per-directory usage" },
        ],
        checks: [ran("df", "^df ", "Run df"), ran("du", "^(sudo )?du ", "Run du")],
      },
      {
        slug: "block-devices",
        title: "Disks and Partitions",
        summary: "lsblk, fdisk -l and blkid.",
        minutes: 8,
        content: `## Block devices

\`\`\`bash
lsblk          # disks and partitions as a tree
lsblk -f       # with file systems and UUIDs
sudo fdisk -l  # partition tables
sudo blkid     # UUIDs and types
\`\`\`

Device names: \`/dev/sda\` is the first disk, \`/dev/sda1\` its first partition. This machine has a spare, unformatted **10 GB disk \`/dev/sdb\`**.

> **Practice:** find the spare disk with lsblk.`,
        practice: [
          { command: "lsblk", explanation: "Disk tree" },
          { command: "lsblk -f", explanation: "File systems" },
          { command: "sudo fdisk -l", explanation: "Partition tables" },
        ],
        checks: [ran("lsblk", "^lsblk", "Run lsblk")],
      },
      {
        slug: "mounting",
        title: "File Systems and Mounting",
        summary: "Format a disk with mkfs and mount it into the tree.",
        minutes: 11,
        content: `## Create a file system

\`\`\`bash
sudo mkfs.ext4 /dev/sdb
\`\`\`

⚠️ Formatting erases everything on the device.

## Mount it

\`\`\`bash
sudo mkdir -p /mnt/data
sudo mount /dev/sdb /mnt/data
df -h /mnt/data
mount | grep sdb
sudo umount /mnt/data
\`\`\`

To mount automatically at boot, add a line to \`/etc/fstab\` (preferably using the UUID from \`blkid\`).

> **Practice:** format \`/dev/sdb\` as ext4 and mount it at \`/mnt/data\`.`,
        practice: [
          { command: "sudo mkfs.ext4 /dev/sdb", explanation: "Create a file system" },
          { command: "sudo mkdir -p /mnt/data", explanation: "Mount point" },
          { command: "sudo mount /dev/sdb /mnt/data", explanation: "Mount" },
          { command: "df -h /mnt/data", explanation: "Verify" },
        ],
        checks: [
          { id: "fmt", type: "disk_formatted", device: "/dev/sdb", fstype: "ext4", description: "/dev/sdb has an ext4 file system" },
          { id: "mnt", type: "disk_mounted", device: "/dev/sdb", mountpoint: "/mnt/data", description: "/dev/sdb is mounted on /mnt/data" },
        ],
      },
      {
        slug: "memory",
        title: "Memory and Swap",
        summary: "free -h and what 'available' really means.",
        minutes: 6,
        content: `## free

\`\`\`bash
free -h
               total        used        free      shared  buff/cache   available
Mem:           3.8Gi       800Mi       1.9Gi       4.0Mi       1.1Gi       2.8Gi
Swap:          2.0Gi          0B       2.0Gi
\`\`\`

- **buff/cache** – memory Linux uses as disk cache; it is given back when programs need it.
- **available** – the number to watch: how much memory new programs can use.
- **Swap** – disk space used as overflow memory (slow).

> **Practice:** run \`free -h\` and \`cat /proc/meminfo | head -3\`.`,
        practice: [
          { command: "free -h", explanation: "Memory summary" },
          { command: "cat /proc/meminfo | head -3", explanation: "Raw kernel numbers" },
        ],
        checks: [ran("free", "^free", "Run free")],
      },
    ],
  },
  {
    slug: "shell-scripting",
    title: "Shell Scripting",
    description: "Automate tasks with Bash: variables, input, conditions, loops, arrays and functions.",
    icon: "file-code",
    lessons: [
      {
        slug: "first-script",
        title: "Your First Script",
        summary: "The shebang, making scripts executable and running them.",
        minutes: 10,
        content: `## A script is a text file of commands

\`\`\`bash
#!/bin/bash
# backup.sh - my first script
echo "Starting backup at $(date)"
tar -czf ~/backup.tar.gz ~/documents
echo "Done!"
\`\`\`

- Line 1, the **shebang** \`#!/bin/bash\`, says which interpreter runs the file.
- \`#\` starts a comment.

## Running it

\`\`\`bash
nano backup.sh       # write it (or use the Script Editor below)
chmod +x backup.sh
./backup.sh          # needs execute permission
bash backup.sh       # only needs read permission
\`\`\`

> **Practice:** create \`~/hello2.sh\` that prints \`Hello, scripting!\`, make it executable and run it.`,
        practice: [
          { command: "printf '#!/bin/bash\\necho \"Hello, scripting!\"\\n' > ~/hello2.sh", explanation: "Create the script" },
          { command: "chmod +x ~/hello2.sh", explanation: "Make it executable" },
          { command: "~/hello2.sh", explanation: "Run it" },
        ],
        checks: [{ id: "out", type: "command_output", command: "su - student -c /home/student/hello2.sh", contains: "Hello, scripting!", description: "~/hello2.sh is executable and prints Hello, scripting!" }],
      },
      {
        slug: "variables-and-input",
        title: "Variables and User Input",
        summary: "Assign and use variables, command substitution, arguments and read.",
        minutes: 12,
        content: `## Variables

\`\`\`bash
name="Linux"          # no spaces around =
echo "Hello $name"
echo "Hello \${name}!"
today=$(date +%F)     # command substitution
count=$((3 + 4))      # arithmetic
\`\`\`

Use **double quotes** to keep spaces and expand variables, **single quotes** for literal text.

## Script arguments

| Variable | Meaning |
|---|---|
| \`$0\` | script name |
| \`$1\`, \`$2\`... | arguments |
| \`$#\` | number of arguments |
| \`$@\` | all arguments |
| \`$?\` | exit status of the last command |

## Reading input

\`\`\`bash
read -p "What is your name? " user
echo "Welcome, $user"
\`\`\`

> **Practice:** write \`~/greet.sh\` that prints \`Hello, NAME\` using its first argument, and run \`bash ~/greet.sh Linux\`.`,
        practice: [
          { command: "name=World; echo \"Hello $name\"", explanation: "A variable" },
          { command: "echo \"Today is $(date +%A)\"", explanation: "Command substitution" },
          { command: "printf '#!/bin/bash\\necho \"Hello, $1\"\\n' > ~/greet.sh", explanation: "Use an argument" },
          { command: "bash ~/greet.sh Linux", explanation: "Hello, Linux" },
        ],
        checks: [{ id: "greet", type: "command_output", command: "bash /home/student/greet.sh Tux", contains: "Hello, Tux", description: "~/greet.sh prints Hello, <first argument>" }],
      },
      {
        slug: "conditions",
        title: "Conditions: if, test and case",
        summary: "Make decisions with if/elif/else, [ ] tests and case.",
        minutes: 12,
        content: `## if

\`\`\`bash
if [ -f /etc/passwd ]; then
  echo "file exists"
elif [ -d /etc ]; then
  echo "directory"
else
  echo "missing"
fi
\`\`\`

## Common tests

| Test | True when |
|---|---|
| \`-f file\` / \`-d dir\` / \`-e path\` | is a file / directory / exists |
| \`-r\` \`-w\` \`-x\` | readable / writable / executable |
| \`-z "$s"\` / \`-n "$s"\` | empty / not empty string |
| \`"$a" = "$b"\` | strings equal |
| \`$a -eq $b\` \`-ne -lt -le -gt -ge\` | numbers compare |

\`[[ ... ]]\` adds pattern matching: \`[[ $file == *.sh ]]\`.

## case

\`\`\`bash
case "$1" in
  start) echo "starting" ;;
  stop)  echo "stopping" ;;
  *)     echo "usage: $0 start|stop" ;;
esac
\`\`\`

> **Practice:** write \`~/check.sh\` that prints \`even\` or \`odd\` for its first argument.`,
        practice: [
          { command: "[ -d /etc ] && echo yes", explanation: "A quick test" },
          { command: "if [ $(id -u) -eq 0 ]; then echo root; else echo normal user; fi", explanation: "Am I root?" },
          { command: "printf '#!/bin/bash\\nif [ $(( $1 %% 2 )) -eq 0 ]; then echo even; else echo odd; fi\\n' > ~/check.sh", explanation: "even/odd script" },
          { command: "bash ~/check.sh 7", explanation: "odd" },
        ],
        checks: [
          { id: "odd", type: "command_output", command: "bash /home/student/check.sh 7", equals: "odd", description: "~/check.sh 7 prints odd" },
          { id: "even", type: "command_output", command: "bash /home/student/check.sh 10", equals: "even", description: "~/check.sh 10 prints even" },
        ],
      },
      {
        slug: "loops",
        title: "Loops: for and while",
        summary: "Repeat work over lists, files, ranges and conditions.",
        minutes: 12,
        content: `## for

\`\`\`bash
for user in alice bob carol; do
  echo "Creating $user"
done

for i in {1..5}; do echo "Line $i"; done

for f in ~/documents/*.txt; do
  wc -l "$f"
done

for ((i = 0; i < 3; i++)); do echo $i; done
\`\`\`

## while

\`\`\`bash
count=1
while [ $count -le 3 ]; do
  echo "Attempt $count"
  count=$((count + 1))
done

# read a file line by line
while read -r line; do
  echo "> $line"
done < /etc/hostname
\`\`\`

\`break\` leaves a loop, \`continue\` skips to the next iteration.

> **Practice:** create \`~/numbers.txt\` containing the numbers 1 to 10, one per line, using a loop.`,
        practice: [
          { command: "for i in {1..10}; do echo $i; done > ~/numbers.txt", explanation: "Loop output into a file" },
          { command: "wc -l ~/numbers.txt", explanation: "10 lines" },
          { command: "while read n; do echo $((n * n)); done < ~/numbers.txt", explanation: "Squares" },
        ],
        checks: [{ id: "nums", type: "command_output", command: "cat /home/student/numbers.txt", equals: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10", description: "~/numbers.txt contains 1 to 10" }],
      },
      {
        slug: "arrays-and-functions",
        title: "Arrays and Functions",
        summary: "Store lists in arrays and organise scripts with functions.",
        minutes: 12,
        content: `## Arrays

\`\`\`bash
services=(ssh nginx cron)
echo "\${services[0]}"        # first element
echo "\${services[@]}"        # all elements
echo "\${#services[@]}"       # number of elements
services+=(ufw)              # append
for s in "\${services[@]}"; do systemctl is-active "$s"; done
\`\`\`

## Functions

\`\`\`bash
log() {
  local level=$1; shift
  echo "[$(date +%T)] $level: $*"
}

check_user() {
  if id "$1" >/dev/null 2>&1; then return 0; else return 1; fi
}

log INFO "starting"
check_user student && log INFO "student exists"
\`\`\`

\`local\` keeps variables inside the function; \`return\` sets its exit status.

> **Practice:** write \`~/sum.sh\` with a function \`add\` that prints the sum of the script's two arguments.`,
        practice: [
          { command: "fruits=(apple banana cherry); echo ${#fruits[@]} ${fruits[1]}", explanation: "Arrays" },
          { command: "greet() { echo \"Hi $1\"; }; greet Linux", explanation: "A function" },
          { command: "printf '#!/bin/bash\\nadd() {\\n  echo $(( $1 + $2 ))\\n}\\nadd \"$1\" \"$2\"\\n' > ~/sum.sh", explanation: "Function script" },
          { command: "bash ~/sum.sh 4 5", explanation: "9" },
        ],
        checks: [{ id: "sum", type: "command_output", command: "bash /home/student/sum.sh 20 22", equals: "42", description: "~/sum.sh 20 22 prints 42" }],
      },
    ],
  },
  {
    slug: "linux-security",
    title: "Linux Security",
    description: "sudo and root, SSH, the firewall, secure permissions, logs and basic hardening.",
    icon: "lock",
    lessons: [
      {
        slug: "sudo-and-root",
        title: "sudo, su and the Root Account",
        summary: "The principle of least privilege on Linux.",
        minutes: 9,
        content: `## Least privilege

Work as a normal user and use root powers only when needed:

- \`sudo command\` – one command as root, logged, your password.
- \`sudo -i\` – root shell; leave it as soon as possible with \`exit\`.
- \`su - user\` – become another user with **their** password.

## Who can use sudo?

Members of the **sudo** group (configured in \`/etc/sudoers\`, edit only with \`visudo\`).

\`\`\`bash
getent group sudo
sudo -l
\`\`\`

## Audit trail

\`\`\`bash
sudo grep sudo /var/log/auth.log
\`\`\`

> **Practice:** look at who is allowed to use sudo and read the sudo entries in the auth log.`,
        practice: [
          { command: "getent group sudo", explanation: "sudo group members" },
          { command: "sudo grep COMMAND /var/log/auth.log", explanation: "Audit sudo usage" },
          { command: "ls -l /etc/sudoers", explanation: "Mode 0440: read-only for root" },
        ],
        checks: [ran("auth", "auth\\.log", "Read /var/log/auth.log")],
      },
      {
        slug: "ssh",
        title: "SSH Concepts and Keys",
        summary: "Remote login, key pairs and protecting your private key.",
        minutes: 11,
        content: `## SSH

**SSH** (Secure Shell) gives an encrypted remote terminal. The server (\`sshd\`) listens on **port 22**.

\`\`\`bash
systemctl status ssh
ssh john@localhost      # log in as john on this machine
\`\`\`

## Key-based authentication

Keys are safer than passwords:

\`\`\`bash
ssh-keygen -t ed25519 -C "student@school"
ls -l ~/.ssh
\`\`\`

- \`id_ed25519\` – **private** key, must be \`600\` and never shared.
- \`id_ed25519.pub\` – **public** key, copied to servers into \`~/.ssh/authorized_keys\`.

## Hardening sshd

In \`/etc/ssh/sshd_config\`: \`PermitRootLogin no\`, \`PasswordAuthentication no\` (after setting up keys), then \`sudo systemctl restart ssh\`.

> **Practice:** generate an ed25519 key pair with no passphrase.`,
        practice: [
          { command: "ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519", explanation: "Generate keys non-interactively" },
          { command: "ls -l ~/.ssh", explanation: "Check the permissions" },
          { command: "cat ~/.ssh/id_ed25519.pub", explanation: "The public half" },
        ],
        checks: [
          { id: "key", type: "file_exists", path: "/home/student/.ssh/id_ed25519", description: "Private key ~/.ssh/id_ed25519 exists" },
          { id: "mode", type: "file_mode", path: "/home/student/.ssh/id_ed25519", mode: "600", description: "Private key has mode 600" },
        ],
      },
      {
        slug: "firewall",
        title: "Firewall with ufw",
        summary: "Allow only the traffic you need.",
        minutes: 10,
        content: `## ufw – Uncomplicated Firewall

\`\`\`bash
sudo ufw status
sudo ufw allow OpenSSH       # ALWAYS allow SSH first on a remote server!
sudo ufw allow 80/tcp
sudo ufw deny 23
sudo ufw enable
sudo ufw status numbered
sudo ufw delete allow 80/tcp
\`\`\`

The default policy is **deny incoming, allow outgoing**: once enabled, only the ports you allowed are reachable.

> **Practice:** allow SSH and HTTP, then enable the firewall.`,
        practice: [
          { command: "sudo ufw allow OpenSSH", explanation: "Keep SSH reachable" },
          { command: "sudo ufw allow 80/tcp", explanation: "Web traffic" },
          { command: "sudo ufw enable", explanation: "Answer y" },
          { command: "sudo ufw status verbose", explanation: "Review" },
        ],
        checks: [
          { id: "ssh", type: "firewall_rule", port: "22", description: "SSH (22/tcp) is allowed" },
          { id: "http", type: "firewall_rule", port: "80", description: "HTTP (80/tcp) is allowed" },
          { id: "on", type: "firewall_enabled", enabled: true, description: "The firewall is enabled" },
        ],
      },
      {
        slug: "secure-permissions",
        title: "Secure File Permissions",
        summary: "Find and fix dangerous permissions.",
        minutes: 9,
        content: `## Dangerous permissions

- **World-writable** files (\`o+w\`) – anyone can modify them.
- **777** directories outside \`/tmp\`.
- Unexpected **setuid** programs.
- Readable secrets (\`.env\`, keys, backups).

## Hunting them

\`\`\`bash
find ~ -perm -o+w -type f          # world-writable files
find / -perm -4000 2>/dev/null     # setuid programs
find /var/www -perm 777
\`\`\`

## Fixing

\`\`\`bash
chmod o-w file
chmod 600 ~/.ssh/id_ed25519
chmod 640 config.env
\`\`\`

> **Practice:** create \`~/secrets.txt\` and make sure only you can read or write it (mode 600).`,
        practice: [
          { command: "echo 'db_password=s3cret' > ~/secrets.txt", explanation: "A sensitive file" },
          { command: "ls -l ~/secrets.txt", explanation: "Readable by others (664)!" },
          { command: "chmod 600 ~/secrets.txt", explanation: "Owner only" },
          { command: "find / -perm -4000 2>/dev/null", explanation: "setuid programs" },
        ],
        checks: [{ id: "sec", type: "file_mode", path: "/home/student/secrets.txt", mode: "600", description: "~/secrets.txt has mode 600" }],
      },
      {
        slug: "logs-and-hardening",
        title: "System Logs and Basic Hardening",
        summary: "journalctl, auth.log, last, lastlog and a hardening checklist.",
        minutes: 10,
        content: `## Logs

| Source | Contains |
|---|---|
| \`/var/log/auth.log\` | logins, sudo, su, SSH, user changes |
| \`/var/log/syslog\` | general system messages |
| \`journalctl\` | the systemd journal (\`-u ssh\`, \`-n 20\`) |
| \`last\` / \`lastlog\` | login history |

\`\`\`bash
sudo grep "Failed password" /var/log/auth.log
journalctl -u ssh -n 20
last
\`\`\`

## Hardening checklist

1. Keep the system updated (\`apt update && apt upgrade\`).
2. Use sudo, never log in as root; lock unused accounts (\`usermod -L\`).
3. Use SSH keys, disable root SSH login.
4. Enable the firewall and allow only needed ports.
5. Remove unused packages and services.
6. Check permissions of sensitive files.
7. Review logs regularly (and consider \`fail2ban\`).

> **Practice:** view the SSH service journal and the login history.`,
        practice: [
          { command: "journalctl -u ssh", explanation: "SSH service log" },
          { command: "last", explanation: "Login history" },
          { command: "lastlog", explanation: "Last login per user" },
          { command: "sudo apt install -y fail2ban", explanation: "Ban brute-force attackers" },
        ],
        checks: [ran("journal", "^journalctl", "Use journalctl"), ran("last", "^last", "Check login history")],
      },
    ],
  },
];
