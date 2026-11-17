import { createHash } from "node:crypto";
import { basename } from "../filesystem";
import { HTTP_STATUS, listeningSockets, REMOTE_HOSTS, resolveHost, type Resolution } from "../networking";
import { canAccess, R } from "../permissions";
import { findUser } from "../users";
import { verifyPassword } from "../util";
import { withOpts } from "./helpers";
import type { CommandContext, CommandDef } from "./types";

function hostsFile(ctx: CommandContext): string {
  return ctx.fs.tryLookup("/etc/hosts", "/")?.content ?? "";
}

function resolve(ctx: CommandContext, name: string): Resolution | null {
  return resolveHost(ctx.state, hostsFile(ctx), name);
}

function eth0(ctx: CommandContext) {
  return ctx.state.network.interfaces.find((i) => i.name !== "lo");
}

// ---------------------------------------------------------------------- ip

function ipCommand(ctx: CommandContext): number {
  const args = ctx.args.filter((a) => !["-4", "-6", "-c", "-color"].includes(a));
  const brief = args.includes("-br") || args.includes("-brief");
  const rest = args.filter((a) => a !== "-br" && a !== "-brief");
  const obj = rest[0] ?? "";
  const sub = rest.slice(1);
  const ifaces = ctx.state.network.interfaces;
  const match = (word: string, full: string) => word.length > 0 && full.startsWith(word);

  if (!obj) {
    ctx.err('Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nwhere  OBJECT := { address | link | neigh | route | rule | ... }\n');
    return 255;
  }
  if (match(obj, "address") || obj === "a" || obj === "addr") {
    const devFilter = sub.includes("dev") ? sub[sub.indexOf("dev") + 1] : sub.find((s) => ifaces.some((i) => i.name === s));
    const list = ifaces.filter((i) => !devFilter || i.name === devFilter);
    if (devFilter && !list.length) {
      ctx.err(`Device "${devFilter}" does not exist.\n`);
      return 1;
    }
    list.forEach((i, idx) => {
      const n = ifaces.indexOf(i) + 1;
      const lo = i.name === "lo";
      if (brief) {
        ctx.out(`${i.name.padEnd(16)} ${(lo ? "UNKNOWN" : i.up ? "UP" : "DOWN").padEnd(14)} ${i.up || lo ? `${i.ipv4}/${i.prefix} ${i.ipv6}/${lo ? 128 : 64}` : ""} \n`);
        return;
      }
      void idx;
      const flags = lo ? "LOOPBACK,UP,LOWER_UP" : i.up ? "BROADCAST,MULTICAST,UP,LOWER_UP" : "BROADCAST,MULTICAST";
      ctx.out(`${n}: ${i.name}: <${flags}> mtu ${i.mtu} qdisc ${lo ? "noqueue" : "fq_codel"} state ${lo ? "UNKNOWN" : i.up ? "UP" : "DOWN"} group default qlen 1000\n`);
      ctx.out(`    link/${lo ? "loopback" : "ether"} ${i.mac} brd ${lo ? "00:00:00:00:00:00" : "ff:ff:ff:ff:ff:ff"}\n`);
      if (!lo) ctx.out(`    altname enp0s3\n`);
      if (lo || i.up) {
        const brd = i.ipv4.split(".").slice(0, 3).join(".") + ".255";
        ctx.out(lo ? `    inet ${i.ipv4}/${i.prefix} scope host lo\n       valid_lft forever preferred_lft forever\n` : `    inet ${i.ipv4}/${i.prefix} metric 100 brd ${brd} scope global dynamic ${i.name}\n       valid_lft 86123sec preferred_lft 86123sec\n`);
        ctx.out(lo ? `    inet6 ::1/128 scope host noprefixroute \n       valid_lft forever preferred_lft forever\n` : `    inet6 ${i.ipv6}/64 scope link \n       valid_lft forever preferred_lft forever\n`);
      }
    });
    return 0;
  }
  if (match(obj, "route") || obj === "r") {
    const e = eth0(ctx);
    if (!e?.up) return 0;
    const net = e.ipv4.split(".").slice(0, 3).join(".") + ".0";
    ctx.out(`default via ${ctx.state.network.gateway} dev ${e.name} proto dhcp src ${e.ipv4} metric 100 \n${net}/${e.prefix} dev ${e.name} proto kernel scope link src ${e.ipv4} metric 100 \n${ctx.state.network.gateway} dev ${e.name} proto dhcp scope link src ${e.ipv4} metric 100 \n`);
    return 0;
  }
  if (match(obj, "link") || obj === "l") {
    if (sub[0] === "set") {
      const dev = sub[1];
      const iface = ifaces.find((i) => i.name === dev);
      if (!iface) {
        ctx.err(`Cannot find device "${dev}"\n`);
        return 1;
      }
      if (ctx.who.uid !== 0) {
        ctx.err("RTNETLINK answers: Operation not permitted\n");
        return 2;
      }
      if (sub.includes("down")) iface.up = false;
      if (sub.includes("up")) iface.up = true;
      ctx.shell.log("syslog", "systemd-networkd[512]", `${dev}: Link ${iface.up ? "UP" : "DOWN"}`);
      return 0;
    }
    ifaces.forEach((i, idx) => {
      const lo = i.name === "lo";
      if (brief) {
        ctx.out(`${i.name.padEnd(16)} ${(lo ? "UNKNOWN" : i.up ? "UP" : "DOWN").padEnd(14)} ${i.mac} <${lo ? "LOOPBACK,UP,LOWER_UP" : i.up ? "BROADCAST,MULTICAST,UP,LOWER_UP" : "BROADCAST,MULTICAST"}> \n`);
        return;
      }
      ctx.out(`${idx + 1}: ${i.name}: <${lo ? "LOOPBACK,UP,LOWER_UP" : i.up ? "BROADCAST,MULTICAST,UP,LOWER_UP" : "BROADCAST,MULTICAST"}> mtu ${i.mtu} qdisc ${lo ? "noqueue" : "fq_codel"} state ${lo ? "UNKNOWN" : i.up ? "UP" : "DOWN"} mode DEFAULT group default qlen 1000\n    link/${lo ? "loopback" : "ether"} ${i.mac} brd ${lo ? "00:00:00:00:00:00" : "ff:ff:ff:ff:ff:ff"}\n`);
    });
    return 0;
  }
  if (match(obj, "neighbour") || match(obj, "neighbor") || obj === "n") {
    const e = eth0(ctx);
    ctx.out(`${ctx.state.network.gateway} dev ${e?.name ?? "eth0"} lladdr 52:54:00:12:35:02 REACHABLE\n`);
    return 0;
  }
  ctx.err(`Object "${obj}" is unknown, try "ip help".\n`);
  return 1;
}

