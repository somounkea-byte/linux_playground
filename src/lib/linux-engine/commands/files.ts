import { basename, dirname, FsError, normalizePath } from "../filesystem";
import { BINARY_MARKER } from "../interpreter";
import { canAccess, formatMode, modeToOctal, R, W, X } from "../permissions";
import type { FsNode } from "../types";
import { groupName, userName } from "../users";
import { ansi, columns, fullIso, globToRegExp, humanSize, layoutColumns, lsDate } from "../util";
import { errMsg, joinLines, resolve, withOpts } from "./helpers";
import type { CommandContext, CommandDef } from "./types";

const collator = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true });
export const lsCompare = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

const DEVICE_NUMBERS: Record<string, string> = {
  null: "1, 3",
  zero: "1, 5",
  random: "1, 8",
  urandom: "1, 9",
  tty: "5, 0",
  console: "5, 1",
  sda: "8, 0",
  sda1: "8, 1",
  sda2: "8, 2",
  sdb: "8, 16",
  sdb1: "8, 17",
  sr0: "11, 0",
};

export function inodeOf(node: FsNode): number {
  let h = 0;
  for (const c of node.id) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return 100000 + (h % 3900000);
}

function colorName(node: FsNode, name: string): string {
  switch (node.type) {
    case "dir":
      if (node.mode & 0o1000 && node.mode & 0o002) return `\x1b[30;42m${name}\x1b[0m`;
      if (node.mode & 0o002) return `\x1b[34;42m${name}\x1b[0m`;
      return ansi.boldBlue(name);
    case "symlink":
      return ansi.boldCyan(name);
    case "chardev":
    case "blockdev":
      return `\x1b[40;33;01m${name}\x1b[0m`;
    default:
      if (node.mode & 0o4000) return `\x1b[37;41m${name}\x1b[0m`;
      if (node.mode & 0o111) return ansi.boldGreen(name);
      if (/\.(tar|tgz|gz|zip|bz2|xz|deb|7z)$/.test(name)) return ansi.boldRed(name);
      if (/\.(png|jpg|jpeg|gif|svg)$/.test(name)) return `\x1b[01;35m${name}\x1b[0m`;
      return name;
  }
}

function classify(node: FsNode): string {
  if (node.type === "dir") return "/";
  if (node.type === "symlink") return "@";
  if (node.type === "file" && node.mode & 0o111) return "*";
  return "";
}

function linkCount(ctx: CommandContext, node: FsNode): number {
  if (node.type !== "dir") return 1;
  return 2 + ctx.fs.list(node).filter((c) => c.type === "dir").length;
}

function blocksKb(ctx: CommandContext, node: FsNode): number {
  if (node.type === "dir") return 4;
  if (node.type !== "file") return 0;
  return Math.ceil(ctx.fs.sizeOf(node) / 4096) * 4;
}

// ---------------------------------------------------------------------- ls

function ls(ctx: CommandContext): number {
  return withOpts(
    ctx,
    {
      flags: "aAlhRd1tSrFinCGgoU",
      long: {
        all: "a",
        "almost-all": "A",
        "human-readable": "h",
        recursive: "R",
        directory: "d",
        classify: "F",
        inode: "i",
        "numeric-uid-gid": "n",
        reverse: "r",
        "color=": "color",
        color: "color",
        help: "help",
      },
    },
    (o) => {
      if (o.flags.has("help")) {
        ctx.out("Usage: ls [OPTION]... [FILE]...\nList information about the FILEs (the current directory by default).\n\n  -a, --all                  do not ignore entries starting with .\n  -A, --almost-all           do not list implied . and ..\n  -d, --directory            list directories themselves, not their contents\n  -F, --classify             append indicator (one of */=>@|) to entries\n  -h, --human-readable       with -l, print sizes like 1K 234M 2G etc.\n  -i, --inode                print the index number of each file\n  -l                         use a long listing format\n  -r, --reverse              reverse order while sorting\n  -R, --recursive            list subdirectories recursively\n  -S                         sort by file size, largest first\n  -t                         sort by time, newest first\n  -1                         list one file per line\n");
        return 0;
      }
      const f = o.flags;
      const long = f.has("l") || f.has("n") || f.has("g") || f.has("o");
      const colorMode = o.values.color ?? (f.has("color") ? "always" : "never");
      const useColor = colorMode === "always" || ((colorMode === "auto" || colorMode === "tty") && ctx.stdoutIsTTY);
      const showAll = f.has("a");
      const almostAll = f.has("A") && !showAll;
      const onePerLine = f.has("1") || !ctx.stdoutIsTTY;
      let status = 0;
      const operands = o.operands.length ? o.operands : ["."];

      const sortEntries = (entries: { name: string; node: FsNode }[]) => {
        entries.sort((a, b) => lsCompare(a.name, b.name));
        if (f.has("t")) entries.sort((a, b) => b.node.mtime - a.node.mtime);
        if (f.has("S")) entries.sort((a, b) => ctx.fs.sizeOf(b.node) - ctx.fs.sizeOf(a.node));
        if (f.has("r")) entries.reverse();
        return entries;
      };

      const formatEntries = (entries: { name: string; node: FsNode }[], showTotal: boolean): string => {
        if (!long) {
          const items = entries.map((e) => {
            const display = (useColor ? colorName(e.node, e.name) : e.name) + (f.has("F") ? classify(e.node) : "");
            const ino = f.has("i") ? `${inodeOf(e.node)} ` : "";
            return { text: ino + display, len: (ino + e.name + (f.has("F") ? classify(e.node) : "")).length };
          });
          if (onePerLine) return items.map((i) => i.text).join("\n") + (items.length ? "\n" : "");
          const out = layoutColumns(items, 80);
          return out ? out + "\n" : "";
        }
        const rows: string[][] = [];
        let total = 0;
        for (const e of entries) {
          const n = e.node;
          total += blocksKb(ctx, n);
          const size = n.type === "chardev" || n.type === "blockdev" ? (DEVICE_NUMBERS[n.name] ?? "0, 0") : f.has("h") ? humanSize(ctx.fs.sizeOf(n)) : String(ctx.fs.sizeOf(n));
          let name = useColor ? colorName(n, e.name) : e.name;
          if (n.type === "symlink") name += ` -> ${n.target}`;
          else if (f.has("F")) name += classify(n);
          const owner = f.has("n") ? String(n.uid) : userName(ctx.state, n.uid);
          const group = f.has("n") ? String(n.gid) : groupName(ctx.state, n.gid);
          const row: string[] = [];
          if (f.has("i")) row.push(String(inodeOf(n)));
          row.push(formatMode(n), String(linkCount(ctx, n)));
          if (!f.has("g")) row.push(owner);
          if (!f.has("o") && !f.has("G")) row.push(group);
          row.push(size, lsDate(n.mtime, ctx.now), name);
          rows.push(row);
        }
        const right = f.has("i") ? [0, 2] : [1];
        const sizeCol = rows[0] ? rows[0].length - 3 : 0;
        right.push(sizeCol);
        const body = rows.length ? columns(rows, { rightAlign: right }) + "\n" : "";
        return (showTotal ? `total ${f.has("h") ? humanSize(total * 1024) : total}\n` : "") + body;
      };

      const listDir = (dir: FsNode, path: string): { name: string; node: FsNode }[] | null => {
        if (!canAccess(dir, ctx.who, R)) {
          ctx.err(`ls: cannot open directory '${path}': Permission denied\n`);
          status = 2;
          return null;
        }
        const entries = ctx.fs
          .list(dir)
          .filter((c) => showAll || almostAll || !c.name.startsWith("."))
          .map((c) => ({ name: c.name, node: c }));
        if (showAll) {
          entries.push({ name: ".", node: dir });
          const parent = dir.parentId ? ctx.fs.get(dir.parentId)! : dir;
          entries.push({ name: "..", node: parent });
        }
        // without search permission we can list names but not stat them
        return sortEntries(entries);
      };

      const files: { name: string; node: FsNode }[] = [];
      const dirs: { name: string; node: FsNode }[] = [];
      for (const op of operands) {
        try {
          let node = ctx.fs.lookup(op, ctx.cwd, ctx.who, false);
          if (node.type === "symlink" && (!long || op.endsWith("/"))) node = ctx.fs.lookup(op, ctx.cwd, ctx.who, true);
          if (node.type === "dir" && !f.has("d")) dirs.push({ name: op, node });
          else files.push({ name: op, node });
        } catch (e) {
          ctx.err(`ls: cannot access '${op}': ${errMsg(e)}\n`);
          status = 2;
        }
      }
      let out = "";
      if (files.length) out += formatEntries(sortEntries(files), false);
      const multiple = operands.length > 1 || f.has("R");
      const sortedDirs = dirs.sort((a, b) => lsCompare(a.name, b.name));
      sortedDirs.forEach((d, idx) => {
        const recurse = (node: FsNode, path: string, first: boolean) => {
          const entries = listDir(node, path);
          if (multiple) out += `${first && !files.length && idx === 0 ? "" : "\n"}${path}:\n`;
          if (!entries) return;
          out += formatEntries(entries, true);
          if (f.has("R")) {
            for (const e of entries) {
              if (e.node.type === "dir" && e.name !== "." && e.name !== "..") recurse(e.node, path === "/" ? `/${e.name}` : `${path}/${e.name}`, false);
            }
          }
        };
        recurse(d.node, d.name, true);
      });
      ctx.out(out);
      return status;
    },
  );
}

