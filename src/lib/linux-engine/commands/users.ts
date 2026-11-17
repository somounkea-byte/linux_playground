import { shellProcess } from "../processes";
import type { LinuxUser } from "../types";
import {
  addGroup,
  addUser,
  addUserToGroup,
  deleteGroup,
  deleteUser,
  findGroup,
  findUser,
  groupsOf,
  identityFor,
  isSudoer,
  removeUserFromGroup,
  syncEtcFiles,
  UserError,
  validateName,
} from "../users";
import { hashPassword, isoDate, verifyPassword } from "../util";
import { withOpts } from "./helpers";
import type { CommandContext, CommandDef } from "./types";

const SUDO_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin";

function denyLock(ctx: CommandContext, cmd: string, file = "/etc/passwd"): number {
  ctx.err(`${cmd}: Permission denied.\n${cmd}: cannot lock ${file}; try again later.\n`);
  return 1;
}

function finish(ctx: CommandContext) {
  syncEtcFiles(ctx.state, ctx.fs, ctx.now);
}

function userErr(ctx: CommandContext, cmd: string, e: unknown): number {
  if (e instanceof UserError) {
    ctx.err(`${cmd}: ${e.message}\n`);
    return e.exitCode;
  }
  throw e;
}

function formatId(ctx: CommandContext, user: LinuxUser, who?: { gid: number; groups: number[] }): string {
  const groups = who ? who.groups.map((gid) => findGroup(ctx.state, gid)).filter(Boolean) : groupsOf(ctx.state, user.username);
  const primary = findGroup(ctx.state, who?.gid ?? user.gid);
  return `uid=${user.uid}(${user.username}) gid=${primary?.gid ?? user.gid}(${primary?.name ?? user.gid}) groups=${groups.map((g) => `${g!.gid}(${g!.name})`).join(",")}`;
}

function authenticate(ctx: CommandContext, user: LinuxUser, prompt: string): boolean {
  const pw = ctx.shell.readInput(prompt, true);
  if (user.locked || user.passwordHash.startsWith("!") || user.passwordHash === "*") return false;
  return verifyPassword(pw, user.passwordHash);
}

/** Ask for and confirm a new password. Returns the hash or null when unchanged. */
function promptNewPassword(ctx: CommandContext, cmd: string): string | null {
  const a = ctx.shell.readInput("New password: ", true);
  const b = ctx.shell.readInput("Retype new password: ", true);
  if (a !== b) {
    ctx.err("Sorry, passwords do not match.\n");
    ctx.err(`${cmd}: Authentication token manipulation error\n${cmd}: password unchanged\n`);
    return null;
  }
  if (!a) {
    ctx.err("No password has been supplied.\n");
    ctx.err(`${cmd}: Authentication token manipulation error\n${cmd}: password unchanged\n`);
    return null;
  }
  return hashPassword(a);
}

function pushLoginShell(ctx: CommandContext, username: string, login: boolean) {
  const user = findUser(ctx.state, username)!;
  ctx.state.session.userStack.push({ user: username, cwd: login ? user.home : ctx.cwd, login });
  if (!ctx.state.processes.some((p) => p.command === "bash" && p.user === username)) {
    ctx.state.processes.push(shellProcess(ctx.state, username, ctx.now));
  }
}

// ---------------------------------------------------------------- whoami/id

function id(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "ugGnrz", long: { user: "u", group: "g", groups: "G", name: "n" } }, (o) => {
    const name = o.operands[0];
    const user = name ? findUser(ctx.state, name) : findUser(ctx.state, ctx.who.uid);
    if (!user) {
      ctx.err(`id: ‘${name}’: no such user\n`);
      return 1;
    }
    const who = name ? undefined : ctx.who;
    const groups = who ? who.groups : groupsOf(ctx.state, user.username).map((g) => g.gid);
    const gid = who?.gid ?? user.gid;
    if (o.flags.has("u")) ctx.out((o.flags.has("n") ? user.username : String(user.uid)) + "\n");
    else if (o.flags.has("g")) ctx.out((o.flags.has("n") ? (findGroup(ctx.state, gid)?.name ?? String(gid)) : String(gid)) + "\n");
    else if (o.flags.has("G")) ctx.out(groups.map((g) => (o.flags.has("n") ? (findGroup(ctx.state, g)?.name ?? String(g)) : String(g))).join(" ") + "\n");
    else ctx.out(formatId(ctx, user, who) + "\n");
    return 0;
  });
}

function groupsCmd(ctx: CommandContext): number {
  if (!ctx.args.length) {
    ctx.out(ctx.who.groups.map((g) => findGroup(ctx.state, g)?.name ?? String(g)).join(" ") + "\n");
    return 0;
  }
  let status = 0;
  for (const n of ctx.args) {
    const user = findUser(ctx.state, n);
    if (!user) {
      ctx.err(`groups: ‘${n}’: no such user\n`);
      status = 1;
      continue;
    }
    ctx.out(`${n} : ${groupsOf(ctx.state, n).map((g) => g.name).join(" ")}\n`);
  }
  return status;
}

function loggedIn(ctx: CommandContext) {
  return ctx.state.logins.filter((l) => !l.logoutAt);
}

function who(ctx: CommandContext): number {
  if (ctx.args.includes("-b")) {
    ctx.out(`         system boot  ${isoDate(ctx.state.bootTime)}\n`);
    return 0;
  }
  for (const l of loggedIn(ctx)) ctx.out(`${l.user.padEnd(8)} ${l.tty.padEnd(12)} ${isoDate(l.loginAt)} (${l.from})\n`);
  return 0;
}

function w(ctx: CommandContext): number {
  const t = new Date(ctx.now);
  const time = `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}:${String(t.getUTCSeconds()).padStart(2, "0")}`;
  const sessions = loggedIn(ctx);
  ctx.out(` ${time} up ${ctx.shell.uptimeText()},  ${sessions.length} user${sessions.length === 1 ? "" : "s"},  load average: 0.08, 0.03, 0.01\n`);
  ctx.out("USER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n");
  for (const l of sessions) {
    const d = new Date(l.loginAt);
    const at = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    ctx.out(`${l.user.padEnd(8)} ${l.tty.padEnd(8)} ${l.from.padEnd(16)} ${at}    0.00s  0.04s  0.00s w\n`);
  }
  return 0;
}