function ifconfig(ctx: CommandContext): number {
  for (const i of ctx.state.network.interfaces) {
    const lo = i.name === "lo";
    if (!lo && !i.up && !ctx.args.includes("-a")) continue;
    const flags = lo ? "73<UP,LOOPBACK,RUNNING>" : i.up ? "4163<UP,BROADCAST,RUNNING,MULTICAST>" : "4098<BROADCAST,MULTICAST>";
    ctx.out(`${i.name}: flags=${flags}  mtu ${i.mtu}\n`);
    if (lo || i.up) {
      ctx.out(lo ? `        inet ${i.ipv4}  netmask 255.0.0.0\n        inet6 ::1  prefixlen 128  scopeid 0x10<host>\n        loop  txqueuelen 1000  (Local Loopback)\n` : `        inet ${i.ipv4}  netmask 255.255.255.0  broadcast ${i.ipv4.split(".").slice(0, 3).join(".")}.255\n        inet6 ${i.ipv6}  prefixlen 64  scopeid 0x20<link>\n        ether ${i.mac}  txqueuelen 1000  (Ethernet)\n`);
    }
    ctx.out(`        RX packets ${lo ? 1204 : 58213}  bytes ${lo ? 98312 : 71234567} (${lo ? "98.3 KB" : "71.2 MB"})\n        RX errors 0  dropped 0  overruns 0  frame 0\n        TX packets ${lo ? 1204 : 21102}  bytes ${lo ? 98312 : 2345678} (${lo ? "98.3 KB" : "2.3 MB"})\n        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0\n\n`);
  }
  return 0;
}

// -------------------------------------------------------------------- ping

function ping(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "qn46", withValue: "ciWsw" }, (o) => {
    const target = o.operands[0];
    if (!target) {
      ctx.err("ping: usage error: Destination address required\n");
      return 1;
    }
    const res = resolve(ctx, target);
    if (!res) {
      ctx.err(`ping: ${target}: Temporary failure in name resolution\n`);
      return 2;
    }
    const e = eth0(ctx);
    if (!res.local && !e?.up) {
      ctx.err("ping: connect: Network is unreachable\n");
      return 2;
    }
    const explicitCount = o.values.c !== undefined;
    const count = explicitCount ? Math.max(1, Math.min(20, Number(o.values.c) || 1)) : 4;
    const size = Number(o.values.s ?? 56);
    const display = res.local ? (target === "localhost" ? "localhost" : res.ip) : res.host;
    ctx.out(`PING ${display} (${res.ip}) ${size}(${size + 28}) bytes of data.\n`);
    const base = res.local ? 0.03 : (res.remote?.rtt ?? 20);
    const responds = res.local || res.remote?.icmp !== false;
    const times: number[] = [];
    for (let k = 1; k <= count; k++) {
      if (!responds) continue;
      const t = base + (ctx.shell.random() - 0.5) * (res.local ? 0.02 : base * 0.08);
      times.push(t);
      if (!o.flags.has("q")) {
        const from = res.local ? (target === "localhost" ? "localhost (127.0.0.1)" : res.ip) : o.flags.has("n") ? res.ip : `${res.host} (${res.ip})`;
        ctx.out(`${size + 8} bytes from ${from}: icmp_seq=${k} ttl=${res.local ? 64 : 117} time=${t < 1 ? t.toFixed(3) : t.toFixed(1)} ms\n`);
      }
    }
    if (!explicitCount) ctx.out("^C\n");
    const received = times.length;
    const loss = Math.round(((count - received) / count) * 100);
    ctx.out(`\n--- ${display} ping statistics ---\n${count} packets transmitted, ${received} received, ${loss}% packet loss, time ${(count - 1) * 1001 + 4}ms\n`);
    if (received) {
      const min = Math.min(...times);
      const max = Math.max(...times);
      const avg = times.reduce((a, b) => a + b, 0) / received;
      const mdev = Math.sqrt(times.reduce((a, b) => a + (b - avg) ** 2, 0) / received);
      ctx.out(`rtt min/avg/max/mdev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/${mdev.toFixed(3)} ms\n`);
    }
    return received ? 0 : 1;
  });
}