// ------------------------------------------------------------------- mkdir

function mkdir(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "pv", withValue: "m", long: { parents: "p", verbose: "v", "mode=": "m" } }, (o) => {
    if (!o.operands.length) {
      ctx.err("mkdir: missing operand\nTry 'mkdir --help' for more information.\n");
      return 1;
    }
    let status = 0;
    const umask = ctx.state.session.umask;
    let mode = 0o777 & ~umask;
    if (o.values.m) {
      if (!/^[0-7]{3,4}$/.test(o.values.m)) {
        ctx.err(`mkdir: invalid mode '${o.values.m}'\n`);
        return 1;
      }
      mode = parseInt(o.values.m, 8);
    }
    for (const dir of o.operands) {
      try {
        if (o.flags.has("p")) {
          const abs = normalizePath(dir, ctx.cwd);
          let cur = ctx.fs.root;
          let curPath = "";
          for (const comp of abs.split("/").filter(Boolean)) {
            curPath += "/" + comp;
            if (!canAccess(cur, ctx.who, X)) throw new FsError("EACCES");
            const existing = ctx.fs.child(cur, comp);
            if (existing) {
              const target = existing.type === "symlink" ? ctx.fs.lookup(curPath, "/") : existing;
              if (target.type !== "dir") throw new FsError("EEXIST");
              cur = target;
              continue;
            }
            if (!canAccess(cur, ctx.who, W | X)) throw new FsError("EACCES");
            cur = ctx.fs.create(cur, comp, "dir", { uid: ctx.who.uid, gid: ctx.who.gid, mode: curPath === abs ? mode : 0o777 & ~umask, now: ctx.now });
            if (o.flags.has("v")) {
              const base = ctx.cwd === "/" ? "/" : ctx.cwd + "/";
              const shown = !dir.startsWith("/") && curPath.startsWith(base) ? curPath.slice(base.length) : curPath;
              ctx.out(`mkdir: created directory '${shown}'\n`);
            }
          }
          continue;
        }
        const { parent, name } = ctx.fs.lookupParent(dir, ctx.cwd, ctx.who);
        if (ctx.fs.child(parent, name)) throw new FsError("EEXIST");
        ctx.fs.assertWritableDir(parent, ctx.who);
        ctx.fs.create(parent, name, "dir", { uid: ctx.who.uid, gid: parent.mode & 0o2000 ? parent.gid : ctx.who.gid, mode: mode | (parent.mode & 0o2000), now: ctx.now });
        if (o.flags.has("v")) ctx.out(`mkdir: created directory '${dir}'\n`);
      } catch (e) {
        ctx.err(`mkdir: cannot create directory ‘${dir}’: ${errMsg(e)}\n`);
        status = 1;
      }
    }
    return status;
  });
}

function rmdir(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "pv", long: { parents: "p", verbose: "v", "ignore-fail-on-non-empty": "ignore" } }, (o) => {
    if (!o.operands.length) {
      ctx.err("rmdir: missing operand\nTry 'rmdir --help' for more information.\n");
      return 1;
    }
    let status = 0;
    for (const dir of o.operands) {
      const targets = [dir];
      if (o.flags.has("p")) {
        let d = dir.replace(/\/+$/, "");
        while (d.includes("/")) {
          d = dirname(d);
          if (d === "/" || d === ".") break;
          targets.push(d);
        }
      }
      for (const t of targets) {
        try {
          const node = ctx.fs.lookup(t, ctx.cwd, ctx.who, false);
          if (node.type !== "dir") throw new FsError("ENOTDIR");
          if (ctx.fs.list(node).length) throw new FsError("ENOTEMPTY");
          if (node.id === ctx.fs.root.id) throw new FsError("EBUSY");
          const parent = ctx.fs.get(node.parentId!)!;
          ctx.fs.assertCanUnlink(parent, node, ctx.who);
          ctx.fs.remove(node, ctx.now);
          if (o.flags.has("v")) ctx.out(`rmdir: removing directory, '${t}'\n`);
        } catch (e) {
          if (o.flags.has("ignore") && e instanceof FsError && e.code === "ENOTEMPTY") break;
          ctx.err(`rmdir: failed to remove '${t}': ${errMsg(e)}\n`);
          status = 1;
          break;
        }
      }
    }
    return status;
  });
}

// ------------------------------------------------------------------- touch

