import { ran, type SeedModule } from "./types";

export const modulesPart1: SeedModule[] = [
  {
    slug: "linux-fundamentals",
    title: "Linux Fundamentals",
    description: "What Linux is, where it runs, how distributions like Ubuntu are built, and how to talk to it through the terminal.",
    icon: "book-open",
    lessons: [
      {
        slug: "what-is-linux",
        title: "What is Linux?",
        summary: "The kernel, the operating system and why Linux powers most of the internet.",
        minutes: 8,
        content: `## Linux in one sentence

**Linux** is a free, open-source operating-system *kernel* first released by Linus Torvalds in 1991. Combined with tools from the GNU project and thousands of other programs, it forms a complete operating system often called **GNU/Linux**.

## Where Linux runs

- **Servers** – the vast majority of web servers and cloud machines run Linux.
- **Phones** – Android is built on the Linux kernel.
- **Embedded devices** – routers, TVs, cars, smart fridges.
- **Supercomputers** – every one of the top 500 runs Linux.
- **Desktops** – Ubuntu, Fedora, Linux Mint and more.

## Why administrators love it

| Feature | Why it matters |
|---|---|
| Open source | You can read and change the code |
| Stable | Servers run for years without a reboot |
| Secure | Strong permission model and fast security fixes |
| Scriptable | Everything can be automated from the command line |

## Your Linux Playground machine

The terminal on the right is connected to **your own simulated Ubuntu 24.04 machine**. Nothing you type can harm a real computer, and your files are saved when you log out.

> **Try it:** run \`uname -a\` to see the kernel version and \`cat /etc/os-release\` to see which distribution you are using.`,
        practice: [
          { command: "uname -a", explanation: "Print kernel name, version and architecture" },
          { command: "cat /etc/os-release", explanation: "Show the distribution name and version" },
          { command: "hostnamectl", explanation: "Summary of this machine" },
        ],
        checks: [ran("uname", "^uname\\b", "Run uname to inspect the kernel"), ran("osrel", "os-release", "Read /etc/os-release")],
      },
      {
        slug: "distributions-and-ubuntu",
        title: "Distributions and Ubuntu",
        summary: "Debian, Ubuntu, Fedora, Arch... what a distribution is and why we use Ubuntu.",
        minutes: 7,
        content: `## What is a distribution?

A **distribution** ("distro") packages the Linux kernel together with a package manager, system tools, default configuration and often a desktop. Popular families:

| Family | Examples | Package manager |
|---|---|---|
| Debian | Debian, **Ubuntu**, Linux Mint | \`apt\` / \`dpkg\` |
| Red Hat | RHEL, Fedora, Rocky, AlmaLinux | \`dnf\` / \`rpm\` |
| Arch | Arch Linux, Manjaro | \`pacman\` |
| SUSE | openSUSE, SLES | \`zypper\` |

## Ubuntu

**Ubuntu** is published by Canonical every six months, with a **Long Term Support (LTS)** release every two years supported for at least five years. Version numbers are \`YY.MM\`: *24.04* was released in April 2024 and its codename is **noble**.

Ubuntu is the most popular distribution for cloud servers, which is why Linux Playground simulates it.

> **Try it:** \`lsb_release -a\` prints the release details. Notice that the message *No LSB modules are available.* goes to **standard error** – we will learn about that later.`,
        practice: [
          { command: "lsb_release -a", explanation: "Distribution, release and codename" },
          { command: "cat /etc/lsb-release", explanation: "The same information stored in a file" },
        ],
        checks: [ran("lsb", "lsb_release|lsb-release", "Find out which Ubuntu release you are using")],
      },
      {
        slug: "terminal-and-shell",
        title: "The Terminal and the Shell",
        summary: "Terminal vs shell vs command line, and how to read the prompt.",
        minutes: 8,
        content: `## Terminal vs shell

- The **terminal** (terminal emulator) is the window that shows text and sends your key presses.
- The **shell** is the program that reads your commands, runs them and prints the results. Ubuntu's default shell is **bash** (Bourne-Again SHell).

## Reading the prompt

\`\`\`
student@linux-playground:~$
\`\`\`

| Part | Meaning |
|---|---|
| \`student\` | the user you are logged in as |
| \`linux-playground\` | the machine (host) name |
| \`~\` | the current directory (\`~\` = your home directory) |
| \`$\` | you are a normal user (\`#\` means **root**) |

## Useful keys

| Key | Action |
|---|---|
| **Tab** | auto-complete commands and file names |
| **↑ / ↓** | browse your command history |
| **Ctrl+C** | cancel the current line |
| **Ctrl+L** | clear the screen |
| **Ctrl+A / Ctrl+E** | jump to the start / end of the line |

> **Try it:** run \`whoami\`, \`hostname\` and \`echo $SHELL\`. Then type \`who\` and press Tab twice.`,
        practice: [
          { command: "whoami", explanation: "Which user am I?" },
          { command: "hostname", explanation: "Which machine am I on?" },
          { command: "echo $SHELL", explanation: "Which shell is my login shell?" },
          { command: "date", explanation: "Current date and time" },
        ],
        checks: [ran("whoami", "^whoami", "Run whoami"), ran("hostname", "^hostname", "Run hostname")],
      },
      {
        slug: "architecture",
        title: "Basic Linux Architecture",
        summary: "Hardware, kernel, shell and applications – the layers of a Linux system.",
        minutes: 7,
        content: `## The layers

\`\`\`
+---------------------------------+
|  Applications (nginx, vim, ...) |
+---------------------------------+
|  Shell (bash) & utilities       |
+---------------------------------+
|  System libraries (glibc)       |
+---------------------------------+
|  Kernel                         |
+---------------------------------+
|  Hardware (CPU, RAM, disks)     |
+---------------------------------+
\`\`\`

The **kernel** manages hardware, memory, processes and files. Programs never touch hardware directly: they ask the kernel through *system calls*.

## Everything is a file

Linux represents almost everything as a file: documents, directories, devices (\`/dev/sda\`), even information about running processes (\`/proc\`).

> **Try it:** look at the CPU with \`cat /proc/cpuinfo\` and the memory with \`cat /proc/meminfo\` – these "files" are generated by the kernel when you read them.`,
        practice: [
          { command: "cat /proc/cpuinfo | head -5", explanation: "CPU information from the kernel" },
          { command: "cat /proc/meminfo", explanation: "Memory information" },
          { command: "ls /dev", explanation: "Devices are files too" },
        ],
        checks: [ran("proc", "/proc/", "Read a file from /proc")],
      },
      {
        slug: "linux-vs-windows",
        title: "Linux vs Windows",
        summary: "Key differences every Windows user should know.",
        minutes: 6,
        content: `## Main differences

| Topic | Windows | Linux |
|---|---|---|
| Paths | \`C:\\Users\\Ana\\file.txt\` | \`/home/ana/file.txt\` |
| Separator | backslash \`\\\` | slash \`/\` |
| Case sensitive | no | **yes** – \`File.txt\` ≠ \`file.txt\` |
| Drives | \`C:\`, \`D:\` | one tree starting at \`/\`, disks are *mounted* |
| Admin | Administrator | **root** (use \`sudo\`) |
| Software | installers (.exe/.msi) | package manager (\`apt\`) |
| Executables | \`.exe\` extension | any file with the *execute* permission |

> **Try it:** create two files whose names only differ by case: \`touch Notes.txt notes.txt\` and list them with \`ls\`.`,
        practice: [
          { command: "touch Notes.txt notes.txt", explanation: "Two different files!" },
          { command: "ls", explanation: "Both appear" },
          { command: "rm Notes.txt notes.txt", explanation: "Clean up" },
        ],
        checks: [ran("case", "touch .*[Nn]otes", "Create files that differ only by case")],
      },
      {
        slug: "command-syntax",
        title: "Command Syntax",
        summary: "Commands, options and arguments – and how to get help.",
        minutes: 9,
        content: `## Anatomy of a command

\`\`\`
ls   -l -a   /etc
│    │       └── argument (what to work on)
│    └────────── options (how to do it)
└─────────────── command (what to do)
\`\`\`

- **Short options** start with one dash and can be combined: \`ls -la\` = \`ls -l -a\`.
- **Long options** start with two dashes: \`ls --all\`.
- **Arguments** are usually file names, users, packages...

## Getting help

| Command | What it shows |
|---|---|
| \`man ls\` | the full manual page |
| \`ls --help\` | a short usage summary |
| \`help cd\` | help for shell builtins |
| \`whatis ls\` | a one-line description |
| \`type cd\` | is it a builtin, alias or program? |

## Exit status

Every command returns an **exit status**: \`0\` means success, anything else is an error. The last status is stored in \`$?\`.

> **Try it:** run \`ls /nope\` then \`echo $?\`, and \`ls /\` then \`echo $?\`.`,
        practice: [
          { command: "man ls", explanation: "Read the manual" },
          { command: "ls -la /etc | head", explanation: "Combine options" },
          { command: "ls /nope; echo $?", explanation: "A failing command returns non-zero" },
          { command: "type cd ls", explanation: "Builtin vs alias" },
        ],
        checks: [ran("man", "^(man|help|whatis) ", "Read the help for a command"), ran("status", "\\$\\?", "Print an exit status with $?")],
      },
    ],
  },
  {
    slug: "basic-commands",
    title: "Basic Linux Commands",
    description: "The everyday toolkit: navigating, creating, copying, moving, viewing and searching files.",
    icon: "terminal",
    lessons: [
      {
        slug: "navigation",
        title: "Navigating: pwd, ls, cd",
        summary: "Find out where you are, look around and move between directories.",
        minutes: 10,
        content: `## Where am I? \`pwd\`

\`pwd\` (*print working directory*) shows your current directory.

## What is here? \`ls\`

| Command | Shows |
|---|---|
| \`ls\` | names of visible files |
| \`ls -l\` | long format: permissions, owner, size, date |
| \`ls -a\` | include hidden files (names starting with \`.\`) |
| \`ls -lh\` | human-readable sizes |
| \`ls -lt\` | newest first |

Colours help: **blue** = directory, **green** = executable, **cyan** = link.

## Moving around: \`cd\`

| Command | Goes to |
|---|---|
| \`cd /var/log\` | an absolute path |
| \`cd projects\` | a directory inside the current one |
| \`cd ..\` | the parent directory |
| \`cd\` or \`cd ~\` | your home directory |
| \`cd -\` | the previous directory |

> **Practice:** go to \`/var/log\`, list it in long format, return home with \`cd\`, and confirm with \`pwd\`.`,
        practice: [
          { command: "pwd", explanation: "Current directory" },
          { command: "ls -la", explanation: "Everything, in detail" },
          { command: "cd /var/log", explanation: "Absolute path" },
          { command: "cd -", explanation: "Back to where you were" },
        ],
        checks: [ran("pwd", "^pwd$", "Run pwd"), ran("lsl", "^ls .*-[a-zA-Z]*l", "List a directory in long format"), ran("cdlog", "^cd /var/log", "Visit /var/log")],
      },
      {
        slug: "creating-files-and-directories",
        title: "Creating: mkdir, touch, echo",
        summary: "Create directories and files, and write text into them.",
        minutes: 10,
        content: `## Directories

\`\`\`bash
mkdir notes               # one directory
mkdir -p work/2024/june   # create the whole path
mkdir -p site/{css,js,img}  # brace expansion: three directories
\`\`\`

## Files

\`touch file.txt\` creates an empty file (or updates the timestamp of an existing one).

## Writing text

\`\`\`bash
echo "Hello Linux" > hello.txt    # create / overwrite
echo "Second line" >> hello.txt   # append
cat hello.txt
\`\`\`

\`>\` **overwrites** a file – be careful! \`>>\` appends.

## Removing empty directories

\`rmdir\` only removes *empty* directories – a safe way to clean up.

> **Practice:** create \`~/practice/notes\` and a file \`~/practice/notes/todo.txt\` containing the line \`learn linux\`.`,
        practice: [
          { command: "mkdir -p ~/practice/notes", explanation: "Create nested directories" },
          { command: 'echo "learn linux" > ~/practice/notes/todo.txt', explanation: "Write a line to a file" },
          { command: "cat ~/practice/notes/todo.txt", explanation: "Check the content" },
        ],
        checks: [
          { id: "dir", type: "file_exists", path: "/home/student/practice/notes", kind: "dir", description: "Create ~/practice/notes" },
          { id: "todo", type: "file_contains", path: "/home/student/practice/notes/todo.txt", text: "learn linux", description: "todo.txt contains 'learn linux'" },
        ],
      },
      {
        slug: "copy-move-remove",
        title: "Managing: cp, mv, rm",
        summary: "Copy, rename, move and delete files and directories safely.",
        minutes: 12,
        content: `## Copy: \`cp\`

\`\`\`bash
cp report.txt report.bak        # copy a file
cp -r projects projects_backup  # copy a directory (recursive)
cp -i a.txt b.txt               # ask before overwriting
\`\`\`

## Move / rename: \`mv\`

\`\`\`bash
mv draft.txt final.txt     # rename
mv final.txt ~/documents/  # move into a directory
\`\`\`

## Remove: \`rm\`

\`\`\`bash
rm old.txt           # delete a file
rm -r old_folder     # delete a directory and its contents
rm -i *.log          # confirm each deletion
\`\`\`

> ⚠️ There is **no recycle bin** on the command line. \`rm\` is permanent. Linux Playground has a *Reset environment* button – real servers do not!

> **Practice:** copy \`~/documents/welcome.txt\` to \`~/practice/welcome.bak\`, then rename it to \`~/practice/welcome.old\`.`,
        practice: [
          { command: "mkdir -p ~/practice", explanation: "Make sure the folder exists" },
          { command: "cp ~/documents/welcome.txt ~/practice/welcome.bak", explanation: "Copy" },
          { command: "mv ~/practice/welcome.bak ~/practice/welcome.old", explanation: "Rename" },
          { command: "ls -l ~/practice", explanation: "Verify" },
        ],
        checks: [
          { id: "old", type: "file_exists", path: "/home/student/practice/welcome.old", kind: "file", description: "~/practice/welcome.old exists" },
          { id: "bak", type: "file_not_exists", path: "/home/student/practice/welcome.bak", description: "~/practice/welcome.bak was renamed (no longer exists)" },
          { id: "orig", type: "file_exists", path: "/home/student/documents/welcome.txt", description: "The original is still in ~/documents" },
        ],
      },
      {
        slug: "viewing-files",
        title: "Viewing: cat, less, head, tail",
        summary: "Read whole files, page through long ones, or look at just the start or end.",
        minutes: 8,
        content: `## Reading files

| Command | Use it for |
|---|---|
| \`cat file\` | print a whole (short) file |
| \`cat -n file\` | with line numbers |
| \`less file\` | page through a long file (\`q\` to quit on a real system) |
| \`head -n 5 file\` | the first 5 lines |
| \`tail -n 5 file\` | the last 5 lines |
| \`tail -f file\` | follow a growing log file |

Log files grow at the end, so administrators use \`tail\` constantly:

\`\`\`bash
sudo tail -n 20 /var/log/auth.log
\`\`\`

> **Practice:** show the first 3 lines of \`/etc/passwd\` and the last 2 lines of \`/etc/group\`.`,
        practice: [
          { command: "head -n 3 /etc/passwd", explanation: "Start of a file" },
          { command: "tail -n 2 /etc/group", explanation: "End of a file" },
          { command: "cat -n /etc/hostname", explanation: "With line numbers" },
        ],
        checks: [ran("head", "^head ", "Use head"), ran("tail", "^(sudo )?tail ", "Use tail")],
      },
      {
        slug: "history-and-help",
        title: "History, which and clear",
        summary: "Re-use commands, find where programs live and keep your screen tidy.",
        minutes: 6,
        content: `## Command history

- \`history\` lists your previous commands with numbers.
- \`!!\` repeats the last command – handy as \`sudo !!\` when you forgot sudo.
- \`!42\` runs command number 42.
- **↑ / ↓** browse history; **Ctrl+R** searches it on a real system.

## Where is that program?

\`\`\`bash
which ls       # /usr/bin/ls
type ls        # ls is aliased to 'ls --color=auto'
whereis bash   # binary and manual page
\`\`\`

## Clearing the screen

\`clear\` or **Ctrl+L**.

> **Practice:** run \`history\`, then repeat a command with \`!!\` and find \`ls\` with \`which\`.`,
        practice: [
          { command: "history", explanation: "Your previous commands" },
          { command: "which ls", explanation: "Location of the ls program" },
          { command: "!!", explanation: "Repeat the last command" },
        ],
        checks: [ran("hist", "^history", "Show your history"), ran("which", "^which ", "Locate a program with which")],
      },
      {
        slug: "find-and-grep",
        title: "Searching: find and grep",
        summary: "Find files by name, type, size or owner, and search inside files.",
        minutes: 12,
        content: `## \`find\` – search for files

\`\`\`bash
find ~ -name "*.txt"            # by name (quote wildcards!)
find /etc -type d -name "ssh*"  # directories only
find /var/log -size +1k         # bigger than 1 KiB
find / -user student 2>/dev/null  # owned by student, hide errors
find . -name "*.tmp" -delete    # find and delete
\`\`\`

## \`grep\` – search inside files

\`\`\`bash
grep student /etc/passwd        # lines containing 'student'
grep -i error /var/log/syslog   # ignore case
grep -rn "TODO" ~/projects      # recursive with line numbers
grep -v "^#" /etc/ssh/sshd_config  # lines NOT starting with #
grep -c bash /etc/passwd        # count matches
\`\`\`

## Pipes: combining commands

The pipe \`|\` sends the output of one command into the next:

\`\`\`bash
ps aux | grep sshd
cat /etc/passwd | cut -d: -f1 | sort
\`\`\`

> **Practice:** find all \`.sh\` files in your home directory, and count how many users have \`/bin/bash\` as their shell.`,
        practice: [
          { command: 'find ~ -name "*.sh"', explanation: "Find shell scripts" },
          { command: "grep -c /bin/bash /etc/passwd", explanation: "Count bash users" },
          { command: "grep -v '^#' /etc/ssh/sshd_config | grep -v '^$'", explanation: "Active config lines only" },
        ],
        checks: [ran("find", "^find ", "Search with find"), ran("grep", "grep ", "Search inside files with grep")],
      },
    ],
  },
  {
    slug: "file-system",
    title: "Linux File System",
    description: "The single directory tree, what lives in /etc, /var, /home and friends, paths, hidden files and links.",
    icon: "folder-tree",
    lessons: [
      {
        slug: "root-directory",
        title: "The Root Directory and the FHS",
        summary: "Everything starts at / – a tour of the Filesystem Hierarchy Standard.",
        minutes: 12,
        content: `## One tree

Linux has a single directory tree that starts at **/** (the *root directory*). Extra disks are *mounted* somewhere inside it.

| Directory | Contains |
|---|---|
| \`/bin\`, \`/usr/bin\` | programs for all users (\`ls\`, \`cp\`...) |
| \`/sbin\`, \`/usr/sbin\` | system administration programs |
| \`/etc\` | **configuration files** |
| \`/home\` | users' home directories |
| \`/root\` | the root user's home |
| \`/var\` | variable data: **logs** (\`/var/log\`), websites (\`/var/www\`), caches |
| \`/tmp\` | temporary files (anyone can write) |
| \`/dev\` | device files (disks, terminals) |
| \`/proc\` | live kernel and process information |
| \`/boot\` | the kernel and boot loader |
| \`/opt\` | optional third-party software |
| \`/mnt\`, \`/media\` | mount points for extra disks and USB drives |
| \`/lib\`, \`/usr/lib\` | shared libraries |

On modern Ubuntu \`/bin\`, \`/sbin\` and \`/lib\` are **symbolic links** into \`/usr\` – look at \`ls -l /\`.

> **Install \`tree\`** to see the structure: \`sudo apt install tree\` then \`tree -L 1 /\`.`,
        practice: [
          { command: "ls -l /", explanation: "The top of the tree" },
          { command: "ls /etc | head", explanation: "Configuration files" },
          { command: "sudo apt install -y tree", explanation: "Install the tree tool" },
          { command: "tree -L 1 /", explanation: "Visualise the first level" },
        ],
        checks: [ran("lsroot", "^ls .*/\\s*$|^ls -l /$|^ls /$", "List the root directory"), ran("etc", "/etc", "Explore /etc")],
      },
      {
        slug: "paths",
        title: "Absolute and Relative Paths",
        summary: "Two ways to name a file, plus the special names ., .. and ~.",
        minutes: 9,
        content: `## Absolute paths

Start with \`/\` and work from the root – they mean the same thing no matter where you are:

\`/home/student/documents/welcome.txt\`

## Relative paths

Start from the **current directory**:

| Path | Meaning |
|---|---|
| \`documents/welcome.txt\` | inside the current directory |
| \`./hello.sh\` | explicitly "here" (needed to run scripts) |
| \`../\` | the parent directory |
| \`../../etc\` | two levels up, then into etc |
| \`~/projects\` | inside your home directory |

> **Practice:** from \`/var/log\`, use a *relative* path to list \`/etc\`, then use \`cd ~/documents\` and \`cat\` the welcome file using a relative path.`,
        practice: [
          { command: "cd /var/log", explanation: "Start here" },
          { command: "ls ../../etc | head -3", explanation: "Relative path to /etc" },
          { command: "cd ~/documents && cat welcome.txt", explanation: "Relative path to a file" },
          { command: "realpath welcome.txt", explanation: "Turn it into an absolute path" },
        ],
        checks: [ran("rel", "\\.\\./", "Use .. in a path")],
      },
      {
        slug: "hidden-files",
        title: "Hidden Files and Dotfiles",
        summary: "Files that start with a dot, and the configuration files in your home directory.",
        minutes: 6,
        content: `## Hidden files

Any file whose name starts with **.** is hidden from a normal \`ls\`. Use \`ls -a\` to see them.

Your home directory contains several:

| File | Purpose |
|---|---|
| \`.bashrc\` | commands run when an interactive shell starts (aliases, prompt) |
| \`.profile\` | commands run at login |
| \`.bash_logout\` | commands run at logout |
| \`.ssh/\` | SSH keys and known hosts |

## Make your own alias

\`\`\`bash
echo "alias ll2='ls -lah'" >> ~/.bashrc
source ~/.bashrc
ll2
\`\`\`

> **Practice:** create a hidden file \`~/.secret_notes\` and confirm it only appears with \`ls -a\`.`,
        practice: [
          { command: "ls -a ~", explanation: "Reveal hidden files" },
          { command: "touch ~/.secret_notes", explanation: "Create a hidden file" },
          { command: "cat ~/.bashrc | grep alias", explanation: "Aliases defined at startup" },
        ],
        checks: [{ id: "hidden", type: "file_exists", path: "/home/student/.secret_notes", description: "Create ~/.secret_notes" }],
      },
      {
        slug: "links-and-file-info",
        title: "Links, stat and file",
        summary: "Symbolic links, detailed metadata and identifying file types.",
        minutes: 9,
        content: `## Symbolic links

A **symbolic link** is a shortcut that points to another path:

\`\`\`bash
ln -s /var/log ~/logs
ls -l ~/logs      # logs -> /var/log
cd ~/logs
\`\`\`

## Metadata with \`stat\`

\`stat file\` shows size, permissions (in octal and symbolic form), owner, group, and timestamps.

## What kind of file? \`file\`

Linux does not rely on extensions. \`file\` looks at the content:

\`\`\`bash
file ~/projects/hello.sh   # Bourne-Again shell script, ASCII text
file /usr/bin/ls           # ELF 64-bit LSB pie executable
\`\`\`

> **Practice:** create a link \`~/logs\` pointing to \`/var/log\`.`,
        practice: [
          { command: "ln -s /var/log ~/logs", explanation: "Create a shortcut" },
          { command: "ls -l ~/logs", explanation: "See where it points" },
          { command: "stat ~/documents/welcome.txt", explanation: "Detailed metadata" },
          { command: "file ~/projects/hello.sh /usr/bin/ls", explanation: "Identify file types" },
        ],
        checks: [{ id: "link", type: "file_exists", path: "/home/student/logs", kind: "symlink", description: "~/logs is a symbolic link" }],
      },
      {
        slug: "archives",
        title: "Archives and Compression",
        summary: "Bundle directories with tar and compress them with gzip.",
        minutes: 8,
        content: `## tar

\`tar\` combines many files into one archive – perfect for backups:

\`\`\`bash
tar -czvf backup.tar.gz projects/   # c=create z=gzip v=verbose f=file
tar -tzvf backup.tar.gz             # t=list contents
tar -xzvf backup.tar.gz -C /tmp     # x=extract into /tmp
\`\`\`

Remember: **c**reate, e**x**tract, lis**t** – always with **f**ile.

## gzip

\`gzip big.log\` → \`big.log.gz\`, \`gunzip big.log.gz\` restores it.

> **Practice:** create \`~/backup.tar.gz\` containing your \`documents\` directory.`,
        practice: [
          { command: "tar -czvf ~/backup.tar.gz -C ~ documents", explanation: "Create a compressed archive" },
          { command: "tar -tzvf ~/backup.tar.gz", explanation: "List what is inside" },
        ],
        checks: [{ id: "tar", type: "command_output", command: "tar -tzf /home/student/backup.tar.gz", contains: "documents/welcome.txt", description: "~/backup.tar.gz contains documents/welcome.txt" }],
      },
    ],
  },
  {
    slug: "file-permissions",
    title: "File Permissions",
    description: "Read, write and execute for owner, group and others – in symbolic and numeric form – with chmod, chown and chgrp.",
    icon: "shield",
    lessons: [
      {
        slug: "permission-types",
        title: "Reading Permissions",
        summary: "Decode the rwxr-xr-x string in ls -l output.",
        minutes: 10,
        content: `## The permission string

\`\`\`
-rwxr-xr--  1 student developers 120 Nov 12 08:30 deploy.sh
│└┬┘└┬┘└┬┘
│ │  │  └── others  (everyone else)   r--
│ │  └───── group   (developers)      r-x
│ └──────── owner   (student)         rwx
└────────── type: - file, d directory, l link
\`\`\`

## What r, w, x mean

| | On a **file** | On a **directory** |
|---|---|---|
| **r** read | view the content | list the names inside (\`ls\`) |
| **w** write | change the content | create, delete, rename entries |
| **x** execute | run it as a program | enter it (\`cd\`) and access files inside |

Linux checks permissions in order: if you are the **owner**, only the owner bits count; otherwise if you are in the **group**, the group bits count; otherwise the **others** bits.

> **Practice:** run \`ls -l /etc/passwd /etc/shadow\` and explain why you can read one but not the other.`,
        practice: [
          { command: "ls -l /etc/passwd /etc/shadow", explanation: "Compare permissions" },
          { command: "cat /etc/shadow", explanation: "Permission denied – shadow is not world-readable" },
          { command: "ls -ld /tmp /root", explanation: "Directory permissions" },
        ],
        checks: [ran("shadow", "/etc/shadow", "Inspect /etc/shadow")],
      },
      {
        slug: "numeric-permissions",
        title: "Numeric (Octal) Permissions",
        summary: "r=4, w=2, x=1 – turning rwxr-xr-x into 755.",
        minutes: 10,
        content: `## Values

| Permission | Value |
|---|---|
| r | 4 |
| w | 2 |
| x | 1 |

Add them up for each of owner, group and others:

\`\`\`
rwx = 4+2+1 = 7
r-x = 4+0+1 = 5
r-- = 4+0+0 = 4
\`\`\`

So \`rwxr-xr--\` = **754**.

## Common modes

| Mode | Meaning | Typical use |
|---|---|---|
| 644 | rw-r--r-- | normal files |
| 600 | rw------- | private files, SSH keys |
| 755 | rwxr-xr-x | scripts, directories |
| 700 | rwx------ | private directories |
| 770 | rwxrwx--- | team directories |
| 777 | rwxrwxrwx | ⚠️ everyone can change it – avoid |

Use the **permission calculator** below to experiment.

> **Practice:** create \`~/practice/report.txt\` and give it mode **640**.`,
        practice: [
          { command: "mkdir -p ~/practice && touch ~/practice/report.txt", explanation: "Create the file" },
          { command: "chmod 640 ~/practice/report.txt", explanation: "rw-r-----" },
          { command: "stat -c '%a %A %n' ~/practice/report.txt", explanation: "Show octal and symbolic mode" },
        ],
        checks: [{ id: "mode", type: "file_mode", path: "/home/student/practice/report.txt", mode: "640", description: "~/practice/report.txt has mode 640" }],
      },
      {
        slug: "chmod",
        title: "Changing Permissions with chmod",
        summary: "Numeric and symbolic chmod, making scripts executable.",
        minutes: 12,
        content: `## Numeric

\`\`\`bash
chmod 755 script.sh
chmod 600 private.txt
chmod -R 750 project/   # recursive
\`\`\`

## Symbolic

\`chmod WHO OPERATOR PERMISSIONS file\`

- **who**: \`u\` owner, \`g\` group, \`o\` others, \`a\` all
- **operator**: \`+\` add, \`-\` remove, \`=\` set exactly

\`\`\`bash
chmod u+x hello.sh     # owner can execute
chmod g-w doc.txt      # group can no longer write
chmod o+r notes.txt    # others can read
chmod a+r file.txt     # everyone can read
chmod u=rwx,g=rx,o= dir
\`\`\`

## Making a script runnable

\`\`\`bash
./hello.sh            # bash: ./hello.sh: Permission denied
chmod +x hello.sh
./hello.sh            # works!
\`\`\`

Only the **owner** of a file (or root) can change its permissions.

> **Practice:** make \`~/projects/hello.sh\` executable and run it.`,
        practice: [
          { command: "cd ~/projects", explanation: "Go to the script" },
          { command: "./hello.sh", explanation: "Permission denied" },
          { command: "chmod u+x hello.sh", explanation: "Add execute for the owner" },
          { command: "./hello.sh", explanation: "Now it runs" },
        ],
        checks: [{ id: "exec", type: "command_output", command: "stat -c %A /home/student/projects/hello.sh", contains: "x", description: "hello.sh is executable" }],
      },
      {
        slug: "ownership",
        title: "Ownership: chown and chgrp",
        summary: "Change who owns a file and which group it belongs to.",
        minutes: 10,
        content: `## chown

Only **root** can give a file to another user:

\`\`\`bash
sudo chown john report.txt               # new owner
sudo chown john:developers report.txt    # owner and group
sudo chown :developers report.txt        # group only
sudo chown -R www-data:www-data /var/www/html   # recursive
\`\`\`

## chgrp

\`\`\`bash
sudo chgrp developers project/
\`\`\`

A normal user may \`chgrp\` their own file to a group **they belong to**.

## Why it matters

Web servers run as \`www-data\`; databases as \`mysql\`. Files must belong to the right user and group for the service to read or write them.

> **Practice:** create \`/srv/report.txt\` with sudo and give it to the \`www-data\` user and group.`,
        practice: [
          { command: "sudo touch /srv/report.txt", explanation: "Create a file owned by root" },
          { command: "sudo chown www-data:www-data /srv/report.txt", explanation: "Change owner and group" },
          { command: "ls -l /srv/report.txt", explanation: "Verify" },
        ],
        checks: [{ id: "own", type: "file_owner", path: "/srv/report.txt", user: "www-data", group: "www-data", description: "/srv/report.txt is owned by www-data:www-data" }],
      },
      {
        slug: "special-permissions",
        title: "Directories, umask and Special Bits",
        summary: "Directory permission rules, the default umask, sticky bit and setuid.",
        minutes: 11,
        content: `## Directory rules recap

- Without **x** you cannot \`cd\` into a directory or access anything inside.
- Without **r** you cannot list it.
- To delete a file you need **w+x on the directory**, not on the file!

## umask

New files start at 666 and directories at 777 minus the **umask**. With the Ubuntu default umask \`0002\`, new files are \`664\` and directories \`775\`.

\`\`\`bash
umask        # 0002
umask 027    # new files 640, directories 750
\`\`\`

## Special bits

| Bit | Example | Effect |
|---|---|---|
| sticky **t** | \`/tmp\` = drwxrwxrw**t** | users can only delete their own files |
| setuid **s** | \`/usr/bin/passwd\` = -rw**s**r-xr-x | runs with the owner's (root) privileges |
| setgid **s** on a dir | \`chmod g+s shared/\` | new files inherit the directory's group |

> **Practice:** create \`~/practice/shared\`, set the setgid bit on it and check with \`ls -ld\`.`,
        practice: [
          { command: "ls -ld /tmp", explanation: "The sticky bit" },
          { command: "ls -l /usr/bin/passwd", explanation: "The setuid bit" },
          { command: "mkdir -p ~/practice/shared && chmod g+s ~/practice/shared", explanation: "Set setgid on a directory" },
          { command: "ls -ld ~/practice/shared", explanation: "drwxrwsr-x" },
        ],
        checks: [{ id: "setgid", type: "command_output", command: "stat -c %A /home/student/practice/shared", contains: "s", description: "~/practice/shared has the setgid bit" }],
      },
    ],
  },
];