function getent(ctx: CommandContext): number {
  const [db, ...keys] = ctx.args;
  if (!db) {
    ctx.err("Usage: getent [OPTION...] database [key ...]\nTry `getent --help' or `getent --usage' for more information.\n");
    return 1;
  }
  const s = ctx.state;
  if (db === "passwd") {
    const users = keys.length ? keys.map((k) => findUser(s, k)) : s.users;
    if (users.some((u) => !u)) {
      users.filter(Boolean).forEach((u) => ctx.out(`${u!.username}:x:${u!.uid}:${u!.gid}:${u!.gecos}:${u!.home}:${u!.shell}\n`));
      return 2;
    }
    for (const u of users) ctx.out(`${u!.username}:x:${u!.uid}:${u!.gid}:${u!.gecos}:${u!.home}:${u!.shell}\n`);
    return 0;
  }
  if (db === "group") {
    const groups = keys.length ? keys.map((k) => findGroup(s, k)) : s.groups;
    for (const g of groups) if (g) ctx.out(`${g.name}:x:${g.gid}:${g.members.join(",")}\n`);
    return groups.some((g) => !g) ? 2 : 0;
  }
  if (db === "shadow") {
    if (ctx.who.uid !== 0) return 0;
    const users = keys.length ? keys.map((k) => findUser(s, k)) : s.users;
    for (const u of users) if (u) ctx.out(`${u.username}:${u.locked ? "!" : ""}${u.passwordHash}:${u.lastChange}:0:99999:7:::\n`);
    return 0;
  }
  if (db === "hosts" || db === "ahosts") {
    const hosts = ctx.fs.tryLookup("/etc/hosts", "/")?.content ?? "";
    for (const k of keys) {
      const line = hosts.split("\n").find((l) => l.split(/\s+/).slice(1).includes(k));
      if (line) ctx.out(`${line.split(/\s+/)[0].padEnd(15)} ${k}\n`);
      else return 2;
    }
    return 0;
  }
  ctx.err(`Unknown database: ${db}\nTry \`getent --help' or \`getent --usage' for more information.\n`);
  return 1;
}

// ---------------------------------------------------------- useradd & co

function useradd(ctx: CommandContext): number {
  return withOpts(
    ctx,
    {
      flags: "mMrNUD",
      withValue: "dsgGucepk",
      long: { "create-home": "m", "no-create-home": "M", system: "r", "home-dir=": "d", "shell=": "s", "gid=": "g", "groups=": "G", "uid=": "u", "comment=": "c", "password=": "p", badname: "badname", "user-group": "U" },
    },
    (o) => {
      if (ctx.who.uid !== 0) return denyLock(ctx, "useradd");
      const name = o.operands[0];
      if (!name) {
        ctx.err("Usage: useradd [options] LOGIN\n       useradd -D\n       useradd -D [options]\n\nOptions:\n  -c, --comment COMMENT         GECOS field of the new account\n  -d, --home-dir HOME_DIR       home directory of the new account\n  -g, --gid GROUP               name or ID of the primary group of the new account\n  -G, --groups GROUPS           list of supplementary groups of the new account\n  -m, --create-home             create the user's home directory\n  -s, --shell SHELL             login shell of the new account\n  -u, --uid UID                 user ID of the new account\n");
        return 2;
      }
      if (!validateName(name) && !o.flags.has("badname")) {
        ctx.err(`useradd: invalid user name '${name}': use --badname to ignore\n`);
        return 3;
      }
      try {
        const res = addUser(ctx.state, ctx.fs, {
          username: name,
          uid: o.values.u !== undefined ? Number(o.values.u) : undefined,
          group: o.values.g,
          groups: o.values.G ? o.values.G.split(",").filter(Boolean) : [],
          home: o.values.d,
          createHome: o.flags.has("m") && !o.flags.has("M"),
          shell: o.values.s,
          gecos: o.values.c,
          system: o.flags.has("r"),
          now: ctx.now,
        });
        if (res.homeExisted) ctx.err(`useradd: warning: the home directory ${res.user.home} already exists.\nuseradd: Not copying any file from skel directory into it.\n`);
        ctx.shell.log("auth", "useradd[3101]", `new user: name=${name}, UID=${res.user.uid}, GID=${res.user.gid}, home=${res.user.home}, shell=${res.user.shell}, from=/dev/pts/0`);
        finish(ctx);
        return 0;
      } catch (e) {
        return userErr(ctx, "useradd", e);
      }
    },
  );
}

