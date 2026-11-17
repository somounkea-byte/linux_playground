import { describe, expect, it } from "vitest";
import { applyChmod, canAccess, describeMode, formatMode, modeToOctal } from "@/lib/linux-engine";
import type { Identity } from "@/lib/linux-engine/permissions";
import { newEnv, out, run, sudo } from "./helpers";

const owner: Identity = { uid: 1000, gid: 1000, groups: [1000], username: "student" };
const member: Identity = { uid: 1001, gid: 1001, groups: [1001, 2000], username: "john" };
const other: Identity = { uid: 1002, gid: 1002, groups: [1002], username: "mary" };
const root: Identity = { uid: 0, gid: 0, groups: [0], username: "root" };
const file = (mode: number) => ({ uid: 1000, gid: 2000, mode, type: "file" as const });

describe("permission engine (canAccess)", () => {
  it("applies owner bits to the owner", () => {
    expect(canAccess(file(0o600), owner, 4)).toBe(true);
    expect(canAccess(file(0o600), owner, 1)).toBe(false);
    expect(canAccess(file(0o400), owner, 2)).toBe(false);
  });

  it("applies group bits to group members", () => {
    expect(canAccess(file(0o640), member, 4)).toBe(true);
    expect(canAccess(file(0o640), member, 2)).toBe(false);
    expect(canAccess(file(0o670), member, 7)).toBe(true);
  });

  it("applies others bits to everyone else", () => {
    expect(canAccess(file(0o644), other, 4)).toBe(true);
    expect(canAccess(file(0o640), other, 4)).toBe(false);
    expect(canAccess(file(0o777), other, 7)).toBe(true);
  });

  it("does not fall through to group/other bits for the owner", () => {
    expect(canAccess(file(0o077), owner, 4)).toBe(false);
  });

  it("root bypasses read/write but needs an x bit to execute", () => {
    expect(canAccess(file(0o000), root, 6)).toBe(true);
    expect(canAccess(file(0o644), root, 1)).toBe(false);
    expect(canAccess(file(0o744), root, 1)).toBe(true);
  });
});

describe("chmod parsing", () => {
  it("numeric modes", () => {
    expect(applyChmod("755", 0o644, false)).toBe(0o755);
    expect(applyChmod("0700", 0o644, false)).toBe(0o700);
  });

  it("symbolic modes", () => {
    expect(applyChmod("u+x", 0o644, false)).toBe(0o744);
    expect(applyChmod("g-w", 0o664, false)).toBe(0o644);
    expect(applyChmod("o+r", 0o640, false)).toBe(0o644);
    expect(applyChmod("a+r", 0o600, false)).toBe(0o644);
    expect(applyChmod("u=rwx,g=rx,o=", 0o644, false)).toBe(0o750);
    expect(applyChmod("+x", 0o644, false, 0o022)).toBe(0o755);
    expect(applyChmod("g+s", 0o755, true)).toBe(0o2755);
    expect(applyChmod("+t", 0o777, true)).toBe(0o1777);
  });

  it("formats modes", () => {
    expect(formatMode({ type: "dir", mode: 0o755 })).toBe("drwxr-xr-x");
    expect(formatMode({ type: "dir", mode: 0o1777 })).toBe("drwxrwxrwt");
    expect(formatMode({ type: "file", mode: 0o4755 })).toBe("-rwsr-xr-x");
    expect(modeToOctal(0o754)).toBe("754");
    expect(describeMode(0o754).group).toEqual({ read: true, write: false, execute: true, value: 5 });
  });
});

describe("permission checks inside commands", () => {
  it("cat on an unreadable file is denied", () => {
    const env = newEnv();
    run(env, "echo secret > secret.txt");
    run(env, "chmod 000 secret.txt");
    expect(out(env, "cat secret.txt")).toBe("cat: secret.txt: Permission denied\n");
    expect(out(env, "echo x >> secret.txt")).toBe("bash: secret.txt: Permission denied\n");
    expect(sudo(env, "cat secret.txt").text).toContain("secret");
  });

  it("execute permission is needed to run scripts", () => {
    const env = newEnv();
    expect(out(env, "./projects/hello.sh")).toBe("bash: ./projects/hello.sh: Permission denied\n");
    run(env, "chmod u+x projects/hello.sh");
    expect(out(env, "./projects/hello.sh")).toContain("Hello from Linux Playground!");
    // bash only needs read permission
    run(env, "chmod 644 projects/hello.sh");
    expect(out(env, "bash projects/hello.sh")).toContain("Hello from Linux Playground!");
  });

  it("directory permissions control listing, entering and creating", () => {
    const env = newEnv();
    run(env, "mkdir box");
    run(env, "touch box/item");
    run(env, "chmod 300 box"); // -wx
    expect(out(env, "ls box")).toBe("ls: cannot open directory 'box': Permission denied\n");
    run(env, "chmod 600 box"); // rw-
    expect(out(env, "cd box")).toBe("bash: cd: box: Permission denied\n");
    expect(out(env, "cat box/item")).toBe("cat: box/item: Permission denied\n");
    run(env, "chmod 500 box"); // r-x
    expect(out(env, "touch box/new")).toBe("touch: cannot touch 'box/new': Permission denied\n");
    expect(out(env, "rm box/item")).toBe("rm: cannot remove 'box/item': Permission denied\n");
  });

  it("only the owner (or root) can chmod; only root can chown", () => {
    const env = newEnv();
    expect(out(env, "chmod 777 /etc/passwd")).toBe("chmod: changing permissions of '/etc/passwd': Operation not permitted\n");
    run(env, "touch mine.txt");
    expect(out(env, "chown root mine.txt")).toBe("chown: changing ownership of 'mine.txt': Operation not permitted\n");
    expect(sudo(env, "chown root:root mine.txt").exitCode).toBe(0);
    expect(out(env, "ls -l mine.txt")).toMatch(/^-rw-rw-r-- 1 root root/);
    expect(out(env, "chown nobodyx mine.txt")).toBe("chown: invalid user: ‘nobodyx’\n");
    expect(out(env, "chmod abc mine.txt")).toBe("chmod: invalid mode: ‘abc’\nTry 'chmod --help' for more information.\n");
  });

  it("owner may chgrp to a group they belong to", () => {
    const env = newEnv();
    run(env, "touch f");
    expect(run(env, "chgrp adm f").exitCode).toBe(0);
    expect(out(env, "chgrp root f")).toBe("chgrp: changing group of 'f': Operation not permitted\n");
  });

  it("sticky bit on /tmp prevents deleting other users' files", () => {
    const env = newEnv();
    sudo(env, "touch /tmp/rootfile");
    expect(out(env, "rm -f /tmp/rootfile")).toBe("rm: cannot remove '/tmp/rootfile': Operation not permitted\n");
  });

  it("chmod -v explains the change", () => {
    const env = newEnv();
    run(env, "touch s.sh");
    expect(out(env, "chmod -v 755 s.sh")).toBe("mode of 's.sh' changed from 0664 (rw-rw-r--) to 0755 (rwxr-xr-x)\n");
  });
});