function hostname(ctx: CommandContext): number {
  const a = ctx.args[0];
  if (a === "-I" || a === "--all-ip-addresses") {
    ctx.out(ctx.state.network.interfaces.filter((i) => i.name !== "lo" && i.up).map((i) => i.ipv4).join(" ") + " \n");
    return 0;
  }
  if (a === "-i" || a === "--ip-address") {
    ctx.out("127.0.1.1\n");
    return 0;
  }
  if (a === "-f" || a === "--fqdn" || a === "-A") {
    ctx.out(ctx.state.hostname + "\n");
    return 0;
  }
  if (a && !a.startsWith("-")) {
    if (ctx.who.uid !== 0) {
      ctx.err("hostname: you must be root to change the host name\n");
      return 1;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(a)) {
      ctx.err("hostname: the specified hostname is invalid\n");
      return 1;
    }
    ctx.state.hostname = a;
    return 0;
  }
  ctx.out(ctx.state.hostname + "\n");
  return 0;
}

// ------------------------------------------------------------------- HTTP

interface HttpResult {
  error?: { code: number; message: string };
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  host?: string;
  ip?: string;
  port?: number;
}

function httpDate(ts: number) {
  return new Date(ts).toUTCString();
}

function fetchUrl(ctx: CommandContext, url: string): HttpResult {
  const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) return { error: { code: 3, message: `URL rejected: Malformed input to a URL function` } };
  const scheme = m[1] ?? "http";
  const host = m[2];
  const port = m[3] ? Number(m[3]) : scheme === "https" ? 443 : 80;
  const path = m[4] ?? "/";
  const res = resolve(ctx, host);
  if (!res) return { error: { code: 6, message: `Could not resolve host: ${host}` } };
  if (!res.local && !eth0(ctx)?.up) return { error: { code: 7, message: `Failed to connect to ${host} port ${port} after 0 ms: Network is unreachable` } };
  if (res.local) {
    const sock = listeningSockets(ctx.state).find((s) => s.port === port && s.proto === "tcp");
    if (!sock) return { error: { code: 7, message: `Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server` } };
    if (sock.service === "nginx" || sock.service === "apache2") {
      const server = sock.service === "nginx" ? "nginx/1.24.0 (Ubuntu)" : "Apache/2.4.58 (Ubuntu)";
      const root = "/var/www/html";
      const candidates = path.endsWith("/") ? (sock.service === "nginx" ? ["index.html", "index.htm", "index.nginx-debian.html"] : ["index.html"]).map((f) => `${root}${path}${f}`) : [`${root}${path}`];
      for (const c of candidates) {
        const node = ctx.fs.tryLookup(c, "/");
        if (node && node.type === "file") {
          if (!canAccess(node, { uid: 33, gid: 33, groups: [33], username: "www-data" }, R)) {
            const body = `<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n<hr><center>nginx/1.24.0 (Ubuntu)</center>\r\n</body>\r\n</html>\r\n`;
            return { status: 403, headers: { Server: server, "Content-Type": "text/html" }, body, host, ip: res.ip, port };
          }
          const body = node.content;
          return { status: 200, headers: { Server: server, "Content-Type": "text/html", "Last-Modified": httpDate(node.mtime) }, body, host, ip: res.ip, port };
        }
      }
      const body = `<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx/1.24.0 (Ubuntu)</center>\r\n</body>\r\n</html>\r\n`;
      return { status: 404, headers: { Server: server, "Content-Type": "text/html" }, body, host, ip: res.ip, port };
    }
    return { error: { code: 52, message: "Empty reply from server" } };
  }
  const remote = res.remote ?? REMOTE_HOSTS.find((h) => h.ipv4 === res.ip);
  if (!remote?.http || (port !== 80 && port !== 443)) return { error: { code: 28, message: `Failed to connect to ${host} port ${port} after 3002 ms: Couldn't connect to server` } };
  if (path !== "/" && path !== "/index.html") {
    return { status: 404, headers: { Server: remote.http.server, "Content-Type": "text/html" }, body: "<html><body><h1>404 Not Found</h1></body></html>\n", host, ip: res.ip, port };
  }
  const headers: Record<string, string> = { Server: remote.http.server, "Content-Type": remote.http.contentType };
  if (remote.http.status === 301) headers.Location = `${scheme}://www.${remote.name}/`;
  return { status: remote.http.status, headers, body: remote.http.body, host, ip: res.ip, port };
}

function formatHeaders(ctx: CommandContext, r: HttpResult, http2: boolean): string {
  const statusLine = http2 ? `HTTP/2 ${r.status}` : `HTTP/1.1 ${r.status} ${HTTP_STATUS[r.status!] ?? ""}`;
  const h = { ...r.headers, Date: httpDate(ctx.now), "Content-Length": String(Buffer.byteLength(r.body ?? "")), Connection: "keep-alive" };
  const order = ["Server", "Date", "Content-Type", "Content-Length", "Last-Modified", "Connection", "Location"];
  const lines = order.filter((k) => h[k as keyof typeof h]).map((k) => `${http2 ? k.toLowerCase() : k}: ${h[k as keyof typeof h]}`);
  return [statusLine, ...lines].join("\r\n") + "\r\n\r\n";
}