function adduser(ctx: CommandContext): number {
  return withOpts(
    ctx,
    { flags: "q", withValue: "", long: { "disabled-password": "nopw", "disabled-login": "nologin", "gecos=": "gecos", "comment=": "gecos", "shell=": "shell", "home=": "home", "ingroup=": "ingroup", system: "system", quiet: "q", "uid=": "uid" } },
    (o) => {
      const cmd = ctx.name;
      if (ctx.who.uid !== 0) {
        ctx.err(`fatal: Only root may add a user or group to the system.\n`);
        return 1;
      }
      const [name, group] = o.operands;
      if (!name) {
        ctx.err(`fatal: Only one or two names allowed.\n`);
        return 1;
      }
      const info = (s: string) => {
        if (!o.flags.has("q")) ctx.out(`info: ${s}\n`);
      };
      // adduser USER GROUP: add an existing user to a group
      if (group !== undefined) {
        if (!findUser(ctx.state, name)) {
          ctx.err(`fatal: The user \`${name}' does not exist.\n`);
          return 1;
        }
        if (!findGroup(ctx.state, group)) {
          ctx.err(`fatal: The group \`${group}' does not exist.\n`);
          return 1;
        }
        if (findGroup(ctx.state, group)!.members.includes(name)) {
          info(`The user \`${name}' is already a member of \`${group}'.`);
          return 0;
        }
        info(`Adding user \`${name}' to group \`${group}' ...`);
        addUserToGroup(ctx.state, name, group);
        finish(ctx);
        info("Done.");
        return 0;
      }
      if (cmd === "addgroup" || o.flags.has("group")) {
        try {
          info(`Selecting GID from range 1000 to 59999 ...`);
          const g = addGroup(ctx.state, name);
          info(`Adding group \`${name}' (GID ${g.gid}) ...`);
          finish(ctx);
          return 0;
        } catch (e) {
          if (e instanceof UserError && e.exitCode === 9) {
            ctx.err(`fatal: The group \`${name}' already exists.\n`);
            return 1;
          }
          return userErr(ctx, "addgroup", e);
        }
      }
      if (findUser(ctx.state, name) && ctx.state.users.some((u) => u.username === name)) {
        ctx.err(`fatal: The user \`${name}' already exists.\n`);
        return 1;
      }
      if (!validateName(name)) {
        ctx.err(`fatal: To avoid ambiguity with numerical UIDs, usernames which\n            resemble numbers or negative numbers are not allowed.\n`);
        return 1;
      }
      try {
        info(`Adding user \`${name}' ...`);
        info(`Selecting UID/GID from range 1000 to 59999 ...`);
        const res = addUser(ctx.state, ctx.fs, {
          username: name,
          group: o.values.ingroup,
          home: o.values.home,
          createHome: true,
          shell: o.values.shell ?? "/bin/bash",
          gecos: o.values.gecos ?? "",
          uid: o.values.uid ? Number(o.values.uid) : undefined,
          now: ctx.now,
        });
        const u = res.user;
        if (!o.values.ingroup) info(`Adding new group \`${name}' (${u.gid}) ...`);
        info(`Adding new user \`${name}' (${u.uid}) with group \`${findGroup(ctx.state, u.gid)?.name} (${u.gid})' ...`);
        info(`Creating home directory \`${u.home}' ...`);
        info(`Copying files from \`/etc/skel' ...`);
        ctx.shell.log("auth", "useradd[3101]", `new user: name=${name}, UID=${u.uid}, GID=${u.gid}, home=${u.home}, shell=${u.shell}, from=/dev/pts/0`);
        if (!o.flags.has("nopw") && !o.flags.has("nologin")) {
          let hash: string | null = null;
          for (let attempt = 0; attempt < 3 && !hash; attempt++) {
            hash = promptNewPassword(ctx, "passwd");
            if (!hash && attempt < 2) ctx.out("passwd: Try again? [y/N] ") ;
            if (!hash && attempt < 2) {
              const again = ctx.shell.readInput("", false);
              if (!/^y/i.test(again)) break;
            }
          }
          if (hash) {
            u.passwordHash = hash;
            ctx.out("passwd: password updated successfully\n");
          }
        }
        if (o.values.gecos === undefined) {
          ctx.out(`Changing the user information for ${name}\nEnter the new value, or press ENTER for the default\n`);
          const full = ctx.shell.readInput("\tFull Name []: ", false);
          const room = ctx.shell.readInput("\tRoom Number []: ", false);
          const work = ctx.shell.readInput("\tWork Phone []: ", false);
          const home = ctx.shell.readInput("\tHome Phone []: ", false);
          ctx.shell.readInput("\tOther []: ", false);
          const ok = ctx.shell.readInput("Is the information correct? [Y/n] ", false);
          if (!/^n/i.test(ok)) u.gecos = [full, room, work, home].join(",").replace(/,+$/, "") ? `${full},${room},${work},${home}` : "";
        }
        const users = findGroup(ctx.state, "users");
        if (users) {
          info(`Adding new user \`${name}' to supplemental / extra groups \`users' ...`);
          info(`Adding user \`${name}' to group \`users' ...`);
          addUserToGroup(ctx.state, name, "users");
        }
        finish(ctx);
        return 0;
      } catch (e) {
        return userErr(ctx, "adduser", e);
      }
    },
  );
}

function userdel(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "rf", long: { remove: "r", force: "f" } }, (o) => {
    if (ctx.who.uid !== 0) return denyLock(ctx, "userdel");
    const name = o.operands[0];
    if (!name) {
      ctx.err("Usage: userdel [options] LOGIN\n\nOptions:\n  -f, --force                   force some actions that would fail otherwise\n  -r, --remove                  remove home directory and mail spool\n");
      return 2;
    }
    try {
      const hadMail = !!ctx.fs.tryLookup(`/var/mail/${name}`, "/");
      deleteUser(ctx.state, ctx.fs, name, o.flags.has("r"), ctx.now);
      if (o.flags.has("r") && !hadMail) ctx.err(`userdel: ${name} mail spool (/var/mail/${name}) not found\n`);
      ctx.shell.log("auth", "userdel[3150]", `delete user '${name}'`);
      finish(ctx);
      return 0;
    } catch (e) {
      return userErr(ctx, "userdel", e);
    }
  });
}

function deluser(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "q", long: { "remove-home": "r", "remove-all-files": "r", quiet: "q", group: "group" } }, (o) => {
    if (ctx.who.uid !== 0) {
      ctx.err("fatal: Only root may remove a user or group from the system.\n");
      return 1;
    }
    const [name, group] = o.operands;
    if (!name) {
      ctx.err("fatal: No options allowed after names.\n");
      return 1;
    }
    try {
      if (ctx.name === "delgroup" || o.flags.has("group")) {
        ctx.out(`info: Removing group \`${name}' ...\n`);
        deleteGroup(ctx.state, name);
        ctx.out("info: Done.\n");
      } else if (group) {
        ctx.out(`info: Removing user \`${name}' from group \`${group}' ...\n`);
        removeUserFromGroup(ctx.state, name, group);
        ctx.out("info: Done.\n");
      } else {
        if (!findUser(ctx.state, name)) {
          ctx.err(`fatal: The user \`${name}' does not exist.\n`);
          return 2;
        }
        ctx.out(`info: Removing crontab ...\n`);
        if (o.flags.has("r")) ctx.out(`info: Looking for files to backup/remove ...\ninfo: Removing files ...\n`);
        ctx.out(`info: Removing user \`${name}' ...\n`);
        deleteUser(ctx.state, ctx.fs, name, o.flags.has("r"), ctx.now);
        ctx.out("info: Done.\n");
      }
      finish(ctx);
      return 0;
    } catch (e) {
      if (e instanceof UserError) {
        ctx.err(`fatal: ${e.message}\n`);
        return 1;
      }
      throw e;
    }
  });
}

