/**
 * Simulated APT repository and installed-package database.
 */

export interface ServiceDef {
  unit: string;
  description: string;
  ports: { port: number; proto: "tcp" | "udp"; address?: string }[];
  processes: { user: string; args: string; command: string }[];
  enableOnInstall: boolean;
}

export interface RepoPackage {
  name: string;
  version: string;
  /** Version that becomes available after `apt update`. */
  newVersion?: string;
  section: string;
  description: string;
  longDescription?: string;
  installedSizeKb: number;
  downloadSizeKb: number;
  depends: string[];
  /** Command names this package provides (gated in the command registry). */
  binaries: string[];
  binDir?: string;
  files?: { path: string; content: string; mode?: number; owner?: string }[];
  service?: ServiceDef;
  /** Installed in the base image. */
  preinstalled?: boolean;
  /** Essential packages cannot be removed without --allow-remove-essential. */
  essential?: boolean;
  /** Create system user on install. */
  systemUser?: { name: string; home: string; gecos: string };
}

const NGINX_INDEX = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`;

const APACHE_INDEX = `<!DOCTYPE html>
<html>
  <head><title>Apache2 Ubuntu Default Page: It works</title></head>
  <body>
    <h1>Apache2 Default Page</h1>
    <p>It works! This is the default welcome page used to test the correct operation of the Apache2 server after installation on Ubuntu systems.</p>
  </body>
</html>
`;

const NGINX_CONF = `user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
\tworker_connections 768;
}

