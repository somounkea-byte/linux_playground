import type { QuestionDefinition } from "../../src/lib/quiz-grading";

export type SeedQuestion = QuestionDefinition & { prompt: string; explanation?: string; points?: number };

export interface SeedQuiz {
  slug: string;
  title: string;
  description: string;
  module: string;
  timeLimitSec?: number;
  questionsPerAttempt?: number;
  questions: SeedQuestion[];
}

const mc = (prompt: string, choices: string[], correct: number | number[], explanation?: string): SeedQuestion => ({
  type: "MULTIPLE_CHOICE",
  prompt,
  options: { choices, multiple: Array.isArray(correct) },
  answer: { correct: Array.isArray(correct) ? correct : [correct] },
  explanation,
});
const tf = (prompt: string, value: boolean, explanation?: string): SeedQuestion => ({ type: "TRUE_FALSE", prompt, options: {}, answer: { value }, explanation });
const fill = (prompt: string, accepted: string[], explanation?: string, placeholder?: string): SeedQuestion => ({ type: "FILL_BLANK", prompt, options: { placeholder }, answer: { accepted }, explanation });
const perm = (prompt: string, accepted: string[], explanation?: string): SeedQuestion => ({ type: "PERMISSION", prompt, options: { format: "numeric" }, answer: { accepted }, explanation });
const predict = (prompt: string, command: string, choices: string[], correct: number, explanation?: string): SeedQuestion => ({ type: "PREDICT_OUTPUT", prompt, options: { command, choices }, answer: { correct: [correct] }, explanation });
const match = (prompt: string, pairs: [string, string][], explanation?: string): SeedQuestion => ({
  type: "MATCHING",
  prompt,
  options: { left: pairs.map((p) => p[0]), right: pairs.map((p) => p[1]) },
  answer: { pairs: pairs.map((_, i) => i) },
  explanation,
  points: 2,
});