function usermod(ctx: CommandContext): number {
  return withOpts(
    ctx,
    { flags: "aLUm", withValue: "GgsdlcueA", long: { append: "a", "groups=": "G", "gid=": "g", "shell=": "s", "home=": "d", "move-home": "m", "login=": "l", lock: "L", unlock: "U", "comment=": "c", "uid=": "u" } },
    (o) => {
      if (ctx.who.uid !== 0) return denyLock(ctx, "usermod");
      const name = o.operands[0];
      if (!name) {
        ctx.err("Usage: usermod [options] LOGIN\n\nOptions:\n  -a, --append                  append the user to the supplemental GROUPS\n  -G, --groups GROUPS           new list of supplementary GROUPS\n  -g, --gid GROUP               force use GROUP as new primary group\n  -s, --shell SHELL             new login shell for the user account\n  -d, --home HOME_DIR           new home directory for the user account\n  -l, --login NEW_LOGIN         new value of the login name\n  -L, --lock                    lock the user account\n  -U, --unlock                  unlock the user account\n");
        return 2;
      }
      const user = ctx.state.users.find((u) => u.username === name);
      if (!user) {
        ctx.err(`usermod: user '${name}' does not exist\n`);
        return 6;
      }
      const v = o.values;
      if (!Object.keys(v).length && !o.flags.has("L") && !o.flags.has("U")) {
        ctx.err("usermod: no options\n");
        return 2;
      }
      if (o.flags.has("a") && v.G === undefined) {
        ctx.err("usermod: -a flag is ONLY allowed with the -G flag\n");
        return 2;
      }
      if (v.G !== undefined) {
        const groups = v.G.split(",").filter(Boolean);
        for (const g of groups) {
          if (!findGroup(ctx.state, g)) {
            ctx.err(`usermod: group '${g}' does not exist\n`);
            return 6;
          }
        }
        if (!o.flags.has("a")) {
          for (const g of ctx.state.groups) if (!groups.includes(g.name) && !groups.includes(String(g.gid))) g.members = g.members.filter((m) => m !== name);
        }
        for (const g of groups) addUserToGroup(ctx.state, name, g);
      }
      if (v.g !== undefined) {
        const g = findGroup(ctx.state, v.g);
        if (!g) {
          ctx.err(`usermod: group '${v.g}' does not exist\n`);
          return 6;
        }
        user.gid = g.gid;
      }
      if (v.s !== undefined) user.shell = v.s;
      if (v.c !== undefined) user.gecos = v.c;
      if (v.u !== undefined) {
        const nu = Number(v.u);
        if (ctx.state.users.some((u) => u.uid === nu && u !== user)) {
          ctx.err(`usermod: UID '${nu}' already exists\n`);
          return 4;
        }
        user.uid = nu;
      }
      if (v.d !== undefined) {
        const old = user.home;
        user.home = v.d;
        if (o.flags.has("m")) {
          const node = ctx.fs.tryLookup(old, "/", null, false);
          if (node) {
            try {
              const { parent, name: base } = ctx.fs.lookupParent(v.d, "/");
              ctx.fs.move(node, parent, base, ctx.now);
            } catch {
              ctx.err(`usermod: cannot rename directory ${old} to ${v.d}\n`);
              return 12;
            }
          }
        }
      }
      if (v.l !== undefined) {
        if (!validateName(v.l)) {
          ctx.err(`usermod: invalid user name '${v.l}': use --badname to ignore\n`);
          return 3;
        }
        if (ctx.state.users.some((u) => u.username === v.l)) {
          ctx.err(`usermod: user '${v.l}' already exists\n`);
          return 9;
        }
        for (const g of ctx.state.groups) g.members = g.members.map((m) => (m === name ? v.l : m));
        user.username = v.l;
      }
      if (o.flags.has("L")) user.locked = true;
      if (o.flags.has("U")) user.locked = false;
      ctx.shell.log("auth", "usermod[3122]", `change user '${name}'`);
      finish(ctx);
      return 0;
    },
  );
}

function passwd(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "ludSea", long: { lock: "l", unlock: "u", delete: "d", status: "S", expire: "e", all: "a" } }, (o) => {
    const target = o.operands[0] ?? ctx.who.username;
    const user = ctx.state.users.find((u) => u.username === target);
    if (!user) {
      ctx.err(`passwd: user '${target}' does not exist\n`);
      return 1;
    }
    const isRoot = ctx.who.uid === 0;
    if (!isRoot && target !== ctx.who.username) {
      ctx.err(`passwd: You may not view or modify password information for ${target}.\n`);
      return 1;
    }
    if (o.flags.has("S")) {
      const status = user.locked || user.passwordHash.startsWith("!") ? "L" : user.passwordHash === "" ? "NP" : "P";
      const d = new Date(user.lastChange * 86400000);
      ctx.out(`${user.username} ${status} ${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()} 0 99999 7 -1\n`);
      return 0;
    }
    if (o.flags.has("l") || o.flags.has("u") || o.flags.has("d") || o.flags.has("e")) {
      if (!isRoot) {
        ctx.err("passwd: Permission denied.\n");
        return 1;
      }
      if (o.flags.has("l")) user.locked = true;
      if (o.flags.has("u")) user.locked = false;
      if (o.flags.has("d")) user.passwordHash = "";
      if (o.flags.has("e")) user.lastChange = 0;
      ctx.out(o.flags.has("e") ? "passwd: password changed.\npasswd: password expiry information changed.\n" : "passwd: password changed.\n");
      finish(ctx);
      return 0;
    }
    if (!isRoot) {
      ctx.out(`Changing password for ${target}.\n`);
      const current = ctx.shell.readInput("Current password: ", true);
      if (!verifyPassword(current, user.passwordHash)) {
        ctx.err("passwd: Authentication token manipulation error\npasswd: password unchanged\n");
        ctx.shell.log("auth", "passwd[3210]", `pam_unix(passwd:chauthtok): authentication failure; logname=${target} uid=${user.uid} euid=0 tty=/dev/pts/0 ruser= rhost=  user=${target}`);
        return 10;
      }
    }
    const hash = promptNewPassword(ctx, "passwd");
    if (!hash) return 10;
    user.passwordHash = hash;
    user.lastChange = Math.floor(ctx.now / 86400000);
    if (user.username === "root") user.locked = false;
    ctx.out("passwd: password updated successfully\n");
    ctx.shell.log("auth", "passwd[3210]", `pam_unix(passwd:chauthtok): password changed for ${target}`);
    finish(ctx);
    return 0;
  });
}