function writeDownload(ctx: CommandContext, path: string, content: string): string | null {
  try {
    ctx.shell.openForWrite(path, false).write(content);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function curl(ctx: CommandContext): number {
  return withOpts(
    ctx,
    { flags: "IisSOLvfk", withValue: "oXHdAu", long: { head: "I", include: "i", silent: "s", "show-error": "S", "remote-name": "O", location: "L", verbose: "v", fail: "f", insecure: "k", "output=": "o", "request=": "X", "header=": "H", "data=": "d", "user-agent=": "A" } },
    (o) => {
      const url = o.operands[0];
      if (!url) {
        ctx.err("curl: try 'curl --help' or 'curl --manual' for more information\n");
        return 2;
      }
      let r = fetchUrl(ctx, url);
      let hops = 0;
      while (o.flags.has("L") && r.status === 301 && r.headers?.Location && hops++ < 5) r = fetchUrl(ctx, r.headers.Location);
      if (r.error) {
        if (!o.flags.has("s") || o.flags.has("S")) ctx.err(`curl: (${r.error.code}) ${r.error.message}\n`);
        return r.error.code;
      }
      const https = url.startsWith("https://");
      if (o.flags.has("v")) {
        ctx.err(`*   Trying ${r.ip}:${r.port}...\n* Connected to ${r.host} (${r.ip}) port ${r.port}\n> ${o.flags.has("I") ? "HEAD" : (o.values.X ?? "GET")} / HTTP/1.1\n> Host: ${r.host}\n> User-Agent: curl/8.5.0\n> Accept: */*\n>\n< HTTP/1.1 ${r.status} ${HTTP_STATUS[r.status!] ?? ""}\n`);
      }
      if (o.flags.has("f") && r.status! >= 400) {
        if (!o.flags.has("s") || o.flags.has("S")) ctx.err(`curl: (22) The requested URL returned error: ${r.status}\n`);
        return 22;
      }
      let output = "";
      if (o.flags.has("I")) output = formatHeaders(ctx, r, https);
      else output = (o.flags.has("i") ? formatHeaders(ctx, r, https) : "") + (r.body ?? "");
      const outFile = o.values.o ?? (o.flags.has("O") ? basename(url.replace(/^https?:\/\//, "").replace(/^[^/]*/, "") || "/") : undefined);
      if (outFile !== undefined) {
        if (!outFile || outFile === "/") {
          ctx.err("curl: (23) Remote file name has no length\n");
          return 23;
        }
        const err = writeDownload(ctx, outFile, output);
        if (err) {
          ctx.err(`Warning: Failed to open the file ${outFile}: ${err.replace(/^.*: /, "")}\ncurl: (23) Failure writing output to destination\n`);
          return 23;
        }
        if (!o.flags.has("s")) {
          const size = Buffer.byteLength(output);
          ctx.err(`  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n                                 Dload  Upload   Total   Spent    Left  Speed\n100 ${String(size).padStart(5)}  100 ${String(size).padStart(5)}    0     0  ${String(Math.round(size * 8)).padStart(5)}      0 --:--:-- --:--:-- --:--:-- ${String(Math.round(size * 8)).padStart(5)}\n`);
        }
        return 0;
      }
      ctx.out(output);
      return 0;
    },
  );
}

function wget(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "qcnv", withValue: "OP", long: { quiet: "q", "output-document=": "O", "directory-prefix=": "P" } }, (o) => {
    const url = o.operands[0];
    if (!url) {
      ctx.err("wget: missing URL\nUsage: wget [OPTION]... [URL]...\n\nTry `wget --help' for more options.\n");
      return 1;
    }
    const full = /^https?:\/\//.test(url) ? url : `http://${url}`;
    const stamp = new Date(ctx.now).toISOString().replace("T", " ").slice(0, 19);
    const log = (s: string) => {
      if (!o.flags.has("q")) ctx.err(s);
    };
    log(`--${stamp}--  ${full}${full.endsWith("/") || /\/\/[^/]+$/.test(full) ? (/\/\/[^/]+$/.test(full) ? "/" : "") : ""}\n`);
    const r = fetchUrl(ctx, full);
    const host = /^https?:\/\/([^/:]+)/.exec(full)?.[1] ?? url;
    if (r.error) {
      if (r.error.code === 6) log(`Resolving ${host} (${host})... failed: Temporary failure in name resolution.\nwget: unable to resolve host address ‘${host}’\n`);
      else log(`Resolving ${host} (${host})... ${r.ip ?? resolve(ctx, host)?.ip}\nConnecting to ${host} (${host})|${resolve(ctx, host)?.ip}|:${full.startsWith("https") ? 443 : 80}... failed: Connection refused.\n`);
      return 4;
    }
    log(`Resolving ${host} (${host})... ${r.ip}\nConnecting to ${host} (${host})|${r.ip}|:${r.port}... connected.\nHTTP request sent, awaiting response... ${r.status} ${HTTP_STATUS[r.status!] ?? ""}\n`);
    if (r.status! >= 400) {
      log(`${stamp} ERROR ${r.status}: ${HTTP_STATUS[r.status!] ?? "Error"}.\n\n`);
      return 8;
    }
    const pathPart = full.replace(/^https?:\/\/[^/]+/, "");
    let name = o.values.O ?? (basename(pathPart || "/") === "/" || !pathPart || pathPart.endsWith("/") ? "index.html" : basename(pathPart));
    if (!o.values.O) {
      let k = 1;
      const base = name;
      while (ctx.fs.tryLookup(name, ctx.cwd, ctx.who)) name = `${base}.${k++}`;
    }
    if (o.values.P) name = `${o.values.P.replace(/\/+$/, "")}/${name}`;
    const body = r.body ?? "";
    const size = Buffer.byteLength(body);
    log(`Length: ${size} (${(size / 1024).toFixed(1)}K) [${(r.headers?.["Content-Type"] ?? "text/html").split(";")[0]}]\nSaving to: ‘${name}’\n\n`);
    const err = name === "-" ? (ctx.out(body), null) : writeDownload(ctx, name, body);
    if (err) {
      ctx.err(`${name}: ${err.replace(/^.*: /, "")}\n\nCannot write to ‘${name}’ (${err.replace(/^.*: /, "")}).\n`);
      return 3;
    }
    log(`${name.slice(0, 18).padEnd(19)}100%[===================>]   ${(size / 1024).toFixed(2)}K  --.-KB/s    in 0s      \n\n${stamp} (42.1 MB/s) - ‘${name}’ saved [${size}/${size}]\n\n`);
    return 0;
  });
}

// --------------------------------------------------------------------- DNS

function nslookup(ctx: CommandContext): number {
  const name = ctx.args.find((a) => !a.startsWith("-"));
  if (!name) {
    ctx.err("Usage: nslookup [-opt ...] host\n");
    return 1;
  }
  ctx.out("Server:\t\t127.0.0.53\nAddress:\t127.0.0.53#53\n\n");
  const r = resolve(ctx, name);
  if (!r || r.local) {
    if (r?.local) {
      ctx.out(`Name:\t${name}\nAddress: ${r.ip}\n\n`);
      return 0;
    }
    ctx.out(`** server can't find ${name}: NXDOMAIN\n\n`);
    return 1;
  }
  ctx.out(`Non-authoritative answer:\nName:\t${r.host}\nAddress: ${r.ip}\n`);
  if (r.remote?.ipv6) ctx.out(`Name:\t${r.host}\nAddress: ${r.remote.ipv6}\n`);
  ctx.out("\n");
  return 0;
}

function dig(ctx: CommandContext): number {
  const short = ctx.args.includes("+short");
  const name = ctx.args.find((a) => !a.startsWith("+") && !a.startsWith("-") && !a.startsWith("@") && !["A", "AAAA", "MX", "NS", "TXT"].includes(a));
  if (!name) {
    ctx.out("; <<>> DiG 9.18.28-0ubuntu0.24.04.1-Ubuntu <<>>\n;; global options: +cmd\n");
    return 0;
  }
  const r = resolve(ctx, name);
  if (short) {
    if (r) ctx.out(r.ip + "\n");
    return 0;
  }
  const id = 40000 + Math.floor(ctx.shell.random() * 20000);
  ctx.out(`\n; <<>> DiG 9.18.28-0ubuntu0.24.04.1-Ubuntu <<>> ${name}\n;; global options: +cmd\n;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ${r ? "NOERROR" : "NXDOMAIN"}, id: ${id}\n;; flags: qr rd ra; QUERY: 1, ANSWER: ${r ? 1 : 0}, AUTHORITY: 0, ADDITIONAL: 1\n\n;; OPT PSEUDOSECTION:\n; EDNS: version: 0, flags:; udp: 65494\n;; QUESTION SECTION:\n;${name}.\t\t\tIN\tA\n\n`);
  if (r) ctx.out(`;; ANSWER SECTION:\n${name}.\t\t300\tIN\tA\t${r.ip}\n\n`);
  ctx.out(`;; Query time: ${Math.round(r?.remote?.rtt ?? 3)} msec\n;; SERVER: 127.0.0.53#53(127.0.0.53) (UDP)\n;; WHEN: ${new Date(ctx.now).toUTCString()}\n;; MSG SIZE  rcvd: ${r ? 55 : 40}\n\n`);
  return 0;
}

function hostCmd(ctx: CommandContext): number {
  const name = ctx.args.find((a) => !a.startsWith("-"));
  if (!name) {
    ctx.err("Usage: host [-aCdilrTvVw] [-c class] [-N ndots] [-t type] [-W time]\n            [-R number] [-m flag] [-p port] hostname [server]\n");
    return 1;
  }
  const r = resolve(ctx, name);
  if (!r) {
    ctx.out(`Host ${name} not found: 3(NXDOMAIN)\n`);
    return 1;
  }
  ctx.out(`${name} has address ${r.ip}\n`);
  if (r.remote?.ipv6) ctx.out(`${name} has IPv6 address ${r.remote.ipv6}\n`);
  return 0;
}

// ------------------------------------------------------------- ss/netstat

function ss(ctx: CommandContext): number {
  const flags = ctx.args.filter((a) => a.startsWith("-")).join("").replace(/-/g, "");
  const tcp = flags.includes("t");
  const udp = flags.includes("u");
  const listening = flags.includes("l");
  const all = flags.includes("a");
  const numeric = flags.includes("n");
  const proc = flags.includes("p");
  const both = !tcp && !udp;
  const portName = (p: number) => (numeric ? String(p) : ({ 22: "ssh", 53: "domain", 80: "http", 443: "https", 3306: "mysql" } as Record<number, string>)[p] ?? String(p));
  const rows: string[][] = [["Netid", "State", "Recv-Q", "Send-Q", "Local Address:Port", "Peer Address:Port", "Process"]];
  if (listening || all) {
    for (const s of listeningSockets(ctx.state)) {
      if (!both && ((s.proto === "tcp" && !tcp) || (s.proto === "udp" && !udp))) continue;
      const p = proc && ctx.who.uid === 0 ? `users:(("${s.process}",pid=${s.pid ?? 518},fd=${s.proto === "tcp" ? 3 : 14}))` : "";
      rows.push([s.proto, s.proto === "udp" ? "UNCONN" : "LISTEN", "0", s.proto === "udp" ? "0" : "4096", `${s.address}:${portName(s.port)}`, s.address.startsWith("[") ? "[::]:*" : "0.0.0.0:*", p]);
    }
  }
  if (!listening && (tcp || both || all)) {
    const e = eth0(ctx);
    if (ctx.state.services.ssh?.active && e) rows.push(["tcp", "ESTAB", "0", "0", `${e.ipv4}:${portName(22)}`, `${ctx.state.network.gateway}:51432`, ""]);
  }
  if (!tcp && !udp && !listening && !all) {
    // plain `ss`: no header Netid filtering
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) {
    ctx.out(
      r
        .map((c, i) => (i === 4 || i === 5 ? c.padStart(widths[i]) : i === r.length - 1 ? c : c.padEnd(widths[i])))
        .join(" ")
        .trimEnd() + "\n",
    );
  }
  return 0;
}

function netstat(ctx: CommandContext): number {
  const flags = ctx.args.join("");
  const listening = flags.includes("l");
  ctx.out(`Active Internet connections ${listening ? "(only servers)" : "(w/o servers)"}\nProto Recv-Q Send-Q Local Address           Foreign Address         State      ${flags.includes("p") ? "PID/Program name    " : ""}\n`);
  if (listening) {
    for (const s of listeningSockets(ctx.state)) {
      if (flags.includes("t") && !flags.includes("u") && s.proto !== "tcp") continue;
      if (flags.includes("u") && !flags.includes("t") && s.proto !== "udp") continue;
      const addr = s.address.startsWith("[") ? `:::${s.port}` : `${s.address.replace("%lo", "")}:${s.port}`;
      const proto = s.address.startsWith("[") ? `${s.proto}6` : s.proto;
      ctx.out(`${proto.padEnd(5)}      0      0 ${addr.padEnd(23)} ${(s.address.startsWith("[") ? ":::*" : "0.0.0.0:*").padEnd(23)} ${s.proto === "tcp" ? "LISTEN" : ""}     \n`);
    }
  }
  return 0;
}

function traceroute(ctx: CommandContext): number {
  const target = ctx.args.find((a) => !a.startsWith("-"));
  if (!target) {
    ctx.err("Usage:\n  traceroute [ -46dFITnreAUDV ] [ -f first_ttl ] [ -g gate,... ] host [ packetlen ]\n");
    return 2;
  }
  const r = resolve(ctx, target);
  if (!r) {
    ctx.err(`${target}: Name or service not known\nCannot handle "host" cmdline arg \`${target}' on position 1 (argc 1)\n`);
    return 2;
  }
  ctx.out(`traceroute to ${target} (${r.ip}), 30 hops max, 60 byte packets\n`);
  const hops = r.local ? [] : ["_gateway (10.0.2.2)", "192.168.1.1 (192.168.1.1)", "100.64.0.1 (100.64.0.1)", "isp-core-1.net (203.0.113.9)", "ix-peer.net (198.51.100.20)"];
  const t = (base: number) => (base + ctx.shell.random()).toFixed(3);
  hops.forEach((h, i) => ctx.out(`${String(i + 1).padStart(2)}  ${h}  ${t(i * 3 + 0.4)} ms  ${t(i * 3 + 0.5)} ms  ${t(i * 3 + 0.6)} ms\n`));
  ctx.out(`${String(hops.length + 1).padStart(2)}  ${r.host} (${r.ip})  ${t(r.remote?.rtt ?? 0.05)} ms  ${t(r.remote?.rtt ?? 0.05)} ms  ${t(r.remote?.rtt ?? 0.05)} ms\n`);
  return 0;
}

// --------------------------------------------------------------------- SSH

function fingerprint(seed: string) {
  return "SHA256:" + createHash("sha256").update(seed).digest("base64").replace(/=+$/, "");
}

function ssh(ctx: CommandContext): number {
  let port = 22;
  let login: string | undefined;
  const ops: string[] = [];
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === "-p") port = Number(ctx.args[++i]);
    else if (a === "-l") login = ctx.args[++i];
    else if (a === "-i" || a === "-o") i++;
    else if (a.startsWith("-")) continue;
    else ops.push(a);
  }
  const dest = ops[0];
  if (!dest) {
    ctx.err("usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-B bind_interface] [-b bind_address]\n           [-c cipher_spec] [-D [bind_address:]port] [-E log_file]\n           [-e escape_char] [-F configfile] [-I pkcs11] [-i identity_file]\n           [-J destination] [-L address] [-l login_name] [-m mac_spec]\n           [-O ctl_cmd] [-o option] [-P tag] [-p port] [-R address]\n           [-S ctl_path] [-W host:port] [-w local_tun[:remote_tun]]\n           destination [command [argument ...]]\n");
    return 255;
  }
  const at = dest.lastIndexOf("@");
  const user = login ?? (at === -1 ? ctx.who.username : dest.slice(0, at));
  const host = at === -1 ? dest : dest.slice(at + 1);
  const r = resolve(ctx, host);
  if (!r) {
    ctx.err(`ssh: Could not resolve hostname ${host}: Temporary failure in name resolution\n`);
    return 255;
  }
  if (!r.local) {
    ctx.err(`ssh: connect to host ${host} port ${port}: Connection timed out\n`);
    return 255;
  }
  const sock = listeningSockets(ctx.state).find((s) => s.port === port && s.proto === "tcp" && s.service === "ssh");
  if (!sock) {
    ctx.err(`ssh: connect to host ${host} port ${port}: Connection refused\n`);
    return 255;
  }
  const me = findUser(ctx.state, ctx.who.uid)!;
  const knownPath = `${me.home}/.ssh/known_hosts`;
  const known = ctx.fs.tryLookup(knownPath, "/");
  if (!known || !known.content.includes(`${host} `)) {
    ctx.out(`The authenticity of host '${host} (${r.ip})' can't be established.\nED25519 key fingerprint is ${fingerprint(ctx.state.hostname + "hostkey")}.\nThis key is not known by any other names.\n`);
    const ans = ctx.shell.readInput("Are you sure you want to continue connecting (yes/no/[fingerprint])? ", false);
    if (ans.trim() !== "yes") {
      ctx.err("Host key verification failed.\n");
      return 255;
    }
    ctx.err(`Warning: Permanently added '${host}' (ED25519) to the list of known hosts.\n`);
    try {
      ctx.fs.mkdirp(`${me.home}/.ssh`, { uid: me.uid, gid: me.gid }, 0o700, ctx.now);
      const line = `${host} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${createHash("sha256").update(ctx.state.hostname).digest("base64").slice(0, 43)}\n`;
      const kn = ctx.fs.tryLookup(knownPath, "/");
      if (kn) ctx.fs.writeContent(kn, line, true, ctx.now);
      else ctx.fs.writeFileAt(knownPath, line, { uid: me.uid, gid: me.gid, mode: 0o644, now: ctx.now });
    } catch {
      /* ignore */
    }
  }
  const target = ctx.state.users.find((u) => u.username === user);
  let ok = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const pw = ctx.shell.readInput(`${user}@${host}'s password: `, true);
    if (target && !target.locked && !target.passwordHash.startsWith("!") && verifyPassword(pw, target.passwordHash) && target.username !== "root") {
      ok = true;
      break;
    }
    ctx.shell.log("auth", "sshd[4410]", `Failed password for ${target ? "" : "invalid user "}${user} from 127.0.0.1 port 51234 ssh2`);
    if (attempt < 2) ctx.err("Permission denied, please try again.\n");
  }
  if (!ok) {
    ctx.err(`${user}@${host}: Permission denied (publickey,password).\n`);
    return 255;
  }
  ctx.shell.log("auth", "sshd[4411]", `Accepted password for ${user} from 127.0.0.1 port 51234 ssh2`);
  ctx.shell.log("auth", "sshd[4411]", `pam_unix(sshd:session): session opened for user ${user}(uid=${target!.uid}) by ${user}(uid=0)`);
  ctx.out(`Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)\n\n * Documentation:  https://help.ubuntu.com\n\nLast login: ${new Date(ctx.now).toUTCString()} from 127.0.0.1\n`);
  ctx.state.logins.push({ user, tty: "pts/1", from: "127.0.0.1", loginAt: ctx.now, logoutAt: null });
  ctx.state.session.userStack.push({ user, cwd: target!.home, login: true });
  return 0;
}