export const quizzes: SeedQuiz[] = [
  {
    slug: "linux-fundamentals-quiz",
    title: "Linux Fundamentals Quiz",
    description: "Kernel, distributions, shell and command syntax.",
    module: "linux-fundamentals",
    timeLimitSec: 600,
    questions: [
      mc("What is Linux, strictly speaking?", ["A desktop environment", "An operating-system kernel", "A programming language", "A web browser"], 1, "Linux is the kernel; together with GNU tools it forms a complete OS."),
      mc("Which package manager does Ubuntu use?", ["dnf", "pacman", "apt", "zypper"], 2),
      tf("Linux file names are case sensitive: File.txt and file.txt are different files.", true),
      fill("Which command prints the name of the user you are logged in as?", ["whoami"], undefined, "command"),
      mc("In the prompt `student@linux-playground:~$`, what does `~` mean?", ["The root directory", "Your home directory", "The previous directory", "A temporary directory"], 1),
      mc("What does the `#` at the end of a prompt indicate?", ["You are root", "A comment", "The shell is busy", "A syntax error"], 0),
      predict("What does this print after a successful command?", "ls / > /dev/null; echo $?", ["1", "0", "true", "nothing"], 1, "Exit status 0 means success."),
      match("Match each command with what it shows.", [
        ["uname -r", "Kernel release"],
        ["hostname", "Machine name"],
        ["pwd", "Current directory"],
        ["date", "Current date and time"],
      ]),
    ],
  },
  {
    slug: "basic-commands-quiz",
    title: "Basic Commands Quiz",
    description: "Navigation, files, viewing and searching.",
    module: "basic-commands",
    timeLimitSec: 600,
    questions: [
      mc("Which command lists hidden files too?", ["ls -l", "ls -a", "ls -h", "ls -R"], 1),
      mc("How do you copy a directory and its contents?", ["cp dir new", "cp -r dir new", "mv -r dir new", "copy dir new"], 1),
      fill("Complete: `mkdir __ a/b/c` creates all missing parent directories.", ["-p", "--parents"]),
      tf("`rm` moves files to a recycle bin so they can be restored.", false, "rm deletes permanently."),
      mc("Which command shows the last 20 lines of a file?", ["head -n 20 file", "tail -n 20 file", "cat -20 file", "less +20 file"], 1),
      predict("What is the output?", "echo one two three | wc -w", ["1", "3", "13", "one two three"], 1),
      mc("Which commands search INSIDE files for text? (choose all that apply)", ["grep", "find -name", "grep -r", "locate"], [0, 2]),
      match("Match the operator with its effect.", [
        [">", "Overwrite a file with output"],
        [">>", "Append output to a file"],
        ["|", "Send output to another command"],
        ["2>/dev/null", "Discard error messages"],
      ]),
      { type: "PRACTICAL", prompt: "Practical: create the directory `~/quiz` containing a file `answer.txt` with the text `linux rocks`.", options: { task: "Type the commands you would run, one per line." }, answer: { checks: [{ id: "f", type: "file_contains", path: "/home/student/quiz/answer.txt", text: "linux rocks", description: "~/quiz/answer.txt contains 'linux rocks'" }] }, points: 2 },
    ],
  },
  {
    slug: "file-system-quiz",
    title: "File System Quiz",
    description: "The directory tree, paths and links.",
    module: "file-system",
    questions: [
      match("Match each directory with its purpose.", [
        ["/etc", "Configuration files"],
        ["/var/log", "Log files"],
        ["/home", "Users' personal directories"],
        ["/tmp", "Temporary files"],
        ["/dev", "Device files"],
      ]),
      mc("Which is an absolute path?", ["documents/notes.txt", "../etc/hosts", "/etc/hosts", "./run.sh"], 2),
      tf("Files whose names start with a dot are hidden from a plain `ls`.", true),
      fill("Which command creates a symbolic link? (just the command and option)", ["ln -s"]),
      mc("What does `..` refer to?", ["The current directory", "The parent directory", "The home directory", "The root directory"], 1),
      predict("You are in /home/student. What does this print?", "cd ../../etc; pwd", ["/etc", "/home/etc", "/home/student/etc", "an error"], 0),
      mc("Which tar options CREATE a gzip-compressed archive?", ["-xzf", "-tzf", "-czf", "-rzf"], 2),
    ],
  },
  {
    slug: "file-permissions-quiz",
    title: "File Permissions Quiz",
    description: "rwx, numeric modes, chmod and ownership.",
    module: "file-permissions",
    timeLimitSec: 600,
    questions: [
      perm("Convert `rwxr-xr--` to numeric notation.", ["754"]),
      perm("Convert `rw-r-----` to numeric notation.", ["640"]),
      perm("What numeric mode gives the owner read/write and nobody else any access?", ["600"]),
      mc("What does `chmod g-w file` do?", ["Gives the group write permission", "Removes write permission from the group", "Removes write from everyone", "Changes the group"], 1),
      mc("Which permission lets you `cd` into a directory?", ["r", "w", "x", "s"], 2),
      tf("Any user can change the permissions of any file they can read.", false, "Only the owner or root can chmod a file."),
      fill("Which command changes the owner of a file?", ["chown"]),
      predict("What does ls show for a directory after `chmod 1777 dir`?", "chmod 1777 dir; ls -ld dir", ["drwxrwxrwx", "drwxrwxrwt", "drwsrwxrwx", "drwxrwsrwx"], 1, "The sticky bit shows as t in the others execute position."),
      match("Match the special bit with its effect.", [
        ["Sticky bit", "Only owners can delete their files in the directory"],
        ["setuid", "Program runs with the file owner's privileges"],
        ["setgid on a directory", "New files inherit the directory's group"],
      ]),
      { type: "PRACTICAL", prompt: "Practical: make `~/projects/hello.sh` executable by its owner only (mode 700).", options: { task: "Type the commands you would run, one per line." }, answer: { checks: [{ id: "m", type: "file_mode", path: "/home/student/projects/hello.sh", mode: "700", description: "hello.sh has mode 700" }] }, points: 2 },
    ],
  },
  {
    slug: "users-groups-quiz",
    title: "Users and Groups Quiz",
    description: "UIDs, groups and account management.",
    module: "users-groups",
    timeLimitSec: 600,
    questions: [
      mc("What is root's UID?", ["1", "1000", "0", "65534"], 2),
      mc("Which file stores hashed passwords?", ["/etc/passwd", "/etc/shadow", "/etc/group", "/etc/sudoers"], 1),
      fill("Complete the command that adds john to the developers group without removing his other groups: `sudo usermod ___ developers john`", ["-aG", "-a -G", "-Ga"]),
      tf("`useradd john` creates /home/john by default on Ubuntu.", false, "You need -m (or use adduser)."),
      mc("Which command removes a user AND their home directory?", ["userdel john", "userdel -r john", "rm -r /home/john", "usermod -L john"], 1),
      predict("What does this print?", "getent group sudo", ["sudo:x:27:student", "student:x:1000:", "27", "sudo"], 0),
      match("Match each command with its purpose.", [
        ["groupadd", "Create a group"],
        ["passwd", "Change a password"],
        ["id", "Show UID, GID and groups"],
        ["su -", "Switch to another user"],
      ]),
      { type: "PRACTICAL", prompt: "Practical: create the group `qa` and a user `tess` (with a home directory) who is a member of `qa`.", options: { task: "Type the commands you would run, one per line (sudo will be answered automatically)." }, answer: { checks: [{ id: "g", type: "group_exists", group: "qa", description: "group qa exists" }, { id: "u", type: "user_exists", username: "tess", homeExists: true, description: "tess exists with a home" }, { id: "m", type: "user_in_group", username: "tess", group: "qa", description: "tess is in qa" }] }, points: 3 },
    ],
  },
  {
    slug: "process-management-quiz",
    title: "Process Management Quiz",
    description: "PIDs, signals, jobs and priorities.",
    module: "process-management",
    questions: [
      mc("Which process always has PID 1?", ["bash", "init/systemd", "kthreadd", "sshd"], 1),
      mc("Which signal cannot be caught or ignored?", ["SIGTERM (15)", "SIGHUP (1)", "SIGKILL (9)", "SIGINT (2)"], 2),
      fill("Which character runs a command in the background?", ["&"]),
      tf("A normal user can kill processes owned by other users.", false),
      mc("Which nice value means the HIGHEST priority?", ["19", "0", "-20", "20"], 2),
      match("Match the command with its purpose.", [
        ["ps aux", "List all processes"],
        ["jobs", "List background jobs of this shell"],
        ["kill -9 PID", "Force a process to stop"],
        ["top", "Live CPU/memory overview"],
      ]),
    ],
  },
  {
    slug: "networking-quiz",
    title: "Networking Quiz",
    description: "Addresses, routes, DNS and ports.",
    module: "networking",
    questions: [
      mc("What is 127.0.0.1?", ["The default gateway", "The loopback address", "A public DNS server", "A broadcast address"], 1),
      fill("Which command shows the IP addresses of all interfaces (modern tool, short form)?", ["ip a", "ip addr", "ip address", "ip addr show"]),
      mc("Which file maps host names to IP addresses locally?", ["/etc/hostname", "/etc/hosts", "/etc/resolv.conf", "/etc/network"], 1),
      match("Match the port with its usual service.", [
        ["22", "SSH"],
        ["80", "HTTP"],
        ["443", "HTTPS"],
        ["53", "DNS"],
      ]),
      tf("`ss -tuln` lists listening TCP and UDP ports.", true),
      mc("Which command fetches only the HTTP headers of a page?", ["curl -o", "curl -I", "wget -q", "ping -c 1"], 1),
    ],
  },
  {
    slug: "package-management-quiz",
    title: "Package Management Quiz",
    description: "apt, dpkg and services.",
    module: "package-management",
    questions: [
      mc("What does `sudo apt update` do?", ["Upgrades all packages", "Downloads the latest package lists", "Updates the kernel", "Removes old packages"], 1),
      mc("Which command removes a package together with its configuration files?", ["apt remove", "apt purge", "apt autoremove", "dpkg -l"], 1),
      fill("Which dpkg option lists installed packages?", ["-l", "--list"]),
      tf("You need root privileges to install packages with apt.", true),
      mc("Which command makes a service start automatically at boot?", ["systemctl start", "systemctl enable", "systemctl status", "service restart"], 1),
      { type: "PRACTICAL", prompt: "Practical: install the `tree` package.", options: { task: "Type the commands you would run, one per line." }, answer: { checks: [{ id: "t", type: "package_installed", name: "tree", description: "tree is installed" }] }, points: 2 },
    ],
  },
  {
    slug: "storage-management-quiz",
    title: "Storage Management Quiz",
    description: "Disks, file systems and usage.",
    module: "storage-management",
    questions: [
      mc("Which command shows free space on mounted file systems?", ["du -sh", "df -h", "free -h", "lsblk"], 1),
      mc("Which command shows how much space a directory uses?", ["df", "du", "mount", "blkid"], 1),
      fill("Which command lists block devices as a tree?", ["lsblk"]),
      tf("Running mkfs on a disk erases the data on it.", true),
      mc("In `free -h`, which column best shows how much memory new programs can use?", ["used", "free", "buff/cache", "available"], 3),
    ],
  },
  {
    slug: "shell-scripting-quiz",
    title: "Shell Scripting Quiz",
    description: "Variables, conditions, loops and functions.",
    module: "shell-scripting",
    timeLimitSec: 900,
    questions: [
      mc("What is the first line `#!/bin/bash` called?", ["A comment", "The shebang", "A variable", "The header"], 1),
      predict("What does this print?", 'name="Linux"; echo "Hello $name"', ["Hello $name", "Hello Linux", "Hello", "name"], 1),
      predict("What does this print?", "x=5; if [ $x -gt 3 ]; then echo big; else echo small; fi", ["big", "small", "5", "error"], 0),
      fill("Which variable holds the number of arguments passed to a script?", ["$#"]),
      predict("What does this print?", "for i in 1 2 3; do echo -n $i; done", ["123", "1 2 3", "3", "i i i"], 0),
      mc("Which test is true when a file exists AND is a regular file?", ["-d", "-f", "-x", "-z"], 1),
      tf("Variables declared with `local` are visible outside the function.", false),
      match("Match the expansion with its result when f=report.txt.", [
        ["${f%.txt}", "report"],
        ["${#f}", "10"],
        ["${f^^}", "REPORT.TXT"],
      ]),
      { type: "PRACTICAL", prompt: "Practical: create an executable script `~/count.sh` that prints the numbers 1 to 3, one per line.", options: { task: "Type the commands you would run, one per line." }, answer: { checks: [{ id: "c", type: "command_output", command: "su - student -c /home/student/count.sh", equals: "1\n2\n3", description: "~/count.sh is executable and prints 1, 2, 3" }] }, points: 3 },
    ],
  },
  {
    slug: "linux-security-quiz",
    title: "Linux Security Quiz",
    description: "sudo, SSH, firewall and logs.",
    module: "linux-security",
    questions: [
      mc("Where are sudo and SSH login events recorded on Ubuntu?", ["/var/log/syslog", "/var/log/auth.log", "/etc/sudoers", "/var/log/dpkg.log"], 1),
      mc("What should you do BEFORE enabling ufw on a remote server?", ["Reboot", "Allow SSH", "Disable SSH", "Install nginx"], 1),
      perm("What mode should an SSH private key have?", ["600", "400"]),
      tf("You should log in as root over SSH for daily administration.", false),
      fill("Which command shows the systemd journal?", ["journalctl"]),
      mc("Which file holds the SSH server configuration?", ["/etc/ssh/ssh_config", "/etc/ssh/sshd_config", "~/.ssh/config", "/etc/sshd"], 1),
      { type: "PRACTICAL", prompt: "Practical: allow SSH in the firewall and enable it.", options: { task: "Type the commands you would run, one per line (prompts are answered automatically)." }, answer: { checks: [{ id: "r", type: "firewall_rule", port: "22", description: "SSH allowed" }, { id: "e", type: "firewall_enabled", enabled: true, description: "firewall enabled" }] }, points: 2 },
    ],
  },
];