function chpasswd(ctx: CommandContext): number {
  if (ctx.who.uid !== 0) {
    ctx.err("chpasswd: Permission denied.\nchpasswd: cannot lock /etc/passwd; try again later.\n");
    return 1;
  }
  let status = 0;
  ctx.readAllStdin()
    .split("\n")
    .filter(Boolean)
    .forEach((line, i) => {
      const idx = line.indexOf(":");
      const name = line.slice(0, idx);
      const user = ctx.state.users.find((u) => u.username === name);
      if (idx === -1 || !user) {
        ctx.err(`chpasswd: line ${i + 1}: user '${name}' does not exist\n`);
        status = 1;
        return;
      }
      user.passwordHash = hashPassword(line.slice(idx + 1));
      user.lastChange = Math.floor(ctx.now / 86400000);
    });
  finish(ctx);
  return status;
}

function groupadd(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "rf", withValue: "g", long: { system: "r", force: "f", "gid=": "g" } }, (o) => {
    if (ctx.who.uid !== 0) return denyLock(ctx, "groupadd", "/etc/group");
    const name = o.operands[0];
    if (!name) {
      ctx.err("Usage: groupadd [options] GROUP\n\nOptions:\n  -g, --gid GID                 use GID for the new group\n  -r, --system                  create a system account\n");
      return 2;
    }
    try {
      if (o.flags.has("f") && findGroup(ctx.state, name)) return 0;
      addGroup(ctx.state, name, { gid: o.values.g ? Number(o.values.g) : undefined, system: o.flags.has("r") });
      ctx.shell.log("auth", "groupadd[3130]", `group added to /etc/group: name=${name}`);
      finish(ctx);
      return 0;
    } catch (e) {
      return userErr(ctx, "groupadd", e);
    }
  });
}

function groupdel(ctx: CommandContext): number {
  if (ctx.who.uid !== 0) return denyLock(ctx, "groupdel", "/etc/group");
  const name = ctx.args.find((a) => !a.startsWith("-"));
  if (!name) {
    ctx.err("Usage: groupdel [options] GROUP\n");
    return 2;
  }
  try {
    deleteGroup(ctx.state, name);
    ctx.shell.log("auth", "groupdel[3140]", `group '${name}' removed from /etc/group`);
    finish(ctx);
    return 0;
  } catch (e) {
    return userErr(ctx, "groupdel", e);
  }
}

function groupmod(ctx: CommandContext): number {
  return withOpts(ctx, { flags: "", withValue: "ng", long: { "new-name=": "n", "gid=": "g" } }, (o) => {
    if (ctx.who.uid !== 0) return denyLock(ctx, "groupmod", "/etc/group");
    const g = ctx.state.groups.find((x) => x.name === o.operands[0]);
    if (!g) {
      ctx.err(`groupmod: group '${o.operands[0]}' does not exist\n`);
      return 6;
    }
    if (o.values.n) {
      if (findGroup(ctx.state, o.values.n)) {
        ctx.err(`groupmod: group '${o.values.n}' already exists\n`);
        return 9;
      }
      g.name = o.values.n;
    }
    if (o.values.g) g.gid = Number(o.values.g);
    finish(ctx);
    return 0;
  });
}

function gpasswd(ctx: CommandContext): number {
  const [flag, a, b] = ctx.args;
  if (ctx.who.uid !== 0) {
    ctx.err("gpasswd: Permission denied.\n");
    return 3;
  }
  try {
    if (flag === "-a" && a && b) {
      if (!findUser(ctx.state, a)) {
        ctx.err(`gpasswd: user '${a}' does not exist\n`);
        return 3;
      }
      if (!findGroup(ctx.state, b)) {
        ctx.err(`gpasswd: group '${b}' does not exist in /etc/group\n`);
        return 3;
      }
      addUserToGroup(ctx.state, a, b);
      ctx.out(`Adding user ${a} to group ${b}\n`);
    } else if (flag === "-d" && a && b) {
      if (!findGroup(ctx.state, b)) {
        ctx.err(`gpasswd: group '${b}' does not exist in /etc/group\n`);
        return 3;
      }
      ctx.out(`Removing user ${a} from group ${b}\n`);
      try {
        removeUserFromGroup(ctx.state, a, b);
      } catch (e) {
        if (e instanceof UserError) {
          ctx.err(`gpasswd: user '${a}' is not a member of '${b}'\n`);
          return 3;
        }
        throw e;
      }
    } else if (flag === "-M" && a !== undefined && b) {
      const g = findGroup(ctx.state, b);
      if (!g) {
        ctx.err(`gpasswd: group '${b}' does not exist in /etc/group\n`);
        return 3;
      }
      g.members = a.split(",").filter(Boolean);
    } else {
      ctx.err("Usage: gpasswd [option] GROUP\n\nOptions:\n  -a, --add USER                add USER to GROUP\n  -d, --delete USER             remove USER from GROUP\n  -M, --members USER,...        set the list of members of GROUP\n");
      return 2;
    }
    finish(ctx);
    return 0;
  } catch (e) {
    return userErr(ctx, "gpasswd", e);
  }
}

