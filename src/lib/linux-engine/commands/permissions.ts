import { applyChmod, ChmodParseError, modeToOctal, modeToSymbolic } from "../permissions";
import type { FsNode } from "../types";
import { findGroup, findUser, groupName, userName } from "../users";
import { errMsg, withOpts } from "./helpers";
import type { CommandContext, CommandDef } from "./types";

function eachTarget(ctx: CommandContext, path: string, recursive: boolean, fn: (n: FsNode, label: string) => void, cmd: string): boolean {
  let node: FsNode;
  try {
    node = ctx.fs.lookup(path, ctx.cwd, ctx.who, true);
  } catch (e) {
    ctx.err(`${cmd}: cannot access '${path}': ${errMsg(e)}\n`);
    return false;
  }
  fn(node, path);
  if (recursive && node.type === "dir") {
    ctx.fs.walk(node, (n, p) => {
      if (n.id === node.id) return;
      const label = path.replace(/\/+$/, "") + p.slice(ctx.fs.pathOf(node).length);
      fn(n, label);
      if (n.type === "symlink") return false;
    });
  }
  return true;
}

function chmod(ctx: CommandContext): number {
  // modes like -x or -w look like options; treat them as the MODE operand
  const args = [...ctx.args];
  let modeArg: string | undefined;
  const firstNonOpt = args.findIndex((a) => !/^-(R|v|c|f|-recursive|-verbose|-changes|-silent|-quiet)$/.test(a) && a !== "--");
  if (firstNonOpt !== -1 && /^[-+=]/.test(args[firstNonOpt]) && /^[-+=][rwxXst]+$/.test(args[firstNonOpt])) {
    modeArg = args.splice(firstNonOpt, 1)[0];
  }
  return withOpts({ ...ctx, args }, { flags: "Rvcf", long: { recursive: "R", verbose: "v", changes: "c", silent: "f", quiet: "f", "reference=": "ref", help: "help" } }, (o) => {
    if (o.flags.has("help")) {
      ctx.out("Usage: chmod [OPTION]... MODE[,MODE]... FILE...\n  or:  chmod [OPTION]... OCTAL-MODE FILE...\nChange the mode of each FILE to MODE.\n\n  -R, --recursive        change files and directories recursively\n  -v, --verbose          output a diagnostic for every file processed\n\nEach MODE is of the form '[ugoa]*([-+=]([rwxXst]*|[ugo]))+|[-+=][0-7]+'.\n");
      return 0;
    }
    const operands = [...o.operands];
    let mode = modeArg ?? operands.shift();
    if (o.values.ref) {
      const ref = ctx.fs.tryLookup(o.values.ref, ctx.cwd, ctx.who);
      if (!ref) {
        ctx.err(`chmod: failed to get attributes of '${o.values.ref}': No such file or directory\n`);
        return 1;
      }
      if (mode !== undefined) operands.unshift(mode);
      mode = modeToOctal(ref.mode, 4);
    }
    if (mode === undefined) {
      ctx.err("chmod: missing operand\nTry 'chmod --help' for more information.\n");
      return 1;
    }
    if (!operands.length) {
      ctx.err(`chmod: missing operand after ‘${mode}’\nTry 'chmod --help' for more information.\n`);
      return 1;
    }
    try {
      applyChmod(mode, 0o644, false);
    } catch (e) {
      if (e instanceof ChmodParseError) {
        ctx.err(`chmod: invalid mode: ‘${mode}’\nTry 'chmod --help' for more information.\n`);
        return 1;
      }
      throw e;
    }
    let status = 0;
    for (const path of operands) {
      const ok = eachTarget(
        ctx,
        path,
        o.flags.has("R"),
        (n, label) => {
          if (n.type === "symlink") return;
          if (ctx.who.uid !== 0 && n.uid !== ctx.who.uid) {
            if (!o.flags.has("f")) ctx.err(`chmod: changing permissions of '${label}': Operation not permitted\n`);
            status = 1;
            return;
          }
          const before = n.mode;
          n.mode = applyChmod(mode!, n.mode, n.type === "dir", ctx.state.session.umask);
          n.ctime = ctx.now;
          const changed = before !== n.mode;
          if (o.flags.has("v") || (o.flags.has("c") && changed)) {
            if (changed) ctx.out(`mode of '${label}' changed from ${modeToOctal(before, 4)} (${modeToSymbolic(before)}) to ${modeToOctal(n.mode, 4)} (${modeToSymbolic(n.mode)})\n`);
            else ctx.out(`mode of '${label}' retained as ${modeToOctal(n.mode, 4)} (${modeToSymbolic(n.mode)})\n`);
          }
        },
        "chmod",
      );
      if (!ok) status = 1;
    }
    return status;
  });
}

function parseOwnerSpec(ctx: CommandContext, spec: string): { uid?: number; gid?: number; error?: string } {
  const sep = spec.includes(":") ? ":" : spec.includes(".") && !findUser(ctx.state, spec) ? "." : null;
  const [u, g] = sep ? [spec.slice(0, spec.indexOf(sep)), spec.slice(spec.indexOf(sep) + 1)] : [spec, undefined];
  let uid: number | undefined;
  let gid: number | undefined;
  if (u) {
    const user = findUser(ctx.state, u);
    if (!user) {
      if (/^\d+$/.test(u)) uid = Number(u);
      else return { error: `invalid user: ‘${spec}’` };
    } else uid = user.uid;
  }
  if (sep && g === "" && u) {
    gid = findUser(ctx.state, u)?.gid;
  } else if (g) {
    const group = findGroup(ctx.state, g);
    if (!group) {
      if (/^\d+$/.test(g)) gid = Number(g);
      else return { error: `invalid group: ‘${spec}’` };
    } else gid = group.gid;
  }
  if (uid === undefined && gid === undefined && !sep) return { error: `invalid user: ‘${spec}’` };
  return { uid, gid };
}

