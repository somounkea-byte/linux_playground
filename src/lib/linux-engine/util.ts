import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

const B64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function cryptB64(buf: Buffer): string {
  let out = "";
  for (const b of buf) out += B64[b & 63];
  return out;
}

/**
 * Hash a password for the simulated /etc/shadow. The format mimics Ubuntu's
 * yescrypt prefix, the digest is salted SHA-512. Passwords are never stored in
 * plain text.
 */
export function hashPassword(password: string, salt = cryptB64(randomBytes(16))): string {
  const digest = createHash("sha512").update(`${salt}$${password}`).digest();
  return `$y$j9T$${salt}$${cryptB64(digest).slice(0, 43)}`;
}

export function verifyPassword(password: string, hash: string): boolean {
  const m = /^\$y\$j9T\$([^$]+)\$(.+)$/.exec(hash);
  if (!m) return false;
  const expected = Buffer.from(hashPassword(password, m[1]));
  const actual = Buffer.from(hash);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Deterministic pseudo random number in [0,1) from an integer seed. */
export function seeded(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Convert a shell glob to a RegExp (supports *, ?, [...], [!...]). */
export function globToRegExp(glob: string, opts: { dotAll?: boolean } = {}): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end === -1) {
        re += "\\[";
        continue;
      }
      let cls = glob.slice(i + 1, end);
      if (cls.startsWith("!") || cls.startsWith("^")) cls = "^" + cls.slice(1);
      re += `[${cls.replace(/\\/g, "\\\\")}]`;
      i = end;
    } else if (c === "\\" && i + 1 < glob.length) {
      re += escapeRegExp(glob[++i]);
    } else re += escapeRegExp(c);
  }
  void opts;
  return new RegExp(`^${re}$`, "s");
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export function hasGlobChars(s: string): boolean {
  return /[*?[]/.test(s);
}

export function pad(s: string | number, width: number, right = false): string {
  const str = String(s);
  if (str.length >= width) return str;
  return right ? str.padEnd(width) : str.padStart(width);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const two = (n: number) => String(n).padStart(2, "0");

/** `ls -l` style timestamp. */
export function lsDate(ts: number, now: number): string {
  const d = new Date(ts);
  const sixMonths = 182 * 24 * 3600 * 1000;
  const mon = MONTHS[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, " ");
  if (Math.abs(now - ts) > sixMonths) return `${mon} ${day}  ${d.getUTCFullYear()}`;
  return `${mon} ${day} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** `date` default output: `Thu Nov 12 08:30:00 UTC 2026`. */
export function dateString(ts: number): string {
  const d = new Date(ts);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${two(d.getUTCHours())}:${two(
    d.getUTCMinutes(),
  )}:${two(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
}

/** syslog style timestamp: `Nov 12 08:30:00` */
export function syslogDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(
    d.getUTCSeconds(),
  )}`;
}

export function isoDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

export function fullIso(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(
    d.getUTCSeconds(),
  )}.${String(d.getUTCMilliseconds()).padStart(3, "0")}000000 +0000`;
}

export function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

export { MONTHS, DAYS };

/** Human readable size like `ls -h` / `df -h` (powers of 1024). */
export function humanSize(bytes: number, opts: { si?: boolean } = {}): string {
  const base = opts.si ? 1000 : 1024;
  const units = ["", "K", "M", "G", "T", "P"];
  let v = bytes;
  let i = 0;
  while (v >= base && i < units.length - 1) {
    v /= base;
    i++;
  }
  if (i === 0) return String(bytes);
  const rounded = v < 10 ? Math.ceil(v * 10) / 10 : Math.ceil(v);
  const str = rounded < 10 && !Number.isInteger(rounded) ? rounded.toFixed(1) : String(Math.round(rounded));
  return `${str}${units[i]}`;
}

/** Format a table with columns padded to the widest value. */
export function columns(rows: string[][], opts: { rightAlign?: number[]; gap?: number } = {}): string {
  const gap = opts.gap ?? 1;
  const widths: number[] = [];
  for (const row of rows) row.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, visibleLength(c))));
  return rows
    .map((row) =>
      row
        .map((c, i) => {
          if (i === row.length - 1 && !opts.rightAlign?.includes(i)) return c;
          const padLen = widths[i] - visibleLength(c);
          return opts.rightAlign?.includes(i) ? " ".repeat(padLen) + c : c + " ".repeat(padLen);
        })
        .join(" ".repeat(gap)),
    )
    .join("\n");
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

export const ansi = {
  reset: "\x1b[0m",
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  boldBlue: (s: string) => `\x1b[01;34m${s}\x1b[0m`,
  boldGreen: (s: string) => `\x1b[01;32m${s}\x1b[0m`,
  boldCyan: (s: string) => `\x1b[01;36m${s}\x1b[0m`,
  boldRed: (s: string) => `\x1b[01;31m${s}\x1b[0m`,
  matchRed: (s: string) => `\x1b[01;31m\x1b[K${s}\x1b[m\x1b[K`,
};

/** Lay out names in columns like `ls` does on an 80-column terminal. */
export function layoutColumns(items: { text: string; len: number }[], width = 80): string {
  if (items.length === 0) return "";
  const maxLen = Math.max(...items.map((i) => i.len));
  for (let cols = Math.min(items.length, Math.floor(width / 3)); cols >= 1; cols--) {
    const rows = Math.ceil(items.length / cols);
    const colWidths: number[] = [];
    for (let c = 0; c < cols; c++) {
      let w = 0;
      for (let r = 0; r < rows; r++) {
        const it = items[c * rows + r];
        if (it) w = Math.max(w, it.len);
      }
      colWidths.push(w);
    }
    const total = colWidths.reduce((a, b) => a + b, 0) + (cols - 1) * 2;
    if (total <= width || cols === 1) {
      const lines: string[] = [];
      for (let r = 0; r < rows; r++) {
        const parts: string[] = [];
        for (let c = 0; c < cols; c++) {
          const it = items[c * rows + r];
          if (!it) continue;
          const isLast = c === cols - 1 || !items[(c + 1) * rows + r];
          parts.push(isLast ? it.text : it.text + " ".repeat(colWidths[c] - it.len + 2));
        }
        lines.push(parts.join(""));
      }
      return lines.join("\n");
    }
  }
  void maxLen;
  return items.map((i) => i.text).join("\n");
}