function sshKeygen(ctx: CommandContext): number {
  let type = "ed25519";
  let file: string | undefined;
  let pass: string | undefined;
  let comment: string | undefined;
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === "-t") type = ctx.args[++i];
    else if (a === "-f") file = ctx.args[++i];
    else if (a === "-N") pass = ctx.args[++i];
    else if (a === "-C") comment = ctx.args[++i];
    else if (a === "-b") i++;
  }
  if (!["ed25519", "rsa", "ecdsa"].includes(type)) {
    ctx.err(`unknown key type ${type}\n`);
    return 1;
  }
  const me = findUser(ctx.state, ctx.who.uid)!;
  const def = `${me.home}/.ssh/id_${type}`;
  ctx.out(`Generating public/private ${type} key pair.\n`);
  if (!file) {
    const ans = ctx.shell.readInput(`Enter file in which to save the key (${def}): `, false);
    file = ans.trim() || def;
  }
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) || "/" : ctx.cwd;
  if (!ctx.fs.tryLookup(dir, ctx.cwd)) {
    try {
      ctx.fs.mkdirp(dir.startsWith("/") ? dir : `${ctx.cwd}/${dir}`, { uid: me.uid, gid: me.gid }, 0o700, ctx.now);
      ctx.out(`Created directory '${dir}'.\n`);
    } catch {
      ctx.err(`Saving key "${file}" failed: No such file or directory\n`);
      return 1;
    }
  }
  if (ctx.fs.tryLookup(file, ctx.cwd)) {
    const ans = ctx.shell.readInput(`${file} already exists.\nOverwrite (y/n)? `, false);
    if (!/^y/i.test(ans)) return 1;
  }
  if (pass === undefined) {
    const p1 = ctx.shell.readInput("Enter passphrase (empty for no passphrase): ", true);
    const p2 = ctx.shell.readInput("Enter same passphrase again: ", true);
    if (p1 !== p2) {
      ctx.out("Passphrases do not match.  Try again.\n");
      return 1;
    }
  }
  const who = comment ?? `${me.username}@${ctx.state.hostname}`;
  const seed = `${file}${ctx.now}${ctx.shell.random()}`;
  const keyData = createHash("sha512").update(seed).digest("base64");
  const priv = `-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n${keyData.slice(0, 70)}\n${keyData.slice(0, 64)}==\n-----END OPENSSH PRIVATE KEY-----\n`;
  const pubType = type === "rsa" ? "ssh-rsa" : type === "ecdsa" ? "ecdsa-sha2-nistp256" : "ssh-ed25519";
  const pub = `${pubType} AAAAC3NzaC1lZDI1NTE5AAAAI${keyData.slice(0, 43)} ${who}\n`;
  try {
    ctx.shell.openForWrite(file, false).write(priv);
    ctx.shell.openForWrite(`${file}.pub`, false).write(pub);
    const privNode = ctx.fs.lookup(file, ctx.cwd);
    privNode.mode = 0o600;
    const pubNode = ctx.fs.lookup(`${file}.pub`, ctx.cwd);
    pubNode.mode = 0o644;
  } catch (e) {
    ctx.err(`Saving key "${file}" failed: ${(e as Error).message.replace(/^.*: /, "")}\n`);
    return 1;
  }
  const fp = fingerprint(seed);
  const art = ["|  .o+=*o.        |", "| o.+=+.o         |", "|. +.=.o .        |", "| o + B o .       |", "|  + * = S        |", "| . o = * .       |", "|  . + B +        |", "|   o.=.E.o       |", "|    o=+o+.       |"];
  ctx.out(`Your identification has been saved in ${file}\nYour public key has been saved in ${file}.pub\nThe key fingerprint is:\n${fp} ${who}\nThe key's randomart image is:\n+--[${type.toUpperCase()} ${type === "rsa" ? 3072 : 256}]--+\n${art.join("\n")}\n+----[SHA256]-----+\n`);
  return 0;
}