function chage(ctx: CommandContext): number {
  const name = ctx.args.find((a) => !a.startsWith("-"));
  const user = name ? findUser(ctx.state, name) : undefined;
  if (!user) {
    ctx.err(`chage: user '${name ?? ""}' does not exist in /etc/passwd\n`);
    return 1;
  }
  if (ctx.who.uid !== 0 && ctx.who.username !== user.username) {
    ctx.err("chage: Permission denied.\n");
    return 1;
  }
  const d = new Date(user.lastChange * 86400000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  ctx.out(
    `Last password change\t\t\t\t\t: ${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}, ${d.getUTCFullYear()}\nPassword expires\t\t\t\t\t: never\nPassword inactive\t\t\t\t\t: never\nAccount expires\t\t\t\t\t\t: never\nMinimum number of days between password change\t\t: 0\nMaximum number of days between password change\t\t: 99999\nNumber of days of warning before password expires\t: 7\n`,
  );
  return 0;
}

// ---------------------------------------------------------------- su/sudo

function su(ctx: CommandContext): number {
  let login = false;
  let command: string | null = null;
  let target = "root";
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === "-" || a === "-l" || a === "--login") login = true;
    else if (a === "-c" || a === "--command") command = ctx.args[++i] ?? "";
    else if (a.startsWith("-")) {
      ctx.err(`su: invalid option -- '${a.replace(/^-+/, "")}'\nTry 'su --help' for more information.\n`);
      return 1;
    } else target = a;
  }
  const user = ctx.state.users.find((u) => u.username === target);
  if (!user) {
    ctx.err(`su: user ${target} does not exist or the user entry does not contain all the required fields\n`);
    return 1;
  }
  if (ctx.who.uid !== 0) {
    if (!authenticate(ctx, user, "Password: ")) {
      ctx.shell.log("auth", "su[2210]", `pam_unix(su:auth): authentication failure; logname=${ctx.who.username} uid=${ctx.who.uid} euid=0 tty=/dev/pts/0 ruser=${ctx.who.username} rhost=  user=${target}`);
      ctx.shell.log("auth", "su[2210]", `FAILED SU (to ${target}) ${ctx.who.username} on pts/0`);
      ctx.err("su: Authentication failure\n");
      return 1;
    }
  }
  if (/nologin|false/.test(user.shell)) {
    ctx.out("This account is currently not available.\n");
    return 1;
  }
  ctx.shell.log("auth", "su[2211]", `(to ${target}) ${ctx.who.username} on pts/0`);
  ctx.shell.log("auth", "su[2211]", `pam_unix(su:session): session opened for user ${target}(uid=${user.uid}) by ${ctx.who.username}(uid=${ctx.who.uid})`);
  if (command !== null) {
    const ident = identityFor(ctx.state, target);
    return ctx.shell.withIdentity(ident, () => ctx.shell.evalText(command!, ctx.shell.ioFromContext(ctx)));
  }
  pushLoginShell(ctx, target, login);
  return 0;
}

const SUDO_BUILTINS_WITH_BINARY = new Set(["echo", "printf", "pwd", "test", "[", "true", "false", "kill"]);

function sudo(ctx: CommandContext): number {
  const me = findUser(ctx.state, ctx.who.uid);
  if (!me) return 1;
  let runAs = "root";
  let i = 0;
  let mode: "cmd" | "login" | "shell" | "list" | "validate" | "kill" = "cmd";
  for (; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (!a.startsWith("-")) break;
    if (a === "--") {
      i++;
      break;
    }
    if (a === "-u") runAs = ctx.args[++i] ?? "root";
    else if (a.startsWith("-u")) runAs = a.slice(2);
    else if (a === "-i" || a === "--login") mode = "login";
    else if (a === "-s" || a === "--shell") mode = "shell";
    else if (a === "-l" || a === "--list") mode = "list";
    else if (a === "-v" || a === "--validate") mode = "validate";
    else if (a === "-k" || a === "-K" || a === "--reset-timestamp") mode = "kill";
    else if (a === "-E" || a === "-H" || a === "-S" || a === "-n") continue;
    else {
      ctx.err(`sudo: invalid option -- '${a.replace(/^-+/, "")}'\nusage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo -l [-ABkNnS] [-g group] [-h host] [-p prompt] [-U user] [-u user] [command [arg ...]]\nusage: sudo [-ABbEHkNnPS] [-C num] [-D directory] [-g group] [-h host] [-p prompt] [-R directory] [-T timeout] [-u user] [VAR=value] [-i | -s] [command [arg ...]]\n`);
      return 1;
    }
  }
  const command = ctx.args.slice(i);
  if (mode === "kill") {
    delete ctx.state.session.sudoTimestamps[me.username];
    return 0;
  }
  if (mode === "cmd" && !command.length) {
    ctx.err("usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo -l [-ABkNnS] [-g group] [-h host] [-p prompt] [-U user] [-u user] [command [arg ...]]\nusage: sudo [-ABbEHkNnPS] [-C num] [-D directory] [-g group] [-h host] [-p prompt] [-R directory] [-T timeout] [-u user] [VAR=value] [-i | -s] [command [arg ...]]\n");
    return 1;
  }
  const target = findUser(ctx.state, runAs);
  if (!target) {
    ctx.err(`sudo: unknown user ${runAs}\nsudo: error initializing audit plugin sudoers_audit\n`);
    return 1;
  }
  const isRoot = me.uid === 0;
  const last = ctx.state.session.sudoTimestamps[me.username] ?? 0;
  if (!isRoot && ctx.now - last > SUDO_TIMEOUT_MS) {
    let ok = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (authenticate(ctx, me, `[sudo] password for ${me.username}: `)) {
        ok = true;
        break;
      }
      ctx.shell.log("auth", "sudo[2301]", `pam_unix(sudo:auth): authentication failure; logname=${me.username} uid=${me.uid} euid=0 tty=/dev/pts/0 ruser=${me.username} rhost=  user=${me.username}`);
      if (attempt < 3) ctx.err("Sorry, try again.\n");
    }
    if (!ok) {
      ctx.err("sudo: 3 incorrect password attempts\n");
      ctx.shell.log("auth", "sudo[2301]", `${me.username} : 3 incorrect password attempts ; TTY=pts/0 ; PWD=${ctx.cwd} ; USER=root ; COMMAND=${command.join(" ")}`);
      return 1;
    }
    ctx.state.session.sudoTimestamps[me.username] = ctx.now;
  }
  if (!isSudoer(ctx.state, me.username)) {
    ctx.err(`${me.username} is not in the sudoers file.\n`);
    ctx.shell.log("auth", "sudo[2302]", `${me.username} : user NOT in sudoers ; TTY=pts/0 ; PWD=${ctx.cwd} ; USER=root ; COMMAND=${command.join(" ") || "list"}`);
    return 1;
  }
  if (mode === "validate") return 0;
  if (mode === "list") {
    ctx.out(
      `Matching Defaults entries for ${me.username} on ${ctx.state.hostname}:\n    env_reset, mail_badpass, secure_path=${DEFAULT_PATH.replace(":/snap/bin", "")}, use_pty\n\nUser ${me.username} may run the following commands on ${ctx.state.hostname}:\n    (ALL : ALL) ALL\n`,
    );
    return 0;
  }
  const logCommand = (cmd: string) => ctx.shell.log("auth", "sudo[2303]", `${me.username.padStart(8)} : TTY=pts/0 ; PWD=${ctx.cwd} ; USER=${runAs} ; COMMAND=${cmd}`);
  if (mode === "login" || mode === "shell") {
    logCommand(mode === "login" ? "/bin/bash" : "/bin/bash");
    if (!command.length) {
      pushLoginShell(ctx, runAs, mode === "login");
      return 0;
    }
  }
  const name = command[0];
  if (name === "su" && command.length <= 2 && (command[1] === undefined || command[1] === "-" || command[1] === "root")) {
    logCommand("/usr/bin/su" + (command[1] ? ` ${command[1]}` : ""));
    pushLoginShell(ctx, "root", command[1] === "-");
    return 0;
  }
  const def = ctx.shell.registry.get(name);
  if (def?.builtin && !SUDO_BUILTINS_WITH_BINARY.has(name)) {
    ctx.err(`sudo: ${name}: command not found\n`);
    return 1;
  }
  const ident = identityFor(ctx.state, runAs);
  const found = ctx.shell.withIdentity(ident, () => (name.includes("/") ? null : ctx.shell.searchPath(name)));
  logCommand(`${found?.path ?? name}${command.length > 1 ? " " + command.slice(1).join(" ") : ""}`);
  return ctx.shell.withIdentity(ident, () => {
    const savedPath = ctx.shell.getVar("PATH");
    ctx.shell.setVar("PATH", DEFAULT_PATH);
    try {
      if (!name.includes("/") && !found && !def?.builtin) {
        ctx.err(`sudo: ${name}: command not found\n`);
        return 1;
      }
      // sudo bypasses shell functions and aliases
      const fns = ctx.state.session.functions;
      ctx.state.session.functions = {};
      try {
        return ctx.shell.runArgv(command, ctx.shell.ioFromContext(ctx));
      } finally {
        ctx.state.session.functions = fns;
      }
    } finally {
      if (savedPath !== undefined) ctx.shell.setVar("PATH", savedPath);
    }
  });
}

