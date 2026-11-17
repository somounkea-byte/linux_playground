import type { Check } from "../../src/lib/linux-engine/checks";

export interface SeedChallenge {
  slug: string;
  title: string;
  difficulty: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  category: string;
  summary: string;
  scenario: string;
  objectives: string[];
  instructions: string;
  setupScript: string;
  xpReward: number;
  hints: string[];
  solution: string;
  tasks: (DistributiveOmit<Check, "id" | "description"> & { description: string; hint?: string; points?: number })[];
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const H = "/home/student";

export const challenges: SeedChallenge[] = [
  {
    slug: "first-steps",
    title: "First Steps on Your Server",
    difficulty: "BEGINNER",
    category: "basic-commands",
    summary: "Create your first directory and note file.",
    scenario: "You just received SSH access to a brand-new Ubuntu server. Your mentor asks you to keep a work journal in your home directory.",
    objectives: ["Navigate the file system", "Create directories", "Write text into a file"],
    instructions: `1. Create a directory called \`journal\` in your home directory.
2. Inside it, create a file \`day1.txt\` containing the text \`I logged in to my first Linux server\`.
3. Create an empty file \`journal/ideas.txt\`.`,
    setupScript: "",
    xpReward: 50,
    hints: ["Use mkdir to create a directory.", "echo \"text\" > file writes text into a file.", "touch creates an empty file."],
    solution: `mkdir ~/journal
echo "I logged in to my first Linux server" > ~/journal/day1.txt
touch ~/journal/ideas.txt`,
    tasks: [
      { type: "file_exists", path: `${H}/journal`, kind: "dir", description: "~/journal exists" },
      { type: "file_contains", path: `${H}/journal/day1.txt`, text: "I logged in to my first Linux server", description: "day1.txt contains the journal sentence" },
      { type: "file_exists", path: `${H}/journal/ideas.txt`, kind: "file", description: "ideas.txt exists" },
    ],
  },
  {
    slug: "organize-downloads",
    title: "Organise the Downloads Folder",
    difficulty: "BEGINNER",
    category: "basic-commands",
    summary: "Sort a messy folder into sub-directories.",
    scenario: "Your downloads folder is a mess of photos, documents and music. Sort everything into folders so you can find things again.",
    objectives: ["Create several directories at once", "Move files with wildcards", "Verify with ls"],
    instructions: `In \`~/downloads\`:
1. Create the directories \`images\`, \`docs\` and \`music\`.
2. Move every \`.jpg\` and \`.png\` file into \`images\`.
3. Move every \`.pdf\` and \`.txt\` file into \`docs\`.
4. Move every \`.mp3\` file into \`music\`.
No loose files should remain directly in \`~/downloads\`.`,
    setupScript: `touch ${H}/downloads/holiday.jpg ${H}/downloads/cat.png ${H}/downloads/selfie.jpg
touch ${H}/downloads/report.pdf ${H}/downloads/notes.txt ${H}/downloads/invoice.pdf
touch ${H}/downloads/song1.mp3 ${H}/downloads/song2.mp3
chown -R student:student ${H}/downloads`,
    xpReward: 50,
    hints: ["mkdir can create several directories in one command: mkdir images docs music", "Wildcards: mv *.jpg *.png images/", "Check with ls -R"],
    solution: `cd ~/downloads
mkdir images docs music
mv *.jpg *.png images/
mv *.pdf *.txt docs/
mv *.mp3 music/
ls -R`,
    tasks: [
      { type: "file_exists", path: `${H}/downloads/images/holiday.jpg`, description: "Photos are in images/" },
      { type: "file_exists", path: `${H}/downloads/images/cat.png`, description: "PNG files are in images/" },
      { type: "file_exists", path: `${H}/downloads/docs/report.pdf`, description: "PDFs are in docs/" },
      { type: "file_exists", path: `${H}/downloads/docs/notes.txt`, description: "Text files are in docs/" },
      { type: "file_exists", path: `${H}/downloads/music/song2.mp3`, description: "Music is in music/" },
      { type: "command_output", command: `find ${H}/downloads -maxdepth 1 -type f`, equals: "", description: "No loose files remain in ~/downloads" },
    ],
  },
  {
    slug: "treasure-hunt",
    title: "File System Treasure Hunt",
    difficulty: "BEGINNER",
    category: "file-system",
    summary: "Use find, cat and ls -a to locate a hidden secret.",
    scenario: "A previous administrator hid the server's maintenance code somewhere under /opt. They left a clue: the file is hidden and its name contains the word 'code'.",
    objectives: ["Explore directories", "Find hidden files", "Use find by name"],
    instructions: `1. Find the hidden file under \`/opt\` whose name contains \`code\`.
2. Read it and copy the maintenance code it contains.
3. Save **only the code** into \`~/answer.txt\`.`,
    setupScript: `mkdir -p /opt/archive/2023/q4/misc /opt/archive/2024/old /opt/tools
touch /opt/archive/2023/readme.txt /opt/tools/install.sh
echo "Maintenance code: TUX-4096" > /opt/archive/2023/q4/misc/.maintenance_code
echo "nothing to see here" > /opt/archive/2024/old/notes.txt`,
    xpReward: 50,
    hints: ["Hidden files start with a dot. ls -a shows them.", "find /opt -name '*code*' searches by name, including hidden files.", "echo TUX-... > ~/answer.txt"],
    solution: `find /opt -name "*code*"
cat /opt/archive/2023/q4/misc/.maintenance_code
echo "TUX-4096" > ~/answer.txt`,
    tasks: [{ type: "command_output", command: `cat ${H}/answer.txt`, equals: "TUX-4096", description: "~/answer.txt contains exactly the maintenance code" }],
  },
  {
    slug: "make-it-executable",
    title: "Make the Script Run",
    difficulty: "BEGINNER",
    category: "file-permissions",
    summary: "Fix 'Permission denied' when running scripts.",
    scenario: "A colleague wrote ~/scripts/report.sh but when you run ./report.sh you get 'Permission denied'. Fix it so it runs, while keeping another file private.",
    objectives: ["Read permission strings", "Use chmod symbolically and numerically"],
    instructions: `1. Make \`~/scripts/report.sh\` executable for its owner (and readable/executable for everyone): mode **755**.
2. Make \`~/scripts/notes.txt\` readable and writable **only by you**: mode **600**.
3. Run the script to see its output.`,
    setupScript: `mkdir -p ${H}/scripts
printf '#!/bin/bash\\necho "Report generated on $(hostname)"\\n' > ${H}/scripts/report.sh
echo "private thoughts" > ${H}/scripts/notes.txt
chmod 644 ${H}/scripts/report.sh ${H}/scripts/notes.txt
chown -R student:student ${H}/scripts`,
    xpReward: 50,
    hints: ["ls -l shows the current permissions.", "chmod 755 file or chmod u+x,go+rx file", "600 = rw for owner only"],
    solution: `chmod 755 ~/scripts/report.sh
chmod 600 ~/scripts/notes.txt
~/scripts/report.sh`,
    tasks: [
      { type: "file_mode", path: `${H}/scripts/report.sh`, mode: "755", description: "report.sh has mode 755" },
      { type: "file_mode", path: `${H}/scripts/notes.txt`, mode: "600", description: "notes.txt has mode 600" },
      { type: "command_output", command: `su - student -c ${H}/scripts/report.sh`, contains: "Report generated", description: "The script runs successfully" },
    ],
  },
  {
    slug: "log-detective",
    title: "Log Detective",
    difficulty: "INTERMEDIATE",
    category: "basic-commands",
    summary: "Combine grep, wc, sort and uniq to analyse a log file.",
    scenario: "The web application is misbehaving. Management wants numbers: how many errors happened, and which IP address made the most requests.",
    objectives: ["Search logs with grep", "Count with wc", "Combine commands with pipes"],
    instructions: `The application log is \`/var/log/webapp.log\`.
1. Count the lines containing \`ERROR\` and write **just the number** to \`~/error_count.txt\`.
2. Save every \`ERROR\` line (in original order) to \`~/errors.log\`.
3. Find the IP address (first field) that appears most often and write it to \`~/top_ip.txt\`.`,
    setupScript: `printf '10.0.0.5 INFO GET /\\n10.0.0.7 ERROR timeout /api\\n10.0.0.5 INFO GET /login\\n10.0.0.9 WARN slow /api\\n10.0.0.5 ERROR db unavailable\\n10.0.0.7 INFO GET /\\n10.0.0.5 INFO POST /login\\n10.0.0.8 ERROR timeout /api\\n10.0.0.5 INFO GET /home\\n10.0.0.7 ERROR disk full\\n' > /var/log/webapp.log
chmod 644 /var/log/webapp.log`,
    xpReward: 100,
    hints: ["grep -c ERROR file counts matching lines.", "grep ERROR file > ~/errors.log", "cut -d' ' -f1 file | sort | uniq -c | sort -rn | head -1"],
    solution: `grep -c ERROR /var/log/webapp.log > ~/error_count.txt
grep ERROR /var/log/webapp.log > ~/errors.log
cut -d' ' -f1 /var/log/webapp.log | sort | uniq -c | sort -rn | head -1
echo 10.0.0.5 > ~/top_ip.txt`,
    tasks: [
      { type: "command_output", command: `cat ${H}/error_count.txt`, equals: "4", description: "~/error_count.txt contains the number of ERROR lines" },
      { type: "command_output", command: `cat ${H}/errors.log`, equals: "10.0.0.7 ERROR timeout /api\n10.0.0.5 ERROR db unavailable\n10.0.0.8 ERROR timeout /api\n10.0.0.7 ERROR disk full", description: "~/errors.log contains exactly the ERROR lines" },
      { type: "command_output", command: `cat ${H}/top_ip.txt`, equals: "10.0.0.5", description: "~/top_ip.txt contains the busiest IP" },
    ],
  },
  {
    slug: "backup-projects",
    title: "Back Up the Projects",
    difficulty: "INTERMEDIATE",
    category: "file-system",
    summary: "Create a compressed archive and protect it.",
    scenario: "Before a risky upgrade you must back up all project files and make sure the backup is not readable by other users.",
    objectives: ["Create tar.gz archives", "Verify archive contents", "Secure a file with chmod"],
    instructions: `1. Create \`/tmp/projects-backup.tar.gz\` containing your whole \`~/projects\` directory (paths should start with \`projects/\`).
2. Restrict the archive to mode **600**.
3. Create the directory \`~/restore\` and extract the archive into it.`,
    setupScript: `mkdir -p ${H}/projects/website ${H}/projects/api
echo "<h1>Hello</h1>" > ${H}/projects/website/index.html
echo "PORT=8080" > ${H}/projects/api/.env
chown -R student:student ${H}/projects`,
    xpReward: 100,
    hints: ["tar -czvf ARCHIVE -C ~ projects", "chmod 600 /tmp/projects-backup.tar.gz", "tar -xzvf ARCHIVE -C ~/restore"],
    solution: `tar -czvf /tmp/projects-backup.tar.gz -C ~ projects
chmod 600 /tmp/projects-backup.tar.gz
mkdir ~/restore
tar -xzvf /tmp/projects-backup.tar.gz -C ~/restore`,
    tasks: [
      { type: "command_output", command: "tar -tzf /tmp/projects-backup.tar.gz", contains: "projects/website/index.html", description: "The archive contains projects/website/index.html" },
      { type: "command_output", command: "tar -tzf /tmp/projects-backup.tar.gz", contains: "projects/api/.env", description: "Hidden files are included too" },
      { type: "file_mode", path: "/tmp/projects-backup.tar.gz", mode: "600", description: "The archive has mode 600" },
      { type: "file_exists", path: `${H}/restore/projects/website/index.html`, description: "The backup was extracted into ~/restore" },
    ],
  },
  {
    slug: "shared-project-folder",
    title: "Configure a Shared Project Folder",
    difficulty: "INTERMEDIATE",
    category: "users-groups",
    summary: "Users, a group and a team directory with the right permissions.",
    scenario: "You are a Linux administrator. Your development team needs a shared directory for project files that only team members can access.",
    objectives: ["Create users and groups", "Manage group membership", "Set group ownership and permissions"],
    instructions: `1. Create a group called \`developers\`.
2. Create a user called \`john\`.
3. Create a user called \`mary\`.
4. Add both users to \`developers\`.
5. Create \`/var/www/project\`.
6. Set the group owner of \`/var/www/project\` to \`developers\`.
7. Configure permissions so the owner and group have full access and others have none (**770**).`,
    setupScript: "",
    xpReward: 100,
    hints: ["sudo groupadd developers", "sudo useradd -m john, then sudo usermod -aG developers john", "sudo chgrp developers /var/www/project && sudo chmod 770 /var/www/project"],
    solution: `sudo groupadd developers
sudo useradd -m john
sudo useradd -m mary
sudo usermod -aG developers john
sudo usermod -aG developers mary
sudo mkdir -p /var/www/project
sudo chgrp developers /var/www/project
sudo chmod 770 /var/www/project`,
    tasks: [
      { type: "group_exists", group: "developers", description: "Group developers exists" },
      { type: "user_exists", username: "john", description: "User john exists" },
      { type: "user_exists", username: "mary", description: "User mary exists" },
      { type: "user_in_group", username: "john", group: "developers", description: "john is in developers" },
      { type: "user_in_group", username: "mary", group: "developers", description: "mary is in developers" },
      { type: "file_exists", path: "/var/www/project", kind: "dir", description: "/var/www/project exists" },
      { type: "file_owner", path: "/var/www/project", group: "developers", description: "Group owner is developers" },
      { type: "file_mode", path: "/var/www/project", mode: "770", description: "Permissions are 770" },
    ],
  },
  {
    slug: "user-onboarding",
    title: "Onboard the New Interns",
    difficulty: "INTERMEDIATE",
    category: "users-groups",
    summary: "Create accounts with the right shells, groups and status.",
    scenario: "Three interns start today. HR also asks you to disable the account of a contractor who left.",
    objectives: ["Create users with options", "Supplementary groups", "Lock accounts"],
    instructions: `1. Create the group \`interns\`.
2. Create users \`ana\` and \`ben\` with home directories, the **/bin/bash** shell and \`interns\` as a supplementary group.
3. Set a password for \`ana\`.
4. The existing user \`contractor\` must be **locked** (not deleted).
5. Add \`ben\` to the \`sudo\` group – he is the lead intern.`,
    setupScript: `useradd -m -s /bin/bash contractor
echo "contractor:temp123" | chpasswd`,
    xpReward: 100,
    hints: ["useradd -m -s /bin/bash -G interns ana", "passwd ana", "usermod -L contractor (or passwd -l)", "usermod -aG sudo ben"],
    solution: `sudo groupadd interns
sudo useradd -m -s /bin/bash -G interns ana
sudo useradd -m -s /bin/bash -G interns ben
sudo passwd ana
sudo usermod -L contractor
sudo usermod -aG sudo ben`,
    tasks: [
      { type: "group_exists", group: "interns", description: "Group interns exists" },
      { type: "user_exists", username: "ana", shell: "/bin/bash", homeExists: true, description: "ana exists with bash and a home" },
      { type: "user_exists", username: "ben", shell: "/bin/bash", homeExists: true, description: "ben exists with bash and a home" },
      { type: "user_in_group", username: "ana", group: "interns", description: "ana is in interns" },
      { type: "user_in_group", username: "ben", group: "interns", description: "ben is in interns" },
      { type: "user_has_password", username: "ana", description: "ana has a password" },
      { type: "user_locked", username: "contractor", locked: true, description: "contractor is locked" },
      { type: "user_exists", username: "contractor", description: "contractor was not deleted" },
      { type: "user_in_group", username: "ben", group: "sudo", description: "ben can use sudo" },
    ],
  },
  {
    slug: "web-server-setup",
    title: "Launch a Web Server",
    difficulty: "INTERMEDIATE",
    category: "package-management",
    summary: "Install nginx, publish a page and open the firewall.",
    scenario: "The marketing team needs a simple website online today. Install a web server, publish their page and make sure it survives a reboot.",
    objectives: ["Install packages with apt", "Manage services with systemctl", "Configure ufw"],
    instructions: `1. Install the \`nginx\` package.
2. Make sure nginx is **running** and **enabled** at boot.
3. Create \`/var/www/html/index.html\` containing \`Welcome to Linux Playground Corp\`.
4. Allow SSH and HTTP (port 80) in the firewall and enable it.
5. Check your page with \`curl http://localhost\`.`,
    setupScript: "",
    xpReward: 100,
    hints: ["sudo apt update && sudo apt install -y nginx", "systemctl status nginx; sudo systemctl enable nginx", "echo '...' | sudo tee /var/www/html/index.html", "sudo ufw allow OpenSSH; sudo ufw allow 80/tcp; sudo ufw enable"],
    solution: `sudo apt update
sudo apt install -y nginx
sudo systemctl enable --now nginx
echo "Welcome to Linux Playground Corp" | sudo tee /var/www/html/index.html
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw enable
curl http://localhost`,
    tasks: [
      { type: "package_installed", name: "nginx", description: "nginx is installed" },
      { type: "service_active", name: "nginx", active: true, description: "nginx is running" },
      { type: "service_enabled", name: "nginx", enabled: true, description: "nginx is enabled at boot" },
      { type: "command_output", command: "curl -s http://localhost", contains: "Welcome to Linux Playground Corp", description: "http://localhost serves the new page" },
      { type: "firewall_rule", port: "80", description: "HTTP is allowed in the firewall" },
      { type: "firewall_rule", port: "22", description: "SSH is allowed in the firewall" },
      { type: "firewall_enabled", enabled: true, description: "The firewall is enabled" },
    ],
  },
  {
    slug: "service-doctor",
    title: "Service Doctor",
    difficulty: "INTERMEDIATE",
    category: "process-management",
    summary: "Diagnose a port conflict and fix the services.",
    scenario: "Someone installed Apache on the server that should run nginx. nginx fails to start because port 80 is taken, and the SSH service was accidentally disabled.",
    objectives: ["Read service status and logs", "Stop/disable services", "Resolve port conflicts"],
    instructions: `1. Find out which service is using port 80.
2. Stop **and disable** apache2.
3. Start nginx and make sure it is enabled.
4. Re-enable the \`ssh\` service so it starts at boot.`,
    setupScript: `apt install -y apache2
apt install -y nginx
systemctl disable ssh`,
    xpReward: 100,
    hints: ["sudo ss -tulnp shows which process owns a port", "systemctl status nginx and journalctl -u nginx explain the failure", "sudo systemctl disable --now apache2"],
    solution: `sudo ss -tulnp | grep :80
systemctl status nginx
sudo systemctl disable --now apache2
sudo systemctl enable --now nginx
sudo systemctl enable ssh`,
    tasks: [
      { type: "service_active", name: "apache2", active: false, description: "apache2 is stopped" },
      { type: "service_enabled", name: "apache2", enabled: false, description: "apache2 is disabled" },
      { type: "service_active", name: "nginx", active: true, description: "nginx is running" },
      { type: "service_enabled", name: "nginx", enabled: true, description: "nginx is enabled" },
      { type: "service_enabled", name: "ssh", enabled: true, description: "ssh is enabled again" },
    ],
  },
  {
    slug: "troubleshoot-permissions",
    title: "Troubleshoot Application Permissions",
    difficulty: "ADVANCED",
    category: "file-permissions",
    summary: "Make an app user read its config and write its logs – and nothing more.",
    scenario: "The service account `appuser` cannot start the application: it fails to read /srv/app/config.ini and to write into /srv/app/logs. Meanwhile, the config file containing a database password is readable by everyone.",
    objectives: ["Diagnose permission errors", "Fix ownership", "Apply least privilege"],
    instructions: `Fix \`/srv/app\` so that:
1. The directory tree is owned by user \`appuser\` and group \`appgroup\`.
2. \`appuser\` can **read** \`/srv/app/config.ini\`, but **others cannot read it** (use 640).
3. \`appuser\` can create files in \`/srv/app/logs\`; others have no access to it (770).
4. \`student\` must still **not** be able to read the config file.
Test by running commands as appuser: \`sudo -u appuser cat /srv/app/config.ini\`.`,
    setupScript: `groupadd appgroup
useradd -r -g appgroup -s /usr/sbin/nologin appuser
mkdir -p /srv/app/logs
echo "port=8080" > /srv/app/config.ini
echo "db_password=SuperSecret!" >> /srv/app/config.ini
chmod 604 /srv/app/config.ini
chmod 755 /srv/app/logs
chown -R root:root /srv/app`,
    xpReward: 200,
    hints: ["sudo -u appuser touch /srv/app/logs/x reproduces the problem", "sudo chown -R appuser:appgroup /srv/app", "sudo chmod 640 /srv/app/config.ini; sudo chmod 770 /srv/app/logs"],
    solution: `sudo -u appuser cat /srv/app/config.ini        # Permission denied
sudo chown -R appuser:appgroup /srv/app
sudo chmod 640 /srv/app/config.ini
sudo chmod 770 /srv/app/logs
sudo -u appuser cat /srv/app/config.ini
sudo -u appuser touch /srv/app/logs/app.log`,
    tasks: [
      { type: "file_owner", path: "/srv/app/config.ini", user: "appuser", group: "appgroup", description: "config.ini is owned by appuser:appgroup" },
      { type: "file_owner", path: "/srv/app/logs", user: "appuser", group: "appgroup", description: "logs/ is owned by appuser:appgroup" },
      { type: "command_output", command: "cat /srv/app/config.ini", asUser: "appuser", contains: "port=8080", description: "appuser can read the config" },
      { type: "command_output", command: "touch /srv/app/logs/healthcheck.log && echo ok", asUser: "appuser", contains: "ok", description: "appuser can write into logs/" },
      { type: "command_output", command: "cat /srv/app/config.ini", asUser: "student", contains: "Permission denied", description: "student cannot read the config" },
      { type: "file_mode", path: "/srv/app/config.ini", mode: "640", description: "config.ini has mode 640" },
      { type: "file_mode", path: "/srv/app/logs", mode: "770", description: "logs/ has mode 770" },
    ],
  },
  {
    slug: "team-directories",
    title: "Multi-Team Directory Structure",
    difficulty: "ADVANCED",
    category: "users-groups",
    summary: "Several groups, setgid directories and cross-team access.",
    scenario: "Two teams – dev and ops – share a server. Each team gets a private directory where new files automatically belong to the team. Ops must also be able to read (but not change) the dev directory.",
    objectives: ["Manage multiple groups", "Use the setgid bit", "Design permissions for several teams"],
    instructions: `1. Create groups \`dev\` and \`ops\`.
2. Create users \`dana\` (dev), \`omar\` (ops) and \`lee\` (in **both** dev and ops).
3. Create \`/srv/teams/dev\` owned by group \`dev\` with mode **2770** (setgid, rwx for owner and group).
4. Create \`/srv/teams/ops\` owned by group \`ops\` with mode **2770**.
5. Create \`/srv/teams/shared\` owned by group \`ops\`, mode **2775**.
6. As \`dana\`, create \`/srv/teams/dev/plan.txt\` – it must automatically belong to group \`dev\`.`,
    setupScript: "",
    xpReward: 200,
    hints: ["chmod 2770 sets setgid plus rwxrwx---", "useradd -m -G dev,ops lee", "sudo -u dana touch /srv/teams/dev/plan.txt"],
    solution: `sudo groupadd dev
sudo groupadd ops
sudo useradd -m -G dev dana
sudo useradd -m -G ops omar
sudo useradd -m -G dev,ops lee
sudo mkdir -p /srv/teams/dev /srv/teams/ops /srv/teams/shared
sudo chgrp dev /srv/teams/dev && sudo chmod 2770 /srv/teams/dev
sudo chgrp ops /srv/teams/ops && sudo chmod 2770 /srv/teams/ops
sudo chgrp ops /srv/teams/shared && sudo chmod 2775 /srv/teams/shared
sudo -u dana touch /srv/teams/dev/plan.txt
ls -l /srv/teams/dev`,
    tasks: [
      { type: "user_in_group", username: "dana", group: "dev", description: "dana is in dev" },
      { type: "user_in_group", username: "omar", group: "ops", description: "omar is in ops" },
      { type: "user_in_group", username: "lee", group: "dev", description: "lee is in dev" },
      { type: "user_in_group", username: "lee", group: "ops", description: "lee is in ops" },
      { type: "file_mode", path: "/srv/teams/dev", mode: "2770", description: "/srv/teams/dev has mode 2770" },
      { type: "file_owner", path: "/srv/teams/dev", group: "dev", description: "/srv/teams/dev belongs to dev" },
      { type: "file_mode", path: "/srv/teams/ops", mode: "2770", description: "/srv/teams/ops has mode 2770" },
      { type: "file_owner", path: "/srv/teams/ops", group: "ops", description: "/srv/teams/ops belongs to ops" },
      { type: "file_mode", path: "/srv/teams/shared", mode: "2775", description: "/srv/teams/shared has mode 2775" },
      { type: "file_owner", path: "/srv/teams/dev/plan.txt", user: "dana", group: "dev", description: "plan.txt was created by dana and inherited group dev" },
      { type: "command_output", command: "ls /srv/teams/dev", asUser: "omar", contains: "Permission denied", description: "omar (ops only) cannot enter the dev directory" },
    ],
  },
  {
    slug: "harden-the-server",
    title: "Harden the Server",
    difficulty: "ADVANCED",
    category: "linux-security",
    summary: "Apply a security baseline: accounts, firewall, keys, permissions.",
    scenario: "An audit found several problems on this server. Fix every finding before the auditors come back.",
    objectives: ["Account hygiene", "Firewall configuration", "Secure permissions", "SSH keys"],
    instructions: `Audit findings:
1. The unused account \`tempuser\` must be **deleted together with its home directory**.
2. The account \`guest\` must be **locked**.
3. \`/home/student/.env\` contains secrets but is world-readable – make it **600**.
4. The firewall is off. Allow **only** SSH (22/tcp) and HTTPS (443/tcp), then enable it.
5. Generate an **ed25519** SSH key pair for \`student\` at \`~/.ssh/id_ed25519\`.
6. \`apache2\` was installed by mistake and exposes an unused web server – **remove** the package.`,
    setupScript: `useradd -m tempuser
useradd -m guest
echo "guest:guest" | chpasswd
echo "API_KEY=abc123" > /home/student/.env
chown student:student /home/student/.env
chmod 644 /home/student/.env
apt install -y apache2`,
    xpReward: 200,
    hints: ["sudo userdel -r tempuser", "sudo usermod -L guest", "chmod 600 ~/.env", "sudo ufw allow 22/tcp; sudo ufw allow 443/tcp; sudo ufw enable", "ssh-keygen -t ed25519", "sudo apt remove -y apache2"],
    solution: `sudo userdel -r tempuser
sudo usermod -L guest
chmod 600 ~/.env
sudo ufw allow 22/tcp
sudo ufw allow 443/tcp
sudo ufw enable
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519
sudo apt remove -y apache2`,
    tasks: [
      { type: "user_not_exists", username: "tempuser", description: "tempuser was deleted" },
      { type: "file_not_exists", path: "/home/tempuser", description: "tempuser's home was removed" },
      { type: "user_locked", username: "guest", locked: true, description: "guest is locked" },
      { type: "file_mode", path: `${H}/.env`, mode: "600", description: "~/.env has mode 600" },
      { type: "firewall_rule", port: "22", description: "SSH is allowed" },
      { type: "firewall_rule", port: "443", description: "HTTPS is allowed" },
      { type: "firewall_enabled", enabled: true, description: "The firewall is enabled" },
      { type: "file_exists", path: `${H}/.ssh/id_ed25519.pub`, description: "An ed25519 key pair exists" },
      { type: "package_not_installed", name: "apache2", description: "apache2 was removed" },
    ],
  },
  {
    slug: "provision-backup-disk",
    title: "Provision a Backup Disk",
    difficulty: "ADVANCED",
    category: "storage-management",
    summary: "Format, mount and secure a new disk for backups.",
    scenario: "A new 10 GB disk (/dev/sdb) was attached to the server for nightly backups. Prepare it and make it available to the backup operator only.",
    objectives: ["Identify disks", "Create a file system", "Mount and set ownership"],
    instructions: `1. Create an **ext4** file system on \`/dev/sdb\`.
2. Mount it on \`/backups\` (create the directory).
3. Create the user \`backupop\` (system or normal – your choice).
4. Make \`/backups\` owned by \`backupop\` with mode **700**.
5. As \`backupop\`, create \`/backups/README\`.`,
    setupScript: "",
    xpReward: 200,
    hints: ["lsblk shows the empty disk", "sudo mkfs.ext4 /dev/sdb", "sudo mkdir /backups && sudo mount /dev/sdb /backups", "sudo -u backupop touch /backups/README"],
    solution: `lsblk
sudo mkfs.ext4 /dev/sdb
sudo mkdir /backups
sudo mount /dev/sdb /backups
sudo useradd -m backupop
sudo chown backupop:backupop /backups
sudo chmod 700 /backups
sudo -u backupop touch /backups/README`,
    tasks: [
      { type: "disk_formatted", device: "/dev/sdb", fstype: "ext4", description: "/dev/sdb is formatted as ext4" },
      { type: "disk_mounted", device: "/dev/sdb", mountpoint: "/backups", description: "/dev/sdb is mounted on /backups" },
      { type: "user_exists", username: "backupop", description: "User backupop exists" },
      { type: "file_owner", path: "/backups", user: "backupop", description: "/backups is owned by backupop" },
      { type: "file_mode", path: "/backups", mode: "700", description: "/backups has mode 700" },
      { type: "file_owner", path: "/backups/README", user: "backupop", description: "README was created by backupop" },
    ],
  },
  {
    slug: "system-report-script",
    title: "Automate a System Report",
    difficulty: "ADVANCED",
    category: "shell-scripting",
    summary: "Write a reusable Bash tool installed for all users.",
    scenario: "The operations team wants a command `sysreport` that every user can run to get a quick health summary.",
    objectives: ["Write a Bash script with variables, conditions and functions", "Install it system-wide", "Handle arguments"],
    instructions: `Create \`/usr/local/bin/sysreport\` (mode **755**, owned by root) that:
1. Prints \`Host: <hostname>\` on the first line.
2. Prints \`User: <the user running it>\`.
3. Prints \`Root: yes\` when run as root and \`Root: no\` otherwise.
4. If called with the argument \`--disk\`, also prints the line \`Disk report\` followed by \`df -h /\` output.
Every user must be able to run it simply as \`sysreport\`.`,
    setupScript: "",
    xpReward: 200,
    hints: ["Use $(hostname) and $(whoami) or $USER", "if [ \"$(id -u)\" -eq 0 ]; then ... fi", "if [ \"$1\" = \"--disk\" ]; then echo 'Disk report'; df -h /; fi", "Write the file with sudo nano or sudo tee, then sudo chmod 755"],
    solution: `sudo nano /usr/local/bin/sysreport
#!/bin/bash
echo "Host: $(hostname)"
echo "User: $(whoami)"
if [ "$(id -u)" -eq 0 ]; then echo "Root: yes"; else echo "Root: no"; fi
if [ "$1" = "--disk" ]; then
  echo "Disk report"
  df -h /
fi
# then:
sudo chmod 755 /usr/local/bin/sysreport`,
    tasks: [
      { type: "file_mode", path: "/usr/local/bin/sysreport", mode: "755", description: "/usr/local/bin/sysreport has mode 755" },
      { type: "file_owner", path: "/usr/local/bin/sysreport", user: "root", description: "sysreport is owned by root" },
      { type: "command_output", command: "sysreport", asUser: "student", contains: "Host: linux-playground", description: "Prints the host name" },
      { type: "command_output", command: "sysreport", asUser: "student", contains: "User: student", description: "Prints the user running it" },
      { type: "command_output", command: "sysreport", asUser: "student", contains: "Root: no", description: "Reports Root: no for normal users" },
      { type: "command_output", command: "sysreport", contains: "Root: yes", description: "Reports Root: yes for root" },
      { type: "command_output", command: "sysreport --disk", asUser: "student", contains: "Disk report", description: "--disk prints the disk report" },
    ],
  },
];
