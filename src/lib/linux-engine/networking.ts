/**
 * Simulated network. No real network traffic is ever generated: every
 * host, route and HTTP response comes from the tables below and from the
 * environment state (running services, firewall).
 */
import type { EnvState } from "./types";
import { PACKAGE_INDEX } from "./packages";

export interface RemoteHost {
  name: string;
  ipv4: string;
  ipv6?: string;
  /** Base round-trip time in ms. */
  rtt: number;
  /** Responds to ICMP echo. */
  icmp: boolean;
  http?: { status: number; contentType: string; body: string; server: string };
  aliases?: string[];
}

const EXAMPLE_BODY = `<!doctype html>
<html>
<head>
    <title>Example Domain</title>
    <meta charset="utf-8" />
</head>
<body>
<div>
    <h1>Example Domain</h1>
    <p>This domain is for use in illustrative examples in documents. You may use this
    domain in literature without prior coordination or asking for permission.</p>
</div>
</body>
</html>
`;

export const REMOTE_HOSTS: RemoteHost[] = [
  { name: "google.com", aliases: ["www.google.com"], ipv4: "142.250.190.78", ipv6: "2607:f8b0:4009:81b::200e", rtt: 11.8, icmp: true, http: { status: 301, contentType: "text/html; charset=UTF-8", body: '<HTML><HEAD><TITLE>301 Moved</TITLE></HEAD><BODY>\n<H1>301 Moved</H1>\nThe document has moved\n<A HREF="http://www.google.com/">here</A>.\n</BODY></HTML>\n', server: "gws" } },
  { name: "ubuntu.com", aliases: ["www.ubuntu.com"], ipv4: "185.125.190.20", rtt: 24.3, icmp: true, http: { status: 200, contentType: "text/html", body: "<!DOCTYPE html>\n<html><head><title>Enterprise Open Source and Linux | Ubuntu</title></head>\n<body><h1>Ubuntu</h1><p>The modern, open source operating system on Linux.</p></body></html>\n", server: "nginx" } },
  { name: "archive.ubuntu.com", ipv4: "91.189.91.83", rtt: 32.1, icmp: true },
  { name: "security.ubuntu.com", ipv4: "185.125.190.36", rtt: 30.6, icmp: true },
  { name: "github.com", aliases: ["www.github.com"], ipv4: "140.82.112.4", rtt: 18.2, icmp: false, http: { status: 200, contentType: "text/html; charset=utf-8", body: "<!DOCTYPE html>\n<html lang=\"en\"><head><title>GitHub: Let's build from here</title></head><body>GitHub</body></html>\n", server: "GitHub.com" } },
  { name: "example.com", aliases: ["www.example.com"], ipv4: "93.184.215.14", ipv6: "2606:2800:21f:cb07:6820:80da:af6b:8b2c", rtt: 15.4, icmp: true, http: { status: 200, contentType: "text/html", body: EXAMPLE_BODY, server: "ECAcc (nyd/D184)" } },
  { name: "cloudflare.com", ipv4: "104.16.132.229", rtt: 8.9, icmp: true, http: { status: 200, contentType: "text/html", body: "<html><body>Cloudflare</body></html>\n", server: "cloudflare" } },
  { name: "one.one.one.one", ipv4: "1.1.1.1", rtt: 7.6, icmp: true },
  { name: "dns.google", ipv4: "8.8.8.8", rtt: 9.4, icmp: true },
  { name: "linuxplayground.dev", ipv4: "51.91.12.34", rtt: 21.0, icmp: true, http: { status: 200, contentType: "text/plain", body: "Linux Playground - Learn Linux by Doing.\n", server: "nginx" } },
  { name: "intranet.local", ipv4: "10.0.2.50", rtt: 0.6, icmp: true, http: { status: 200, contentType: "text/html", body: "<html><body><h1>Company Intranet</h1></body></html>\n", server: "Apache/2.4.58 (Ubuntu)" } },
  { name: "fileserver.local", ipv4: "10.0.2.60", rtt: 0.7, icmp: false },
];

export function parseHostsFile(content: string): { ip: string; names: string[] }[] {
  return content
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const [ip, ...names] = l.split(/\s+/);
      return { ip, names };
    });
}

export interface Resolution {
  host: string;
  ip: string;
  remote?: RemoteHost;
  local: boolean;
}

export const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Resolve a hostname via /etc/hosts content then the simulated DNS. */
export function resolveHost(state: EnvState, hostsFile: string, name: string): Resolution | null {
  const lower = name.toLowerCase();
  const ownIps = state.network.interfaces.map((i) => i.ipv4);
  if (IPV4_RE.test(lower)) {
    const remote = REMOTE_HOSTS.find((h) => h.ipv4 === lower);
    const local = lower.startsWith("127.") || ownIps.includes(lower);
    return { host: remote?.name ?? lower, ip: lower, remote, local };
  }
  for (const entry of parseHostsFile(hostsFile)) {
    if (entry.names.map((n) => n.toLowerCase()).includes(lower) && IPV4_RE.test(entry.ip)) {
      const local = entry.ip.startsWith("127.") || ownIps.includes(entry.ip);
      return { host: name, ip: entry.ip, local, remote: REMOTE_HOSTS.find((h) => h.ipv4 === entry.ip) };
    }
  }
  const remote = REMOTE_HOSTS.find((h) => h.name === lower || h.aliases?.includes(lower));
  if (remote) return { host: lower, ip: remote.ipv4, remote, local: false };
  return null;
}

export interface ListeningSocket {
  proto: "tcp" | "udp";
  address: string;
  port: number;
  service: string;
  process: string;
  pid?: number;
}

/** Sockets in LISTEN state derived from running services. */
export function listeningSockets(state: EnvState): ListeningSocket[] {
  const sockets: ListeningSocket[] = [
    { proto: "udp", address: "127.0.0.54", port: 53, service: "systemd-resolved", process: "systemd-resolve" },
    { proto: "udp", address: "127.0.0.53%lo", port: 53, service: "systemd-resolved", process: "systemd-resolve" },
    { proto: "tcp", address: "127.0.0.53%lo", port: 53, service: "systemd-resolved", process: "systemd-resolve" },
    { proto: "tcp", address: "127.0.0.54", port: 53, service: "systemd-resolved", process: "systemd-resolve" },
  ];
  for (const [pkgName] of Object.entries(state.packages.installed)) {
    const pkg = PACKAGE_INDEX.get(pkgName);
    const svc = pkg?.service;
    if (!svc) continue;
    const st = state.services[svc.unit];
    if (!st?.active) continue;
    const proc = state.processes.find((p) => p.service === svc.unit);
    for (const port of svc.ports) {
      sockets.push({ proto: port.proto, address: port.address ?? "0.0.0.0", port: port.port, service: svc.unit, process: svc.processes[0]?.command ?? svc.unit, pid: proc?.pid });
    }
  }
  return sockets;
}

export function serviceListeningOn(state: EnvState, port: number): ListeningSocket | undefined {
  return listeningSockets(state).find((s) => s.port === port && s.proto === "tcp");
}

export const HTTP_STATUS: Record<number, string> = {
  200: "OK",
  301: "Moved Permanently",
  403: "Forbidden",
  404: "Not Found",
};