http {
\tsendfile on;
\ttcp_nopush on;
\ttypes_hash_max_size 2048;
\tinclude /etc/nginx/mime.types;
\tdefault_type application/octet-stream;
\taccess_log /var/log/nginx/access.log;
\terror_log /var/log/nginx/error.log;
\tgzip on;
\tinclude /etc/nginx/conf.d/*.conf;
\tinclude /etc/nginx/sites-enabled/*;
}
`;

const NGINX_SITE = `server {
\tlisten 80 default_server;
\tlisten [::]:80 default_server;

\troot /var/www/html;
\tindex index.html index.htm index.nginx-debian.html;

\tserver_name _;

\tlocation / {
\t\ttry_files $uri $uri/ =404;
\t}
}
`;

export const REPOSITORY: RepoPackage[] = [
  // ---- preinstalled base system ----
  { name: "bash", version: "5.2.21-2ubuntu4", section: "shells", description: "GNU Bourne Again SHell", installedSizeKb: 1864, downloadSizeKb: 794, depends: [], binaries: [], preinstalled: true, essential: true },
  { name: "coreutils", version: "9.4-3ubuntu6", section: "utils", description: "GNU core utilities", installedSizeKb: 7136, downloadSizeKb: 1344, depends: [], binaries: [], preinstalled: true, essential: true },
  { name: "grep", version: "3.11-4build1", section: "utils", description: "GNU grep, egrep and fgrep", installedSizeKb: 1288, downloadSizeKb: 410, depends: [], binaries: [], preinstalled: true, essential: true },
  { name: "sed", version: "4.9-2build1", section: "utils", description: "GNU stream editor for filtering/transforming text", installedSizeKb: 896, downloadSizeKb: 191, depends: [], binaries: [], preinstalled: true, essential: true },
  { name: "mawk", version: "1.3.4.20240123-1build1", section: "interpreters", description: "Pattern scanning and text processing language", installedSizeKb: 255, downloadSizeKb: 127, depends: [], binaries: [], preinstalled: true },
  { name: "findutils", version: "4.9.0-5build1", section: "utils", description: "utilities for finding files--find, xargs", installedSizeKb: 1724, downloadSizeKb: 296, depends: [], binaries: [], preinstalled: true, essential: true },
  { name: "procps", version: "2:4.0.4-4ubuntu3", newVersion: "2:4.0.4-4ubuntu3.2", section: "admin", description: "/proc file system utilities", installedSizeKb: 1564, downloadSizeKb: 707, depends: [], binaries: [], preinstalled: true },
  { name: "iproute2", version: "6.1.0-1ubuntu6", section: "net", description: "networking and traffic control tools", installedSizeKb: 3612, downloadSizeKb: 1120, depends: [], binaries: [], preinstalled: true },
  { name: "iputils-ping", version: "3:20240117-1build1", section: "net", description: "Tools to test the reachability of network hosts", installedSizeKb: 114, downloadSizeKb: 44, depends: [], binaries: [], preinstalled: true },
  { name: "curl", version: "8.5.0-2ubuntu10.4", newVersion: "8.5.0-2ubuntu10.6", section: "web", description: "command line tool for transferring data with URL syntax", installedSizeKb: 534, downloadSizeKb: 226, depends: [], binaries: [], preinstalled: true },
  { name: "wget", version: "1.21.4-1ubuntu4.1", section: "web", description: "retrieves files from the web", installedSizeKb: 1003, downloadSizeKb: 334, depends: [], binaries: [], preinstalled: true },
  { name: "nano", version: "7.2-2build1", section: "editors", description: "small, friendly text editor inspired by Pico", installedSizeKb: 881, downloadSizeKb: 280, depends: [], binaries: [], preinstalled: true },
  { name: "vim-tiny", version: "2:9.1.0016-1ubuntu7.3", section: "editors", description: "Vi IMproved - enhanced vi editor - compact version", installedSizeKb: 1757, downloadSizeKb: 723, depends: [], binaries: [], preinstalled: true },
  { name: "sudo", version: "1.9.15p5-3ubuntu5", newVersion: "1.9.15p5-3ubuntu5.24.04.1", section: "admin", description: "Provide limited super user privileges to specific users", installedSizeKb: 3962, downloadSizeKb: 948, depends: [], binaries: [], preinstalled: true },
  { name: "openssl", version: "3.0.13-0ubuntu3.4", newVersion: "3.0.13-0ubuntu3.5", section: "utils", description: "Secure Sockets Layer toolkit - cryptographic utility", installedSizeKb: 2242, downloadSizeKb: 1003, depends: [], binaries: [], preinstalled: true },
  { name: "util-linux", version: "2.39.3-9ubuntu6.1", section: "utils", description: "miscellaneous system utilities", installedSizeKb: 3786, downloadSizeKb: 1128, depends: [], binaries: [], preinstalled: true, essential: true },
  { name: "passwd", version: "1:4.13+dfsg1-4ubuntu3", section: "admin", description: "change and administer password and group data", installedSizeKb: 2742, downloadSizeKb: 1038, depends: [], binaries: [], preinstalled: true },
  { name: "bind9-dnsutils", version: "1:9.18.28-0ubuntu0.24.04.1", section: "net", description: "Clients provided with BIND 9 (dig, nslookup)", installedSizeKb: 650, downloadSizeKb: 156, depends: [], binaries: [], preinstalled: true },
  { name: "openssh-client", version: "1:9.6p1-3ubuntu13.5", section: "net", description: "secure shell (SSH) client, for secure access to remote machines", installedSizeKb: 4688, downloadSizeKb: 905, depends: [], binaries: [], preinstalled: true },
  { name: "systemd", version: "255.4-1ubuntu8.4", section: "admin", description: "system and service manager", installedSizeKb: 11104, downloadSizeKb: 3479, depends: [], binaries: [], preinstalled: true, essential: true },
  { name: "rsyslog", version: "8.2312.0-3ubuntu9", section: "admin", description: "reliable system and kernel logging daemon", installedSizeKb: 1650, downloadSizeKb: 540, depends: [], binaries: [], preinstalled: true },
  { name: "cron", version: "3.0pl1-184ubuntu2", section: "admin", description: "process scheduling daemon", installedSizeKb: 314, downloadSizeKb: 85, depends: [], binaries: [], preinstalled: true },
  { name: "ufw", version: "0.36.2-6", section: "admin", description: "program for managing a Netfilter firewall", installedSizeKb: 860, downloadSizeKb: 168, depends: [], binaries: [], preinstalled: true },
  {
    name: "openssh-server",
    version: "1:9.6p1-3ubuntu13.5",
    newVersion: "1:9.6p1-3ubuntu13.8",
    section: "net",
    description: "secure shell (SSH) server, for secure access from remote machines",
    installedSizeKb: 2000,
    downloadSizeKb: 510,
    depends: ["openssh-client"],
    binaries: [],
    preinstalled: true,
    service: {
      unit: "ssh",
      description: "OpenBSD Secure Shell server",
      ports: [
        { port: 22, proto: "tcp", address: "0.0.0.0" },
        { port: 22, proto: "tcp", address: "[::]" },
      ],
      processes: [{ user: "root", command: "sshd", args: "sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups" }],
      enableOnInstall: true,
    },
  },
  { name: "python3", version: "3.12.3-0ubuntu2", section: "python", description: "interactive high-level object-oriented language (default python3 version)", installedSizeKb: 92, downloadSizeKb: 23, depends: [], binaries: [], preinstalled: true },

  // ---- installable ----
  { name: "tree", version: "2.1.1-2ubuntu3", section: "utils", description: "displays an indented directory tree, in color", installedSizeKb: 117, downloadSizeKb: 47, depends: [], binaries: ["tree"] },
  { name: "htop", version: "3.3.0-4build1", section: "utils", description: "interactive processes viewer", installedSizeKb: 434, downloadSizeKb: 171, depends: ["libnl-3-200"], binaries: ["htop"] },
  { name: "libnl-3-200", version: "3.7.0-0.3build1.1", section: "libs", description: "library for dealing with netlink sockets", installedSizeKb: 202, downloadSizeKb: 55, depends: [], binaries: [] },
  { name: "net-tools", version: "2.10-0.1ubuntu4", section: "net", description: "NET-3 networking toolkit (ifconfig, netstat, route)", installedSizeKb: 811, downloadSizeKb: 204, depends: [], binaries: ["ifconfig", "netstat", "route"], binDir: "/usr/sbin" },
  { name: "neofetch", version: "7.1.0-4", section: "utils", description: "Shows Linux System Information with Distribution Logo", installedSizeKb: 371, downloadSizeKb: 81, depends: [], binaries: ["neofetch"] },
  { name: "cowsay", version: "3.03+dfsg2-8", section: "games", description: "configurable talking cow", installedSizeKb: 93, downloadSizeKb: 18, depends: [], binaries: ["cowsay"], binDir: "/usr/games" },
  { name: "figlet", version: "2.2.5-3", section: "text", description: "Make large character ASCII banners out of ordinary text", installedSizeKb: 715, downloadSizeKb: 134, depends: [], binaries: ["figlet"] },
  { name: "git", version: "1:2.43.0-1ubuntu7.1", section: "vcs", description: "fast, scalable, distributed revision control system", installedSizeKb: 22808, downloadSizeKb: 3679, depends: ["git-man", "liberror-perl"], binaries: ["git"] },
  { name: "git-man", version: "1:2.43.0-1ubuntu7.1", section: "doc", description: "fast, scalable, distributed revision control system (manual pages)", installedSizeKb: 2004, downloadSizeKb: 1100, depends: [], binaries: [] },
  { name: "liberror-perl", version: "0.17029-2", section: "perl", description: "Perl module for error/exception handling in an OO-ish way", installedSizeKb: 40, downloadSizeKb: 25, depends: [], binaries: [] },
  { name: "zip", version: "3.0-13build1", section: "utils", description: "Archiver for .zip files", installedSizeKb: 559, downloadSizeKb: 176, depends: [], binaries: ["zip"] },
  { name: "unzip", version: "6.0-28ubuntu4", section: "utils", description: "De-archiver for .zip files", installedSizeKb: 388, downloadSizeKb: 174, depends: [], binaries: ["unzip"] },
  { name: "traceroute", version: "1:2.1.5-1", section: "net", description: "Traces the route taken by packets over an IPv4/IPv6 network", installedSizeKb: 156, downloadSizeKb: 44, depends: [], binaries: ["traceroute"] },
  {
    name: "nginx",
    version: "1.24.0-2ubuntu7",
    newVersion: "1.24.0-2ubuntu7.1",
    section: "httpd",
    description: "small, powerful, scalable web/proxy server",
    longDescription: "Nginx (\"engine X\") is a high-performance web and reverse proxy server.",
    installedSizeKb: 1380,
    downloadSizeKb: 520,
    depends: ["nginx-common"],
    binaries: ["nginx"],
    binDir: "/usr/sbin",
    files: [
      { path: "/etc/nginx/nginx.conf", content: NGINX_CONF },
      { path: "/etc/nginx/sites-available/default", content: NGINX_SITE },
      { path: "/etc/nginx/sites-enabled/default", content: NGINX_SITE },
      { path: "/var/www/html/index.nginx-debian.html", content: NGINX_INDEX },
      { path: "/var/log/nginx/access.log", content: "", mode: 0o640, owner: "www-data" },
      { path: "/var/log/nginx/error.log", content: "", mode: 0o640, owner: "www-data" },
    ],
    service: {
      unit: "nginx",
      description: "A high performance web server and a reverse proxy server",
      ports: [
        { port: 80, proto: "tcp", address: "0.0.0.0" },
        { port: 80, proto: "tcp", address: "[::]" },
      ],
      processes: [
        { user: "root", command: "nginx", args: "nginx: master process /usr/sbin/nginx -g daemon on; master_process on;" },
        { user: "www-data", command: "nginx", args: "nginx: worker process" },
        { user: "www-data", command: "nginx", args: "nginx: worker process" },
      ],
      enableOnInstall: true,
    },
  },
  { name: "nginx-common", version: "1.24.0-2ubuntu7", section: "httpd", description: "small, powerful, scalable web/proxy server - common files", installedSizeKb: 410, downloadSizeKb: 31, depends: [], binaries: [] },
  {
    name: "apache2",
    version: "2.4.58-1ubuntu8.4",
    section: "httpd",
    description: "Apache HTTP Server",
    installedSizeKb: 465,
    downloadSizeKb: 90,
    depends: ["apache2-bin", "apache2-data"],
    binaries: ["apache2", "apachectl", "a2ensite", "a2dissite"],
    binDir: "/usr/sbin",
    files: [
      { path: "/etc/apache2/apache2.conf", content: "# Apache2 main configuration (simulated)\nServerRoot \"/etc/apache2\"\nTimeout 300\nKeepAlive On\nIncludeOptional sites-enabled/*.conf\n" },
      { path: "/var/www/html/index.html", content: APACHE_INDEX },
    ],
    service: {
      unit: "apache2",
      description: "The Apache HTTP Server",
      ports: [{ port: 80, proto: "tcp", address: "*" }],
      processes: [
        { user: "root", command: "apache2", args: "/usr/sbin/apache2 -k start" },
        { user: "www-data", command: "apache2", args: "/usr/sbin/apache2 -k start" },
      ],
      enableOnInstall: true,
    },
  },
  { name: "apache2-bin", version: "2.4.58-1ubuntu8.4", section: "httpd", description: "Apache HTTP Server (modules and other binary files)", installedSizeKb: 6328, downloadSizeKb: 1328, depends: [], binaries: [] },
  { name: "apache2-data", version: "2.4.58-1ubuntu8.4", section: "httpd", description: "Apache HTTP Server (common files)", installedSizeKb: 842, downloadSizeKb: 163, depends: [], binaries: [] },
  {
    name: "mysql-server",
    version: "8.0.39-0ubuntu0.24.04.2",
    section: "database",
    description: "MySQL database server (metapackage depending on the latest version)",
    installedSizeKb: 120,
    downloadSizeKb: 9,
    depends: ["mysql-server-8.0", "mysql-client-8.0"],
    binaries: ["mysql", "mysqld"],
    files: [{ path: "/etc/mysql/my.cnf", content: "[mysqld]\nbind-address = 127.0.0.1\nport = 3306\n" }],
    systemUser: { name: "mysql", home: "/nonexistent", gecos: "MySQL Server,,," },
    service: {
      unit: "mysql",
      description: "MySQL Community Server",
      ports: [
        { port: 3306, proto: "tcp", address: "127.0.0.1" },
        { port: 33060, proto: "tcp", address: "127.0.0.1" },
      ],
      processes: [{ user: "mysql", command: "mysqld", args: "/usr/sbin/mysqld" }],
      enableOnInstall: true,
    },
  },
  { name: "mysql-server-8.0", version: "8.0.39-0ubuntu0.24.04.2", section: "database", description: "MySQL database server binaries and system database setup", installedSizeKb: 102000, downloadSizeKb: 15000, depends: [], binaries: [] },
  { name: "mysql-client-8.0", version: "8.0.39-0ubuntu0.24.04.2", section: "database", description: "MySQL database client binaries", installedSizeKb: 64000, downloadSizeKb: 2700, depends: [], binaries: [] },
  {
    name: "fail2ban",
    version: "1.0.2-3ubuntu0.1",
    section: "net",
    description: "ban hosts that cause multiple authentication errors",
    installedSizeKb: 2116,
    downloadSizeKb: 409,
    depends: ["python3"],
    binaries: ["fail2ban-client"],
    files: [{ path: "/etc/fail2ban/jail.conf", content: "[DEFAULT]\nbantime  = 10m\nfindtime  = 10m\nmaxretry = 5\n\n[sshd]\nenabled = true\nport    = ssh\n" }],
    service: {
      unit: "fail2ban",
      description: "Fail2Ban Service",
      ports: [],
      processes: [{ user: "root", command: "fail2ban-server", args: "/usr/bin/python3 /usr/bin/fail2ban-server -xf start" }],
      enableOnInstall: true,
    },
  },
  {
    name: "nodejs",
    version: "18.19.1+dfsg-6ubuntu5",
    section: "javascript",
    description: "evented I/O for V8 javascript - runtime executable",
    installedSizeKb: 799,
    downloadSizeKb: 255,
    depends: ["libnode109"],
    binaries: ["node"],
  },
  { name: "libnode109", version: "18.19.1+dfsg-6ubuntu5", section: "libs", description: "evented I/O for V8 javascript - runtime library", installedSizeKb: 75000, downloadSizeKb: 11000, depends: [], binaries: [] },
];

export const PACKAGE_INDEX: Map<string, RepoPackage> = new Map(REPOSITORY.map((p) => [p.name, p]));

/** Package that provides a given command (for "command not found" hints). */
export function packageProvidingCommand(cmd: string): RepoPackage | undefined {
  return REPOSITORY.find((p) => p.binaries.includes(cmd));
}

/** Resolve the full dependency closure that still needs to be installed. */
export function resolveInstall(names: string[], installed: Record<string, unknown>): { order: string[]; missing: string[] } {
  const order: string[] = [];
  const missing: string[] = [];
  const visit = (name: string, seen: Set<string>) => {
    if (installed[name] || order.includes(name) || seen.has(name)) return;
    const pkg = PACKAGE_INDEX.get(name);
    if (!pkg) {
      missing.push(name);
      return;
    }
    seen.add(name);
    for (const d of pkg.depends) visit(d, seen);
    order.push(name);
  };
  for (const n of names) visit(n, new Set());
  return { order, missing };
}

export function availableVersion(pkg: RepoPackage, updated: boolean): string {
  return updated && pkg.newVersion ? pkg.newVersion : pkg.version;
}