function last(ctx: CommandContext): number {
  const filterUser = ctx.args.find((a) => !a.startsWith("-"));
  const recs = [...ctx.state.logins].reverse().filter((l) => !filterUser || l.user === filterUser);
  const d = (ts: number) => {
    const x = new Date(ts);
    return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x.getUTCDay()]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][x.getUTCMonth()]} ${String(x.getUTCDate()).padStart(2, " ")} ${String(x.getUTCHours()).padStart(2, "0")}:${String(x.getUTCMinutes()).padStart(2, "0")}`;
  };
  for (const l of recs) {
    const end = l.logoutAt ? `- ${new Date(l.logoutAt).toISOString().slice(11, 16)}` : "  still logged in";
    ctx.out(`${l.user.padEnd(8)} ${l.tty.padEnd(12)} ${l.from.padEnd(16)} ${d(l.loginAt)} ${end}\n`);
  }
  if (!filterUser) ctx.out(`reboot   system boot  6.8.0-45-generic ${d(ctx.state.bootTime)}   still running\n`);
  ctx.out(`\nwtmp begins ${d(ctx.state.createdAt)}:00 ${new Date(ctx.state.createdAt).getUTCFullYear()}\n`);
  return 0;
}

function lastlog(ctx: CommandContext): number {
  const u = ctx.args.indexOf("-u");
  const only = u !== -1 ? ctx.args[u + 1] : undefined;
  ctx.out("Username         Port     From             Latest\n");
  for (const user of ctx.state.users) {
    if (only && user.username !== only) continue;
    const rec = [...ctx.state.logins].reverse().find((l) => l.user === user.username);
    if (rec) {
      const x = new Date(rec.loginAt);
      const date = `${x.toUTCString().slice(0, 3)} ${x.toUTCString().slice(8, 11)} ${String(x.getUTCDate()).padStart(2, " ")} ${x.toISOString().slice(11, 19)} +0000 ${x.getUTCFullYear()}`;
      ctx.out(`${user.username.padEnd(16)} ${rec.tty.padEnd(8)} ${rec.from.padEnd(16)} ${date}\n`);
    } else ctx.out(`${user.username.padEnd(16)}                           **Never logged in**\n`);
  }
  return 0;
}

export const userCommands: CommandDef[] = [
  { name: "whoami", category: "users", description: "Print the effective user name.", syntax: "whoami", examples: [{ command: "whoami", description: "Who am I logged in as?" }, { command: "sudo whoami", description: "Prints root" }], run: (ctx) => (ctx.out(ctx.who.username + "\n"), 0) },
  {
    name: "id",
    category: "users",
    description: "Print real and effective user and group IDs.",
    syntax: "id [-u|-g|-G] [-n] [USER]",
    examples: [
      { command: "id", description: "Your UID, GID and groups" },
      { command: "id john", description: "Another user's identity" },
    ],
    run: id,
  },
  { name: "groups", category: "users", description: "Print the groups a user is in.", syntax: "groups [USER]...", examples: [{ command: "groups john", description: "Which groups is john in?" }], run: groupsCmd },
  { name: "who", category: "users", description: "Show who is logged on.", syntax: "who [-b]", run: who },
  { name: "w", category: "users", description: "Show who is logged on and what they are doing.", syntax: "w", run: w },
  { name: "users", category: "users", description: "Print the user names of users currently logged in.", syntax: "users", run: (ctx) => (ctx.out([...new Set(loggedIn(ctx).map((l) => l.user))].sort().join(" ") + "\n"), 0) },
  {
    name: "getent",
    category: "users",
    description: "Get entries from administrative databases (passwd, group, hosts).",
    syntax: "getent DATABASE [KEY...]",
    examples: [
      { command: "getent passwd student", description: "Account details" },
      { command: "getent group developers", description: "Group and its members" },
    ],
    run: getent,
  },
  {
    name: "useradd",
    category: "users",
    description: "Create a new user (low-level).",
    syntax: "sudo useradd [-m] [-s SHELL] [-g GROUP] [-G GROUPS] [-u UID] LOGIN",
    options: [
      { flag: "-m", description: "create the home directory" },
      { flag: "-s /bin/bash", description: "login shell" },
      { flag: "-g GROUP", description: "primary group" },
      { flag: "-G G1,G2", description: "supplementary groups" },
      { flag: "-u UID", description: "specific user ID" },
      { flag: "-c COMMENT", description: "full name / comment" },
    ],
    examples: [
      { command: "sudo useradd -m -s /bin/bash john", description: "Create john with a home directory" },
      { command: "sudo useradd -m -G developers mary", description: "Create mary in the developers group" },
    ],
    permissions: "Requires root (sudo).",
    run: useradd,
  },
  {
    name: "adduser",
    aliases: ["addgroup"],
    category: "users",
    description: "Add a user or group to the system (friendly, interactive).",
    syntax: "sudo adduser USER | sudo adduser USER GROUP",
    examples: [
      { command: "sudo adduser john", description: "Interactive user creation" },
      { command: "sudo adduser john developers", description: "Add john to developers" },
    ],
    permissions: "Requires root (sudo).",
    run: adduser,
  },
  {
    name: "userdel",
    category: "users",
    description: "Delete a user account.",
    syntax: "sudo userdel [-r] LOGIN",
    options: [{ flag: "-r", description: "remove home directory and mail spool" }],
    examples: [{ command: "sudo userdel -r john", description: "Remove john and his home" }],
    permissions: "Requires root (sudo).",
    run: userdel,
  },
  { name: "deluser", aliases: ["delgroup"], category: "users", description: "Remove a user or group (friendly).", syntax: "sudo deluser [--remove-home] USER [GROUP]", permissions: "Requires root (sudo).", run: deluser },
  {
    name: "usermod",
    category: "users",
    description: "Modify a user account.",
    syntax: "sudo usermod [OPTIONS] LOGIN",
    options: [
      { flag: "-aG GROUP", description: "append to supplementary group (keep the others!)" },
      { flag: "-G GROUPS", description: "set supplementary groups (replaces the list)" },
      { flag: "-g GROUP", description: "change primary group" },
      { flag: "-s SHELL", description: "change login shell" },
      { flag: "-L / -U", description: "lock / unlock the account" },
      { flag: "-l NEW", description: "rename the account" },
    ],
    examples: [
      { command: "sudo usermod -aG developers john", description: "Add john to developers" },
      { command: "sudo usermod -s /bin/bash john", description: "Change john's shell" },
    ],
    permissions: "Requires root (sudo).",
    run: usermod,
  },
  {
    name: "passwd",
    category: "users",
    description: "Change user password.",
    syntax: "passwd [-l|-u|-S] [USER]",
    examples: [
      { command: "passwd", description: "Change your own password" },
      { command: "sudo passwd john", description: "Set john's password" },
      { command: "sudo passwd -l john", description: "Lock john's account" },
    ],
    permissions: "Users can change their own password; root can change anyone's.",
    run: passwd,
  },
  { name: "chpasswd", category: "users", description: "Update passwords in batch mode (user:password on stdin).", syntax: 'echo "john:secret" | sudo chpasswd', binDir: "/usr/sbin", permissions: "Requires root (sudo).", run: chpasswd },
  {
    name: "groupadd",
    category: "users",
    description: "Create a new group.",
    syntax: "sudo groupadd [-g GID] GROUP",
    examples: [{ command: "sudo groupadd developers", description: "Create the developers group" }],
    permissions: "Requires root (sudo).",
    run: groupadd,
  },
  { name: "groupdel", category: "users", description: "Delete a group.", syntax: "sudo groupdel GROUP", examples: [{ command: "sudo groupdel developers", description: "Remove a group" }], permissions: "Requires root (sudo).", run: groupdel },
  { name: "groupmod", category: "users", description: "Modify a group definition.", syntax: "sudo groupmod [-n NEW_NAME] [-g GID] GROUP", permissions: "Requires root (sudo).", run: groupmod },
  {
    name: "gpasswd",
    category: "users",
    description: "Administer /etc/group: add or remove members.",
    syntax: "sudo gpasswd -a|-d USER GROUP",
    examples: [
      { command: "sudo gpasswd -a john developers", description: "Add a member" },
      { command: "sudo gpasswd -d john developers", description: "Remove a member" },
    ],
    permissions: "Requires root (sudo).",
    run: gpasswd,
  },
  { name: "chage", category: "security", description: "Show or change user password expiry information.", syntax: "chage -l USER", run: chage },
  {
    name: "su",
    category: "security",
    description: "Run a shell as another user (asks for THAT user's password).",
    syntax: "su [-] [USER] [-c COMMAND]",
    examples: [
      { command: "su - john", description: "Log in as john" },
      { command: "exit", description: "Return to your previous user" },
    ],
    run: su,
  },
  {
    name: "sudo",
    category: "security",
    description: "Execute a command as another user (root by default), asking for YOUR password.",
    syntax: "sudo [-u USER] COMMAND | sudo -i | sudo -l",
    options: [
      { flag: "-u USER", description: "run as USER instead of root" },
      { flag: "-i", description: "start a root login shell" },
      { flag: "-l", description: "list what you are allowed to run" },
      { flag: "-k", description: "forget cached credentials" },
    ],
    examples: [
      { command: "sudo apt update", description: "Run a command as root" },
      { command: "sudo -i", description: "Open a root shell (exit to leave)" },
      { command: "sudo -u john whoami", description: "Run as another user" },
    ],
    permissions: "Only members of the sudo group may use sudo.",
    run: sudo,
  },
  { name: "last", category: "security", description: "Show a listing of last logged in users.", syntax: "last [USER]", run: last },
  { name: "lastlog", category: "security", description: "Report the most recent login of all users.", syntax: "lastlog [-u USER]", binDir: "/usr/bin", run: lastlog },
];

export { DEFAULT_PATH };