function touch(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "acm", withValue: "dt", long: { "no-create": "c", "date=": "d" } }, (o) => {
    if (!o.operands.length) {
      ctx.err("touch: missing file operand\nTry 'touch --help' for more information.\n");
      return 1;
    }
    let status = 0;
    for (const file of o.operands) {
      try {
        const existing = ctx.fs.tryLookup(file, ctx.cwd, ctx.who);
        if (existing) {
          if (existing.uid !== ctx.who.uid && !canAccess(existing, ctx.who, W)) throw new FsError("EACCES");
          existing.mtime = ctx.now;
          continue;
        }
        if (o.flags.has("c")) continue;
        const { parent, name } = ctx.fs.lookupParent(file, ctx.cwd, ctx.who);
        ctx.fs.assertWritableDir(parent, ctx.who);
        ctx.fs.create(parent, name, "file", { uid: ctx.who.uid, gid: parent.mode & 0o2000 ? parent.gid : ctx.who.gid, mode: 0o666 & ~ctx.state.session.umask, now: ctx.now });
      } catch (e) {
        ctx.err(`touch: cannot touch '${file}': ${errMsg(e)}\n`);
        status = 1;
      }
    }
    return status;
  });
}

// ---------------------------------------------------------------- cp / mv

function describeType(n: FsNode) {
  if (n.type === "dir") return "directory";
  if (n.type === "symlink") return "symbolic link";
  return ctx0Size(n) === 0 ? "regular empty file" : "regular file";
}
function ctx0Size(n: FsNode) {
  return n.size ?? n.content.length;
}

function confirm(ctx: CommandContext, question: string): boolean {
  const answer = ctx.shell.readInput(question, false);
  return /^y/i.test(answer.trim());
}

function cp(ctx: CommandContext): number {
  return withOpts(
    ctx,
    { flags: "rRapvifnuLPd", long: { recursive: "r", archive: "a", verbose: "v", interactive: "i", force: "f", "no-clobber": "n", update: "u", preserve: "p", "preserve=": "p" } },
    (o) => {
      const f = o.flags;
      const recursive = f.has("r") || f.has("R") || f.has("a");
      const preserve = f.has("a") || f.has("p");
      if (o.operands.length === 0) {
        ctx.err("cp: missing file operand\nTry 'cp --help' for more information.\n");
        return 1;
      }
      if (o.operands.length === 1) {
        ctx.err(`cp: missing destination file operand after '${o.operands[0]}'\nTry 'cp --help' for more information.\n`);
        return 1;
      }
      const sources = o.operands.slice(0, -1);
      const dest = o.operands[o.operands.length - 1];
      const destNode = ctx.fs.tryLookup(dest, ctx.cwd, ctx.who);
      const destIsDir = destNode?.type === "dir";
      if (sources.length > 1 && !destIsDir) {
        ctx.err(`cp: target '${dest}' is not a directory\n`);
        return 1;
      }
      let status = 0;
      const copyInto = (src: FsNode, srcLabel: string, parent: FsNode, name: string, label: string): boolean => {
        const existing = ctx.fs.child(parent, name);
        if (src.type === "dir") {
          if (!canAccess(src, ctx.who, R | X)) {
            ctx.err(`cp: cannot access '${srcLabel}': Permission denied\n`);
            return false;
          }
          let target = existing;
          if (target && target.type !== "dir") {
            ctx.err(`cp: cannot overwrite non-directory '${label}' with directory '${srcLabel}'\n`);
            return false;
          }
          if (!target) {
            if (!canAccess(parent, ctx.who, W | X)) {
              ctx.err(`cp: cannot create directory '${label}': Permission denied\n`);
              return false;
            }
            target = ctx.fs.create(parent, name, "dir", { uid: preserve ? src.uid : ctx.who.uid, gid: preserve ? src.gid : ctx.who.gid, mode: src.mode, now: preserve ? src.mtime : ctx.now });
            if (f.has("v")) ctx.out(`'${srcLabel}' -> '${label}'\n`);
          }
          let ok = true;
          for (const child of ctx.fs.list(src).sort((a, b) => lsCompare(a.name, b.name))) {
            if (child.id === target.id) continue;
            ok = copyInto(child, `${srcLabel}/${child.name}`, target, child.name, `${label}/${child.name}`) && ok;
          }
          return ok;
        }
        if (src.type === "file" && !canAccess(src, ctx.who, R)) {
          ctx.err(`cp: cannot open '${srcLabel}' for reading: Permission denied\n`);
          return false;
        }
        if (existing) {
          if (existing.id === src.id) {
            ctx.err(`cp: '${srcLabel}' and '${label}' are the same file\n`);
            return false;
          }
          if (f.has("n")) return true;
          if (f.has("u") && existing.mtime >= src.mtime) return true;
          if (f.has("i") && !confirm(ctx, `cp: overwrite '${label}'? `)) return true;
          if (existing.type === "dir") {
            ctx.err(`cp: cannot overwrite directory '${label}' with non-directory\n`);
            return false;
          }
          if (!canAccess(existing, ctx.who, W)) {
            if (f.has("f") && canAccess(parent, ctx.who, W | X)) ctx.fs.remove(existing, ctx.now);
            else {
              ctx.err(`cp: cannot create regular file '${label}': Permission denied\n`);
              return false;
            }
          } else {
            ctx.fs.writeContent(existing, ctx.shell.readFileContent(src), false, ctx.now);
            if (preserve) {
              existing.mode = src.mode;
              existing.mtime = src.mtime;
              if (ctx.who.uid === 0) {
                existing.uid = src.uid;
                existing.gid = src.gid;
              }
            }
            if (f.has("v")) ctx.out(`'${srcLabel}' -> '${label}'\n`);
            return true;
          }
        }
        if (!canAccess(parent, ctx.who, W | X)) {
          ctx.err(`cp: cannot create regular file '${label}': Permission denied\n`);
          return false;
        }
        const isRootPreserve = preserve && ctx.who.uid === 0;
        ctx.fs.create(parent, name, src.type === "symlink" ? "symlink" : "file", {
          uid: isRootPreserve ? src.uid : ctx.who.uid,
          gid: isRootPreserve ? src.gid : parent.mode & 0o2000 ? parent.gid : ctx.who.gid,
          mode: preserve ? src.mode : src.mode & ~ctx.state.session.umask & 0o7777,
          content: src.type === "file" ? ctx.shell.readFileContent(src) : "",
          target: src.target,
          size: src.size,
          now: preserve ? src.mtime : ctx.now,
        });
        if (f.has("v")) ctx.out(`'${srcLabel}' -> '${label}'\n`);
        return true;
      };

      for (const s of sources) {
        let src: FsNode;
        try {
          src = ctx.fs.lookup(s, ctx.cwd, ctx.who, !(f.has("P") || f.has("d") || f.has("a")) || !recursive);
        } catch (e) {
          ctx.err(`cp: cannot stat '${s}': ${errMsg(e)}\n`);
          status = 1;
          continue;
        }
        if (src.type === "dir" && !recursive) {
          ctx.err(`cp: -r not specified; omitting directory '${s}'\n`);
          status = 1;
          continue;
        }
        try {
          let parent: FsNode;
          let name: string;
          let label: string;
          if (destIsDir) {
            parent = destNode!;
            name = basename(s);
            label = `${dest.replace(/\/+$/, "")}/${name}`;
          } else {
            const p = ctx.fs.lookupParent(dest, ctx.cwd, ctx.who);
            parent = p.parent;
            name = p.name;
            label = dest;
          }
          if (src.type === "dir" && ctx.fs.isAncestor(src, parent)) {
            ctx.err(`cp: cannot copy a directory, '${s}', into itself, '${label}'\n`);
            status = 1;
            continue;
          }
          if (!copyInto(src, s, parent, name, label)) status = 1;
        } catch (e) {
          ctx.err(`cp: cannot create regular file '${dest}': ${errMsg(e)}\n`);
          status = 1;
        }
      }
      return status;
    },
  );
}