export const networkCommands: CommandDef[] = [
  {
    name: "ip",
    category: "networking",
    binDir: "/usr/bin",
    description: "Show / manipulate routing, network devices and interfaces.",
    syntax: "ip [-br] { addr | route | link | neigh } [COMMAND]",
    options: [
      { flag: "ip addr", description: "IP addresses of every interface" },
      { flag: "ip -br a", description: "brief one-line view" },
      { flag: "ip route", description: "routing table (default gateway)" },
      { flag: "ip link set eth0 down|up", description: "disable / enable an interface (root)" },
    ],
    examples: [
      { command: "ip addr", description: "What is my IP address?" },
      { command: "ip route", description: "Where does traffic go by default?" },
    ],
    run: ipCommand,
  },
  { name: "ifconfig", package: "net-tools", binDir: "/usr/sbin", category: "networking", description: "Configure a network interface (legacy).", syntax: "ifconfig [-a]", run: ifconfig },
  {
    name: "ping",
    category: "networking",
    description: "Send ICMP ECHO_REQUEST to network hosts (simulated network).",
    syntax: "ping [-c COUNT] HOST",
    options: [{ flag: "-c N", description: "stop after N packets" }],
    examples: [
      { command: "ping -c 4 google.com", description: "Test connectivity" },
      { command: "ping localhost", description: "Test the loopback interface" },
    ],
    run: ping,
  },
  {
    name: "hostname",
    category: "networking",
    description: "Show or set the system's host name.",
    syntax: "hostname [-I | -i | NAME]",
    examples: [
      { command: "hostname", description: "Machine name" },
      { command: "hostname -I", description: "All IP addresses" },
    ],
    run: hostname,
  },
  {
    name: "curl",
    category: "networking",
    description: "Transfer data from or to a server (simulated web).",
    syntax: "curl [-I] [-i] [-L] [-o FILE] [-O] URL",
    options: [
      { flag: "-I", description: "fetch headers only" },
      { flag: "-o FILE", description: "save output to FILE" },
      { flag: "-L", description: "follow redirects" },
    ],
    examples: [
      { command: "curl http://localhost", description: "Test your local web server" },
      { command: "curl -I https://example.com", description: "Show response headers" },
    ],
    run: curl,
  },
  { name: "wget", category: "networking", description: "Non-interactive network downloader (simulated web).", syntax: "wget [-O FILE] [-q] URL", examples: [{ command: "wget http://example.com", description: "Download a page to index.html" }], run: wget },
  { name: "nslookup", category: "networking", description: "Query DNS name servers.", syntax: "nslookup HOST", examples: [{ command: "nslookup ubuntu.com", description: "Resolve a domain" }], run: nslookup },
  { name: "dig", category: "networking", description: "DNS lookup utility.", syntax: "dig [+short] HOST", run: dig },
  { name: "host", category: "networking", description: "DNS lookup utility (simple output).", syntax: "host NAME", run: hostCmd },
  {
    name: "ss",
    category: "networking",
    description: "Investigate sockets (listening ports and connections).",
    syntax: "ss [-tulnp]",
    options: [
      { flag: "-t / -u", description: "TCP / UDP sockets" },
      { flag: "-l", description: "listening sockets only" },
      { flag: "-n", description: "numeric ports" },
      { flag: "-p", description: "show owning process (root)" },
    ],
    examples: [{ command: "ss -tuln", description: "Which ports are open?" }],
    run: ss,
  },
  {
    name: "route",
    package: "net-tools",
    binDir: "/usr/sbin",
    category: "networking",
    description: "Show the IP routing table (legacy).",
    syntax: "route [-n]",
    run: (ctx) => {
      const e = eth0(ctx);
      const n = ctx.args.includes("-n");
      ctx.out(`Kernel IP routing table
Destination     Gateway         Genmask         Flags Metric Ref    Use Iface
`);
      if (e?.up) {
        ctx.out(`${(n ? "0.0.0.0" : "default").padEnd(15)} ${(n ? ctx.state.network.gateway : "_gateway").padEnd(15)} 0.0.0.0         UG    100    0        0 ${e.name}
`);
        ctx.out(`${e.ipv4.split(".").slice(0, 3).join(".")}.0`.padEnd(15) + ` ${(n ? "0.0.0.0" : "0.0.0.0").padEnd(15)} 255.255.255.0   U     100    0        0 ${e.name}
`);
      }
      return 0;
    },
  },
  { name: "netstat", package: "net-tools", category: "networking", description: "Print network connections (legacy).", syntax: "netstat -tuln", run: netstat },
  { name: "traceroute", package: "traceroute", binDir: "/usr/sbin", category: "networking", description: "Print the route packets take to a host.", syntax: "traceroute HOST", run: traceroute },
  {
    name: "ssh",
    category: "security",
    description: "OpenSSH remote login client (connects to this simulated machine only).",
    syntax: "ssh [-p PORT] [USER@]HOST",
    examples: [{ command: "ssh john@localhost", description: "Log in as john over SSH" }],
    run: ssh,
  },
  {
    name: "ssh-keygen",
    category: "security",
    description: "Generate SSH authentication key pairs.",
    syntax: "ssh-keygen [-t ed25519|rsa] [-C COMMENT] [-f FILE] [-N PASSPHRASE]",
    examples: [{ command: 'ssh-keygen -t ed25519 -C "student@school"', description: "Create a key pair in ~/.ssh" }],
    run: sshKeygen,
  },
];