function chownLike(ctx: CommandContext, isChgrp: boolean): number {
  const cmd = isChgrp ? "chgrp" : "chown";
  return withOpts(ctx, { flags: "RvchfHLP", long: { recursive: "R", verbose: "v", changes: "c", "no-dereference": "h", silent: "f", "from=": "from", "reference=": "ref" } }, (o) => {
    const operands = [...o.operands];
    const spec = operands.shift();
    if (spec === undefined) {
      ctx.err(`${cmd}: missing operand\nTry '${cmd} --help' for more information.\n`);
      return 1;
    }
    if (!operands.length) {
      ctx.err(`${cmd}: missing operand after ‘${spec}’\nTry '${cmd} --help' for more information.\n`);
      return 1;
    }
    let uid: number | undefined;
    let gid: number | undefined;
    if (isChgrp) {
      const g = findGroup(ctx.state, spec);
      if (!g && !/^\d+$/.test(spec)) {
        ctx.err(`chgrp: invalid group: ‘${spec}’\n`);
        return 1;
      }
      gid = g ? g.gid : Number(spec);
    } else {
      const r = parseOwnerSpec(ctx, spec);
      if (r.error) {
        ctx.err(`chown: ${r.error}\n`);
        return 1;
      }
      uid = r.uid;
      gid = r.gid;
    }
    let status = 0;
    for (const path of operands) {
      const ok = eachTarget(
        ctx,
        path,
        o.flags.has("R"),
        (n, label) => {
          const isRoot = ctx.who.uid === 0;
          const changingOwner = uid !== undefined && uid !== n.uid;
          const changingGroup = gid !== undefined && gid !== n.gid;
          const allowed = isRoot || (!changingOwner && n.uid === ctx.who.uid && (!changingGroup || ctx.who.groups.includes(gid!)));
          if (!allowed) {
            if (!o.flags.has("f")) {
              ctx.err(isChgrp || (!changingOwner && changingGroup) ? `${cmd}: changing group of '${label}': Operation not permitted\n` : `${cmd}: changing ownership of '${label}': Operation not permitted\n`);
            }
            status = 1;
            return;
          }
          const before = `${userName(ctx.state, n.uid)}:${groupName(ctx.state, n.gid)}`;
          if (uid !== undefined) n.uid = uid;
          if (gid !== undefined) n.gid = gid;
          // changing ownership clears setuid/setgid on files
          if ((changingOwner || changingGroup) && n.type === "file" && !isRoot) n.mode &= ~0o6000;
          n.ctime = ctx.now;
          if (o.flags.has("v") || (o.flags.has("c") && (changingOwner || changingGroup))) {
            const after = `${userName(ctx.state, n.uid)}:${groupName(ctx.state, n.gid)}`;
            if (isChgrp) ctx.out(changingGroup ? `changed group of '${label}' from ${before.split(":")[1]} to ${after.split(":")[1]}\n` : `group of '${label}' retained as ${after.split(":")[1]}\n`);
            else ctx.out(changingOwner || changingGroup ? `changed ownership of '${label}' from ${before} to ${after}\n` : `ownership of '${label}' retained as ${after}\n`);
          }
        },
        cmd,
      );
      if (!ok) status = 1;
    }
    return status;
  });
}

export const permissionCommands: CommandDef[] = [
  {
    name: "chmod",
    category: "permissions",
    description: "Change file mode bits (permissions).",
    syntax: "chmod [-R] MODE FILE...",
    options: [
      { flag: "755", description: "numeric: owner rwx, group r-x, others r-x" },
      { flag: "u+x", description: "symbolic: add execute for the owner" },
      { flag: "g-w", description: "remove write from the group" },
      { flag: "o=r", description: "set others to read only" },
      { flag: "a+r", description: "add read for everyone" },
      { flag: "-R", description: "apply recursively" },
      { flag: "-v", description: "show every change" },
    ],
    examples: [
      { command: "chmod 755 script.sh", description: "Make a script executable for everyone" },
      { command: "chmod 600 secret.txt", description: "Only the owner can read/write" },
      { command: "chmod u+x hello.sh", description: "Add execute permission for the owner" },
      { command: "chmod -R g+w shared/", description: "Let the group write everywhere inside" },
    ],
    permissions: "Only the file's owner or root can change its mode.",
    run: chmod,
  },
  {
    name: "chown",
    category: "permissions",
    description: "Change file owner and group.",
    syntax: "chown [-R] OWNER[:GROUP] FILE...",
    examples: [
      { command: "sudo chown john file.txt", description: "Give the file to john" },
      { command: "sudo chown john:developers file.txt", description: "Change owner and group" },
      { command: "sudo chown -R www-data:www-data /var/www/html", description: "Recursive ownership change" },
    ],
    permissions: "Changing the owner requires root (sudo).",
    run: (ctx) => chownLike(ctx, false),
  },
  {
    name: "chgrp",
    category: "permissions",
    description: "Change group ownership.",
    syntax: "chgrp [-R] GROUP FILE...",
    examples: [{ command: "sudo chgrp developers project/", description: "Assign a directory to a group" }],
    permissions: "The owner may change to a group they belong to; otherwise root is required.",
    run: (ctx) => chownLike(ctx, true),
  },
];