function mv(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "fivnuT", long: { force: "f", interactive: "i", verbose: "v", "no-clobber": "n", update: "u" } }, (o) => {
    const f = o.flags;
    if (o.operands.length === 0) {
      ctx.err("mv: missing file operand\nTry 'mv --help' for more information.\n");
      return 1;
    }
    if (o.operands.length === 1) {
      ctx.err(`mv: missing destination file operand after '${o.operands[0]}'\nTry 'mv --help' for more information.\n`);
      return 1;
    }
    const sources = o.operands.slice(0, -1);
    const dest = o.operands[o.operands.length - 1];
    const destNode = ctx.fs.tryLookup(dest, ctx.cwd, ctx.who);
    const destIsDir = destNode?.type === "dir";
    if (sources.length > 1 && !destIsDir) {
      ctx.err(`mv: target '${dest}' is not a directory\n`);
      return 1;
    }
    let status = 0;
    for (const s of sources) {
      let src: FsNode;
      try {
        src = ctx.fs.lookup(s, ctx.cwd, ctx.who, false);
      } catch (e) {
        ctx.err(`mv: cannot stat '${s}': ${errMsg(e)}\n`);
        status = 1;
        continue;
      }
      let parent: FsNode;
      let name: string;
      let label: string;
      try {
        if (destIsDir) {
          parent = destNode!;
          name = basename(s);
          label = `${dest.replace(/\/+$/, "")}/${name}`;
        } else {
          const p = ctx.fs.lookupParent(dest, ctx.cwd, ctx.who);
          parent = p.parent;
          name = p.name;
          label = dest;
        }
      } catch (e) {
        ctx.err(`mv: cannot move '${s}' to '${dest}': ${errMsg(e)}\n`);
        status = 1;
        continue;
      }
      if (src.type === "dir" && ctx.fs.isAncestor(src, parent)) {
        ctx.err(`mv: cannot move '${s}' to a subdirectory of itself, '${label}'\n`);
        status = 1;
        continue;
      }
      const existing = ctx.fs.child(parent, name);
      if (existing && existing.id === src.id) {
        ctx.err(`mv: '${s}' and '${label}' are the same file\n`);
        status = 1;
        continue;
      }
      if (existing) {
        if (f.has("n")) continue;
        if (f.has("u") && existing.mtime >= src.mtime) continue;
        if (f.has("i") && !confirm(ctx, `mv: overwrite '${label}'? `)) continue;
        if (existing.type === "dir" && src.type !== "dir") {
          ctx.err(`mv: cannot overwrite directory '${label}' with non-directory\n`);
          status = 1;
          continue;
        }
        if (existing.type === "dir" && ctx.fs.list(existing).length) {
          ctx.err(`mv: cannot move '${s}' to '${label}': Directory not empty\n`);
          status = 1;
          continue;
        }
        if (existing.type !== "dir" && src.type === "dir") {
          ctx.err(`mv: cannot overwrite non-directory '${label}' with directory '${s}'\n`);
          status = 1;
          continue;
        }
      }
      try {
        const srcParent = ctx.fs.get(src.parentId!)!;
        ctx.fs.assertCanUnlink(srcParent, src, ctx.who);
        ctx.fs.assertWritableDir(parent, ctx.who);
        if (existing) ctx.fs.assertCanUnlink(parent, existing, ctx.who);
        ctx.fs.move(src, parent, name, ctx.now);
        if (f.has("v")) ctx.out(`renamed '${s}' -> '${label}'\n`);
      } catch (e) {
        ctx.err(`mv: cannot move '${s}' to '${label}': ${errMsg(e)}\n`);
        status = 1;
      }
    }
    return status;
  });
}

// ---------------------------------------------------------------------- rm

function rm(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "rRfivdI", long: { recursive: "r", force: "f", interactive: "i", verbose: "v", dir: "d", "no-preserve-root": "nopreserve", "preserve-root": "preserve" } }, (o) => {
    const f = o.flags;
    const recursive = f.has("r") || f.has("R");
    const force = f.has("f");
    if (!o.operands.length) {
      if (force) return 0;
      ctx.err("rm: missing operand\nTry 'rm --help' for more information.\n");
      return 1;
    }
    let status = 0;
    const removeTree = (node: FsNode, label: string): boolean => {
      if (node.type === "dir") {
        if (f.has("i") && !confirm(ctx, `rm: descend into directory '${label}'? `)) return false;
        if (!canAccess(node, ctx.who, R | W | X) && ctx.fs.list(node).length) {
          if (!canAccess(node, ctx.who, R)) {
            ctx.err(`rm: cannot remove '${label}': Permission denied\n`);
            return false;
          }
        }
        let ok = true;
        for (const child of ctx.fs.list(node)) {
          try {
            ctx.fs.assertCanUnlink(node, child, ctx.who);
          } catch (e) {
            ctx.err(`rm: cannot remove '${label}/${child.name}': ${errMsg(e)}\n`);
            ok = false;
            continue;
          }
          ok = removeTree(child, `${label}/${child.name}`) && ok;
        }
        if (!ok) return false;
        if (f.has("i") && !confirm(ctx, `rm: remove directory '${label}'? `)) return false;
        const parent = ctx.fs.get(node.parentId!)!;
        try {
          ctx.fs.assertCanUnlink(parent, node, ctx.who);
        } catch (e) {
          ctx.err(`rm: cannot remove '${label}': ${errMsg(e)}\n`);
          return false;
        }
        ctx.fs.remove(node, ctx.now);
        if (f.has("v")) ctx.out(`removed directory '${label}'\n`);
        return true;
      }
      if (f.has("i") && !confirm(ctx, `rm: remove ${describeType(node)} '${label}'? `)) return true;
      if (!force && !f.has("i") && node.type === "file" && !canAccess(node, ctx.who, W) && ctx.stdin.tty) {
        if (!confirm(ctx, `rm: remove write-protected ${describeType(node)} '${label}'? `)) return true;
      }
      ctx.fs.remove(node, ctx.now);
      if (f.has("v")) ctx.out(`removed '${label}'\n`);
      return true;
    };

    for (const target of o.operands) {
      const abs = normalizePath(target, ctx.cwd);
      if (abs === "/" && recursive && !f.has("nopreserve")) {
        ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
        status = 1;
        continue;
      }
      if (/(^|\/)\.\.?\/?$/.test(target)) {
        ctx.err(`rm: refusing to remove '.' or '..' directory: skipping '${target}'\n`);
        status = 1;
        continue;
      }
      let node: FsNode;
      try {
        node = ctx.fs.lookup(target, ctx.cwd, ctx.who, false);
      } catch (e) {
        if (force && e instanceof FsError && e.code === "ENOENT") continue;
        ctx.err(`rm: cannot remove '${target}': ${errMsg(e)}\n`);
        status = 1;
        continue;
      }
      if (node.type === "dir" && !recursive) {
        if (f.has("d") && ctx.fs.list(node).length === 0) {
          // rm -d removes empty dirs
        } else {
          ctx.err(`rm: cannot remove '${target}': Is a directory\n`);
          status = 1;
          continue;
        }
      }
      const parent = ctx.fs.get(node.parentId!)!;
      try {
        ctx.fs.assertCanUnlink(parent, node, ctx.who);
      } catch (e) {
        ctx.err(`rm: cannot remove '${target}': ${errMsg(e)}\n`);
        status = 1;
        continue;
      }
      if (!removeTree(node, target.replace(/\/+$/, "") || target)) status = 1;
    }
    return status;
  });
}

// ---------------------------------------------------------------------- ln

function ln(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "sfvnrT", long: { symbolic: "s", force: "f", verbose: "v" } }, (o) => {
    if (!o.operands.length) {
      ctx.err("ln: missing file operand\nTry 'ln --help' for more information.\n");
      return 1;
    }
    const target = o.operands[0];
    let linkName = o.operands[1] ?? basename(target);
    const linkNode = ctx.fs.tryLookup(linkName, ctx.cwd, ctx.who);
    if (linkNode?.type === "dir" && !o.flags.has("n")) linkName = `${linkName.replace(/\/+$/, "")}/${basename(target)}`;
    try {
      const { parent, name } = ctx.fs.lookupParent(linkName, ctx.cwd, ctx.who);
      const existing = ctx.fs.child(parent, name);
      if (existing) {
        if (!o.flags.has("f")) {
          ctx.err(`ln: failed to create ${o.flags.has("s") ? "symbolic" : "hard"} link '${linkName}': File exists\n`);
          return 1;
        }
        ctx.fs.assertCanUnlink(parent, existing, ctx.who);
        ctx.fs.remove(existing, ctx.now);
      }
      ctx.fs.assertWritableDir(parent, ctx.who);
      if (o.flags.has("s")) {
        ctx.fs.create(parent, name, "symlink", { uid: ctx.who.uid, gid: ctx.who.gid, mode: 0o777, target, now: ctx.now });
      } else {
        const src = ctx.fs.lookup(target, ctx.cwd, ctx.who);
        if (src.type === "dir") {
          ctx.err(`ln: ${target}: hard link not allowed for directory\n`);
          return 1;
        }
        // hard links are approximated by a copy sharing owner and mode
        ctx.fs.create(parent, name, src.type, { uid: src.uid, gid: src.gid, mode: src.mode, content: src.content, size: src.size, now: src.mtime });
      }
      if (o.flags.has("v")) ctx.out(`'${linkName}' -> '${target}'\n`);
      return 0;
    } catch (e) {
      ctx.err(`ln: failed to create ${o.flags.has("s") ? "symbolic" : "hard"} link '${linkName}': ${errMsg(e)}\n`);
      return 1;
    }
  });
}

// -------------------------------------------------------------------- stat

function fileTypeName(ctx: CommandContext, n: FsNode): string {
  switch (n.type) {
    case "dir":
      return "directory";
    case "symlink":
      return "symbolic link";
    case "chardev":
      return "character special file";
    case "blockdev":
      return "block special file";
    default:
      return ctx.fs.sizeOf(n) === 0 ? "regular empty file" : "regular file";
  }
}

function stat(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "Lt", withValue: "c", long: { "format=": "c", dereference: "L" } }, (o) => {
    if (!o.operands.length) {
      ctx.err("stat: missing operand\nTry 'stat --help' for more information.\n");
      return 1;
    }
    let status = 0;
    for (const p of o.operands) {
      try {
        const n = ctx.fs.lookup(p, ctx.cwd, ctx.who, o.flags.has("L"));
        const size = ctx.fs.sizeOf(n);
        const owner = userName(ctx.state, n.uid);
        const group = groupName(ctx.state, n.gid);
        if (o.values.c !== undefined) {
          const out = o.values.c.replace(/%([aAUuGgsnFNixyY%])/g, (_, k: string) => {
            switch (k) {
              case "a":
                return modeToOctal(n.mode, 1).replace(/^0+(?=\d)/, "");
              case "A":
                return formatMode(n);
              case "U":
                return owner;
              case "u":
                return String(n.uid);
              case "G":
                return group;
              case "g":
                return String(n.gid);
              case "s":
                return String(size);
              case "n":
                return p;
              case "N":
                return `'${p}'`;
              case "F":
                return fileTypeName(ctx, n);
              case "i":
                return String(inodeOf(n));
              case "x":
              case "y":
                return fullIso(n.mtime);
              case "Y":
                return String(Math.floor(n.mtime / 1000));
              default:
                return "%";
            }
          });
          ctx.out(out + "\n");
          continue;
        }
        const blocks = Math.ceil(size / 4096) * 8;
        const name = n.type === "symlink" ? `${p} -> ${n.target}` : p;
        ctx.out(
          `  File: ${name}\n  Size: ${String(size).padEnd(10)}\tBlocks: ${String(n.type === "dir" ? 8 : blocks).padEnd(10)} IO Block: 4096   ${fileTypeName(ctx, n)}\n` +
            `Device: 8,2\tInode: ${String(inodeOf(n)).padEnd(11)} Links: ${linkCount(ctx, n)}\n` +
            `Access: (${modeToOctal(n.mode, 4)}/${formatMode(n)})  Uid: (${String(n.uid).padStart(5)}/${owner.padStart(8)})   Gid: (${String(n.gid).padStart(5)}/${group.padStart(8)})\n` +
            `Access: ${fullIso(n.mtime)}\nModify: ${fullIso(n.mtime)}\nChange: ${fullIso(n.ctime)}\n Birth: ${fullIso(n.ctime)}\n`,
        );
      } catch (e) {
        ctx.err(`stat: cannot statx '${p}': ${errMsg(e)}\n`);
        status = 1;
      }
    }
    return status;
  });
}

export function describeFile(ctx: CommandContext, n: FsNode): string {
  if (n.type === "dir") return n.mode & 0o1000 ? "sticky, directory" : "directory";
  if (n.type === "symlink") return `symbolic link to ${n.target}`;
  if (n.type === "chardev") return `character special (${(DEVICE_NUMBERS[n.name] ?? "1, 3").replace(", ", "/")})`;
  if (n.type === "blockdev") return `block special (${(DEVICE_NUMBERS[n.name] ?? "8, 0").replace(", ", "/")})`;
  const c = n.content;
  if (c.startsWith(BINARY_MARKER)) return "ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 3.2.0, stripped";
  if (ctx.fs.sizeOf(n) === 0) return "empty";
  const exec = n.mode & 0o111 ? " executable" : "";
  const first = c.split("\n", 1)[0];
  const ascii = /^[\x09\x0a\x0d\x20-\x7e]*$/.test(c) ? "ASCII text" : "Unicode text, UTF-8 text";
  if (/^#!.*\bbash\b/.test(first)) return `Bourne-Again shell script, ${ascii}${exec}`;
  if (/^#!.*\bsh\b/.test(first)) return `POSIX shell script, ${ascii}${exec}`;
  if (/^#!.*python/.test(first)) return `Python script, ${ascii}${exec}`;
  if (/^\s*<!doctype html|^\s*<html/i.test(c)) return `HTML document, ${ascii}`;
  if (/^\s*[{[]/.test(c) && (() => { try { JSON.parse(c); return true; } catch { return false; } })()) return "JSON text data";
  if (c.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")) return "OpenSSH private key";
  if (c.startsWith("ssh-")) return "OpenSSH ED25519 public key";
  return ascii + (c.endsWith("\n") || !c.includes("\n") ? "" : ", with no line terminators");
}

function file(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "bLi" }, (o) => {
    if (!o.operands.length) {
      ctx.err("Usage: file [-bchikLlNnprsSvzZ0] [--apple] [--extension] [--mime-encoding]\n            [--mime-type] [-e <testname>] [-F <separator>]  [-f <namefile>]\n            [-m <magicfiles>] [-P <parameter=value>] [--exclude-quiet]\n            <file> ...\n");
      return 1;
    }
    for (const p of o.operands) {
      const n = ctx.fs.tryLookup(p, ctx.cwd, ctx.who, o.flags.has("L"));
      const prefix = o.flags.has("b") ? "" : `${p}: `;
      if (!n) ctx.out(`${prefix}cannot open \`${p}' (No such file or directory)\n`);
      else if (n.type === "file" && !canAccess(n, ctx.who, R)) ctx.out(`${prefix}regular file, no read permission\n`);
      else ctx.out(prefix + describeFile(ctx, n) + "\n");
    }
    return 0;
  });
}

// -------------------------------------------------------------------- tree

function tree(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "adfFC", withValue: "LI", long: { help: "help", noreport: "noreport" } }, (o) => {
    const roots = o.operands.length ? o.operands : ["."];
    const maxDepth = o.values.L ? Number(o.values.L) : Infinity;
    const ignore = o.values.I ? globToRegExp(o.values.I) : null;
    let dirs = 0;
    let files = 0;
    const color = ctx.stdoutIsTTY;
    for (const root of roots) {
      let node: FsNode;
      try {
        node = ctx.fs.lookup(root, ctx.cwd, ctx.who);
      } catch {
        ctx.out(`${root}  [error opening dir]\n`);
        continue;
      }
      ctx.out((color && node.type === "dir" ? ansi.boldBlue(root) : root) + "\n");
      const walk = (dir: FsNode, prefix: string, depth: number) => {
        if (depth > maxDepth) return;
        if (!canAccess(dir, ctx.who, R)) return;
        let kids = ctx.fs.list(dir).filter((k) => (o.flags.has("a") || !k.name.startsWith(".")) && (!ignore || !ignore.test(k.name)));
        if (o.flags.has("d")) kids = kids.filter((k) => k.type === "dir");
        kids.sort((a, b) => lsCompare(a.name, b.name));
        kids.forEach((k, i) => {
          const last = i === kids.length - 1;
          let name = color ? colorName(k, k.name) : k.name;
          if (k.type === "symlink") name += ` -> ${k.target}`;
          if (o.flags.has("F")) name += classify(k);
          ctx.out(`${prefix}${last ? "└── " : "├── "}${name}\n`);
          if (k.type === "dir") {
            dirs++;
            if (!canAccess(k, ctx.who, R)) {
              ctx.out(`${prefix}${last ? "    " : "│   "}  [error opening dir]\n`);
            } else walk(k, prefix + (last ? "    " : "│   "), depth + 1);
          } else files++;
        });
      };
      if (node.type === "dir") walk(node, "", 1);
    }
    if (!o.flags.has("noreport")) ctx.out(`\n${dirs} director${dirs === 1 ? "y" : "ies"}${o.flags.has("d") ? "" : `, ${files} file${files === 1 ? "" : "s"}`}\n`);
    return 0;
  });
}

// -------------------------------------------------------------------- find

type FindPred = (n: FsNode, path: string, depth: number) => boolean;

function find(ctx: CommandContext): number {
  const args = ctx.args;
  const paths: string[] = [];
  let i = 0;
  while (i < args.length && !args[i].startsWith("-") && args[i] !== "!" && args[i] !== "(") paths.push(args[i++]);
  if (!paths.length) paths.push(".");
  let maxDepth = Infinity;
  let minDepth = 0;
  let hasAction = false;
  let status = 0;
  const actions: string[] = [];
  const pending: (() => void)[] = [];

  const parsePrimary = (): FindPred => {
    const a = args[i++];
    const need = () => {
      const v = args[i++];
      if (v === undefined) throw new Error(`missing argument to \`${a}'`);
      return v;
    };
    switch (a) {
      case "(": {
        const p = parseOr();
        if (args[i++] !== ")") throw new Error("invalid expression; I was expecting to find a ')' somewhere but did not see one.");
        return p;
      }
      case "!":
      case "-not": {
        const p = parsePrimary();
        return (n, path, d) => !p(n, path, d);
      }
      case "-name":
      case "-iname": {
        const pat = need();
        const re = globToRegExp(pat);
        const rei = new RegExp(re.source, "is");
        return (n, path) => (a === "-iname" ? rei : re).test(path === "/" ? "/" : basename(path));
      }
      case "-path":
      case "-wholename": {
        const re = globToRegExp(need());
        return (_n, path) => new RegExp(re.source.replace(/\[\^\/\]\*/g, ".*"), "s").test(path);
      }
      case "-type": {
        const t = need();
        const map: Record<string, string> = { f: "file", d: "dir", l: "symlink", c: "chardev", b: "blockdev" };
        if (!map[t]) throw new Error(`Unknown argument to -type: ${t}`);
        return (n) => n.type === map[t];
      }
      case "-size": {
        const s = need();
        const m = /^([+-]?)(\d+)([ckMGb]?)$/.exec(s);
        if (!m) throw new Error(`invalid -size type \`${s}'`);
        const unit = { c: 1, k: 1024, M: 1024 ** 2, G: 1024 ** 3, b: 512, "": 512 }[m[3]] as number;
        const v = Number(m[2]);
        return (n) => {
          const units = Math.ceil(ctx.fs.sizeOf(n) / unit);
          return m[1] === "+" ? units > v : m[1] === "-" ? units < v : units === v;
        };
      }
      case "-empty":
        return (n) => (n.type === "dir" ? ctx.fs.list(n).length === 0 : n.type === "file" && ctx.fs.sizeOf(n) === 0);
      case "-user": {
        const u = need();
        return (n) => userName(ctx.state, n.uid) === u || String(n.uid) === u;
      }
      case "-group": {
        const g = need();
        return (n) => groupName(ctx.state, n.gid) === g || String(n.gid) === g;
      }
      case "-nouser":
        return (n) => !ctx.state.users.some((u) => u.uid === n.uid);
      case "-perm": {
        const p = need();
        const m = /^([-/]?)([0-7]{3,4})$/.exec(p);
        if (!m) throw new Error(`invalid mode \`${p}'`);
        const v = parseInt(m[2], 8);
        return (n) => (m[1] === "-" ? (n.mode & v) === v : m[1] === "/" ? (n.mode & v) !== 0 : (n.mode & 0o7777) === v);
      }
      case "-mtime":
      case "-mmin": {
        const s = need();
        const m = /^([+-]?)(\d+)$/.exec(s);
        if (!m) throw new Error(`invalid argument \`${s}' to \`${a}'`);
        const unitMs = a === "-mtime" ? 86400000 : 60000;
        const v = Number(m[2]);
        return (n) => {
          const age = Math.floor((ctx.now - n.mtime) / unitMs);
          return m[1] === "+" ? age > v : m[1] === "-" ? age < v : age === v;
        };
      }
      case "-newer": {
        const ref = ctx.fs.tryLookup(need(), ctx.cwd, ctx.who);
        return (n) => !!ref && n.mtime > ref.mtime;
      }
      case "-maxdepth":
        maxDepth = Number(need());
        return () => true;
      case "-mindepth":
        minDepth = Number(need());
        return () => true;
      case "-print":
        hasAction = true;
        return (_n, path) => {
          ctx.out(path + "\n");
          return true;
        };
      case "-ls":
        hasAction = true;
        return (n, path) => {
          ctx.out(`${String(inodeOf(n)).padStart(8)} ${String(blocksKb(ctx, n)).padStart(6)} ${formatMode(n)} ${String(linkCount(ctx, n)).padStart(3)} ${userName(ctx.state, n.uid).padEnd(8)} ${groupName(ctx.state, n.gid).padEnd(8)} ${String(ctx.fs.sizeOf(n)).padStart(8)} ${lsDate(n.mtime, ctx.now)} ${path}\n`);
          return true;
        };
      case "-delete":
        hasAction = true;
        actions.push("delete");
        return (n, path) => {
          pending.push(() => {
            const cur = ctx.fs.get(n.id);
            if (!cur) return;
            try {
              if (cur.type === "dir" && ctx.fs.list(cur).length) throw new FsError("ENOTEMPTY");
              ctx.fs.assertCanUnlink(ctx.fs.get(cur.parentId!)!, cur, ctx.who);
              ctx.fs.remove(cur, ctx.now);
            } catch (e) {
              ctx.err(`find: cannot delete ‘${path}’: ${errMsg(e)}\n`);
              status = 1;
            }
          });
          return true;
        };
      case "-exec":
      case "-ok": {
        hasAction = true;
        const cmd: string[] = [];
        while (i < args.length && args[i] !== ";" && args[i] !== "+") cmd.push(args[i++]);
        if (i >= args.length) throw new Error(`missing argument to \`${a}'`);
        const plus = args[i] === "+";
        i++;
        if (plus) {
          const collected: string[] = [];
          pending.push(() => {
            if (!collected.length) return;
            const argv = cmd.flatMap((c) => (c === "{}" ? collected : [c]));
            ctx.shell.runArgv(argv, ctx.shell.ioFromContext(ctx));
          });
          return (_n, path) => {
            collected.push(path);
            return true;
          };
        }
        return (_n, path) => {
          const argv = cmd.map((c) => c.replace(/\{\}/g, path));
          return ctx.shell.runArgv(argv, ctx.shell.ioFromContext(ctx)) === 0;
        };
      }
      case "-true":
        return () => true;
      case "-false":
        return () => false;
      default:
        if (a?.startsWith("-")) throw new Error(`unknown predicate \`${a}'`);
        throw new Error(`paths must precede expression: \`${a}'`);
    }
  };
  const parseAnd = (): FindPred => {
    let left = parsePrimary();
    while (i < args.length && args[i] !== "-o" && args[i] !== "-or" && args[i] !== ")" && args[i] !== ",") {
      if (args[i] === "-a" || args[i] === "-and") i++;
      const l = left;
      const r = parsePrimary();
      left = (n, p, d) => l(n, p, d) && r(n, p, d);
    }
    return left;
  };
  const parseOr = (): FindPred => {
    let left = parseAnd();
    while (args[i] === "-o" || args[i] === "-or") {
      i++;
      const l = left;
      const r = parseAnd();
      left = (n, p, d) => l(n, p, d) || r(n, p, d);
    }
    return left;
  };

  let pred: FindPred = () => true;
  try {
    if (i < args.length) pred = parseOr();
  } catch (e) {
    ctx.err(`find: ${(e as Error).message}\n`);
    return 1;
  }
  void actions;
  for (const start of paths) {
    let root: FsNode;
    try {
      root = ctx.fs.lookup(start, ctx.cwd, ctx.who);
    } catch (e) {
      ctx.err(`find: ‘${start}’: ${errMsg(e)}\n`);
      status = 1;
      continue;
    }
    const visit = (n: FsNode, path: string, depth: number) => {
      if (depth >= minDepth) {
        const ok = pred(n, path, depth);
        if (ok && !hasAction) ctx.out(path + "\n");
      }
      if (n.type !== "dir" || depth >= maxDepth) return;
      if (!canAccess(n, ctx.who, R | X)) {
        ctx.err(`find: ‘${path}’: Permission denied\n`);
        status = 1;
        return;
      }
      for (const k of ctx.fs.list(n).sort((a, b) => a.name.localeCompare(b.name))) {
        visit(k, path.endsWith("/") ? path + k.name : `${path}/${k.name}`, depth + 1);
      }
    };
    visit(root, start, 0);
  }
  pending.reverse().forEach((fn) => fn());
  return status;
}

// --------------------------------------------------------------- path utils

function basenameCmd(ctx: CommandContext): number {
  if (!ctx.args.length) {
    ctx.err("basename: missing operand\nTry 'basename --help' for more information.\n");
    return 1;
  }
  const [p, suffix] = ctx.args;
  let b = basename(p);
  if (suffix && b.endsWith(suffix) && b !== suffix) b = b.slice(0, -suffix.length);
  ctx.out(b + "\n");
  return 0;
}

function dirnameCmd(ctx: CommandContext): number {
  if (!ctx.args.length) {
    ctx.err("dirname: missing operand\nTry 'dirname --help' for more information.\n");
    return 1;
  }
  for (const p of ctx.args) {
    const trimmed = p.length > 1 ? p.replace(/\/+$/, "") : p;
    ctx.out(dirname(trimmed) + "\n");
  }
  return 0;
}

function realpathCmd(ctx: CommandContext): number {
  let status = 0;
  const ops = ctx.args.filter((a) => !a.startsWith("-"));
  for (const p of ops.length ? ops : ["."]) {
    try {
      const n = ctx.fs.lookup(p, ctx.cwd, ctx.who);
      ctx.out(ctx.fs.pathOf(n) + "\n");
    } catch (e) {
      if (ctx.name === "readlink") {
        status = 1;
        continue;
      }
      ctx.err(`realpath: ${p}: ${errMsg(e)}\n`);
      status = 1;
    }
  }
  return status;
}

function readlinkCmd(ctx: CommandContext): number {
  if (ctx.args.includes("-f") || ctx.args.includes("-e") || ctx.args.includes("-m")) return realpathCmd(ctx);
  let status = 0;
  for (const p of ctx.args) {
    const n = ctx.fs.tryLookup(p, ctx.cwd, ctx.who, false);
    if (n?.type === "symlink") ctx.out(n.target + "\n");
    else status = 1;
  }
  return status;
}

export const fileCommands: CommandDef[] = [
  {
    name: "ls",
    category: "basics",
    description: "List directory contents.",
    syntax: "ls [OPTION]... [FILE]...",
    options: [
      { flag: "-l", description: "long listing: permissions, owner, size, date" },
      { flag: "-a", description: "show hidden files (starting with .)" },
      { flag: "-h", description: "human readable sizes (with -l)" },
      { flag: "-R", description: "list subdirectories recursively" },
      { flag: "-t", description: "sort by modification time" },
      { flag: "-S", description: "sort by size" },
      { flag: "-r", description: "reverse the sort order" },
      { flag: "-d", description: "list directories themselves" },
    ],
    examples: [
      { command: "ls", description: "List the current directory" },
      { command: "ls -la", description: "Long listing including hidden files" },
      { command: "ls -lh /var/log", description: "Sizes in K/M/G" },
    ],
    permissions: "Requires read (r) permission on the directory to list it.",
    run: ls,
  },
  {
    name: "mkdir",
    category: "files",
    description: "Create directories.",
    syntax: "mkdir [-p] [-m MODE] DIRECTORY...",
    options: [
      { flag: "-p", description: "create parent directories as needed, no error if existing" },
      { flag: "-m MODE", description: "set permission mode (as in chmod)" },
      { flag: "-v", description: "print a message for each created directory" },
    ],
    examples: [
      { command: "mkdir projects", description: "Create a directory" },
      { command: "mkdir -p app/src/components", description: "Create nested directories" },
      { command: "mkdir -p site/{css,js,img}", description: "Create several with brace expansion" },
    ],
    permissions: "Requires write and execute permission on the parent directory.",
    run: mkdir,
  },
  {
    name: "rmdir",
    category: "files",
    description: "Remove empty directories.",
    syntax: "rmdir [-p] DIRECTORY...",
    examples: [{ command: "rmdir old_folder", description: "Remove an empty directory" }],
    permissions: "Requires write and execute permission on the parent directory.",
    run: rmdir,
  },
  {
    name: "touch",
    category: "files",
    description: "Create empty files or update file timestamps.",
    syntax: "touch [-c] FILE...",
    examples: [
      { command: "touch notes.txt", description: "Create an empty file" },
      { command: "touch file{1..3}.txt", description: "Create file1.txt file2.txt file3.txt" },
    ],
    permissions: "Creating requires write permission on the directory.",
    run: touch,
  },
  {
    name: "cp",
    category: "files",
    description: "Copy files and directories.",
    syntax: "cp [OPTION]... SOURCE... DEST",
    options: [
      { flag: "-r", description: "copy directories recursively" },
      { flag: "-i", description: "prompt before overwrite" },
      { flag: "-v", description: "explain what is being done" },
      { flag: "-p", description: "preserve mode, ownership and timestamps" },
      { flag: "-a", description: "archive mode (-rp)" },
    ],
    examples: [
      { command: "cp notes.txt backup.txt", description: "Copy a file" },
      { command: "cp -r projects projects_backup", description: "Copy a directory tree" },
    ],
    permissions: "Requires read on the source and write on the destination directory.",
    run: cp,
  },
  {
    name: "mv",
    category: "files",
    description: "Move (rename) files.",
    syntax: "mv [OPTION]... SOURCE... DEST",
    options: [
      { flag: "-i", description: "prompt before overwrite" },
      { flag: "-n", description: "do not overwrite an existing file" },
      { flag: "-v", description: "explain what is being done" },
    ],
    examples: [
      { command: "mv draft.txt final.txt", description: "Rename a file" },
      { command: "mv *.log logs/", description: "Move files into a directory" },
    ],
    permissions: "Requires write permission on both the source and destination directories.",
    run: mv,
  },
  {
    name: "rm",
    category: "files",
    description: "Remove files or directories.",
    syntax: "rm [OPTION]... FILE...",
    options: [
      { flag: "-r", description: "remove directories and their contents recursively" },
      { flag: "-f", description: "ignore nonexistent files, never prompt" },
      { flag: "-i", description: "prompt before every removal" },
      { flag: "-v", description: "explain what is being done" },
    ],
    examples: [
      { command: "rm old.txt", description: "Delete a file" },
      { command: "rm -r old_project", description: "Delete a directory and everything inside" },
    ],
    permissions: "Requires write and execute permission on the containing directory.",
    run: rm,
  },
  {
    name: "ln",
    category: "files",
    description: "Make links between files.",
    syntax: "ln [-sf] TARGET [LINK_NAME]",
    options: [{ flag: "-s", description: "make a symbolic link" }],
    examples: [{ command: "ln -s /var/log logs", description: "Create a shortcut named logs" }],
    run: ln,
  },
  {
    name: "stat",
    category: "files",
    description: "Display file or file system status.",
    syntax: "stat [-c FORMAT] FILE...",
    examples: [
      { command: "stat welcome.txt", description: "Show detailed metadata" },
      { command: "stat -c '%a %U %G %n' *", description: "Print octal mode, owner and group" },
    ],
    run: stat,
  },
  { name: "file", category: "files", description: "Determine file type.", syntax: "file FILE...", examples: [{ command: "file projects/hello.sh", description: "What kind of file is it?" }], run: file },
  {
    name: "tree",
    category: "files",
    package: "tree",
    description: "List contents of directories in a tree-like format.",
    syntax: "tree [-a] [-d] [-L LEVEL] [DIRECTORY]",
    examples: [{ command: "tree -L 2 ~", description: "Show your home directory two levels deep" }],
    run: tree,
  },
  {
    name: "find",
    category: "files",
    description: "Search for files in a directory hierarchy.",
    syntax: "find [PATH...] [EXPRESSION]",
    options: [
      { flag: "-name PATTERN", description: "match file name (wildcards allowed)" },
      { flag: "-type f|d|l", description: "match files, directories or links" },
      { flag: "-size +N[kMG]", description: "match by size" },
      { flag: "-user NAME", description: "owned by user" },
      { flag: "-perm MODE", description: "match permission bits" },
      { flag: "-maxdepth N", description: "descend at most N levels" },
      { flag: "-exec CMD {} \\;", description: "run a command on each match" },
      { flag: "-delete", description: "delete matches" },
    ],
    examples: [
      { command: 'find ~ -name "*.txt"', description: "All .txt files in your home" },
      { command: "find /var -type d -name log", description: "Directories called log" },
      { command: "find . -perm 777", description: "World-writable files (a security risk!)" },
    ],
    run: find,
  },
  { name: "basename", category: "files", description: "Strip directory and suffix from filenames.", syntax: "basename NAME [SUFFIX]", run: basenameCmd },
  { name: "dirname", category: "files", description: "Strip last component from file name.", syntax: "dirname NAME", run: dirnameCmd },
  { name: "realpath", category: "files", description: "Print the resolved absolute path.", syntax: "realpath FILE...", run: realpathCmd },
  { name: "readlink", category: "files", description: "Print resolved symbolic links.", syntax: "readlink [-f] FILE", run: readlinkCmd },
];

export { colorName, resolve as resolvePath, joinLines };
