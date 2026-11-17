import { describe, expect, it } from "vitest";
import { findUser, groupsOf } from "@/lib/linux-engine";
import { newEnv, out, run, sudo } from "./helpers";

describe("user management", () => {
  it("useradd requires root", () => {
    const env = newEnv();
    expect(out(env, "useradd john")).toBe("useradd: Permission denied.\nuseradd: cannot lock /etc/passwd; try again later.\n");
  });

  it("creates users with UID >= 1000 and a private group", () => {
    const env = newEnv();
    expect(sudo(env, "useradd -m -s /bin/bash john").exitCode).toBe(0);
    const john = findUser(env.state, "john")!;
    expect(john.uid).toBe(1001);
    expect(john.shell).toBe("/bin/bash");
    expect(out(env, "id john")).toBe("uid=1001(john) gid=1001(john) groups=1001(john)\n");
    expect(out(env, "tail -n 1 /etc/passwd")).toBe("john:x:1001:1001::/home/john:/bin/bash\n");
    expect(sudo(env, "ls -a /home/john").text).toContain(".bashrc");
  });

  it("does not create a home without -m", () => {
    const env = newEnv();
    sudo(env, "useradd bob");
    expect(out(env, "ls /home")).toBe("student\n");
    expect(findUser(env.state, "bob")!.shell).toBe("/bin/sh");
  });

  it("rejects duplicates and invalid names", () => {
    const env = newEnv();
    sudo(env, "useradd john");
    expect(sudo(env, "useradd john").text).toBe("useradd: user 'john' already exists\n");
    expect(sudo(env, "useradd John").text).toBe("useradd: invalid user name 'John': use --badname to ignore\n");
    expect(sudo(env, "useradd -G nogrp x1").text).toBe("useradd: group 'nogrp' does not exist\n");
  });

  it("deletes users with userdel -r", () => {
    const env = newEnv();
    sudo(env, "useradd -m john");
    sudo(env, "userdel -r john");
    expect(findUser(env.state, "john")).toBeUndefined();
    expect(out(env, "ls /home")).toBe("student\n");
    expect(out(env, "id john")).toBe("id: ‘john’: no such user\n");
    expect(sudo(env, "userdel ghost").text).toBe("userdel: user 'ghost' does not exist\n");
  });

  it("adduser walks through interactive prompts", () => {
    const env = newEnv();
    const r = run(env, "sudo adduser alice", ["student", "pw", "pw", "Alice", "", "", "", "", "Y"]);
    expect(r.text).toContain("info: Adding user `alice' ...");
    expect(r.text).toContain("passwd: password updated successfully");
    expect(findUser(env.state, "alice")!.shell).toBe("/bin/bash");
    expect(groupsOf(env.state, "alice").map((g) => g.name)).toEqual(["alice", "users"]);
  });

  it("passwd sets a hashed password usable with su", () => {
    const env = newEnv();
    sudo(env, "useradd -m -s /bin/bash john");
    run(env, "sudo passwd john", ["pw1", "pw1"]);
    expect(findUser(env.state, "john")!.passwordHash).toMatch(/^\$y\$/);
    expect(out(env, "su - john", ["bad"])).toBe("Password: \nsu: Authentication failure\n");
    run(env, "su - john", ["pw1"]);
    expect(out(env, "whoami")).toBe("john\n");
    expect(env.prompt().display).toBe("~");
    expect(out(env, "exit")).toBe("logout\n");
    expect(out(env, "whoami")).toBe("student\n");
  });

  it("non-root cannot change another user's password", () => {
    const env = newEnv();
    sudo(env, "useradd john");
    expect(out(env, "passwd john")).toBe("passwd: You may not view or modify password information for john.\n");
  });
});

describe("group management", () => {
  it("creates and deletes groups", () => {
    const env = newEnv();
    expect(out(env, "groupadd devs")).toContain("groupadd: Permission denied.");
    sudo(env, "groupadd developers");
    expect(out(env, "getent group developers")).toBe("developers:x:1001:\n");
    expect(sudo(env, "groupadd developers").text).toBe("groupadd: group 'developers' already exists\n");
    sudo(env, "groupdel developers");
    expect(run(env, "getent group developers").exitCode).toBe(2);
  });

  it("usermod -aG appends, -G replaces", () => {
    const env = newEnv();
    sudo(env, "groupadd developers");
    sudo(env, "groupadd testers");
    sudo(env, "useradd john");
    sudo(env, "usermod -aG developers john");
    sudo(env, "usermod -aG testers john");
    expect(out(env, "groups john")).toBe("john : john developers testers\n");
    sudo(env, "usermod -G testers john");
    expect(out(env, "groups john")).toBe("john : john testers\n");
    expect(sudo(env, "usermod -aG nope john").text).toBe("usermod: group 'nope' does not exist\n");
  });

  it("gpasswd adds and removes members", () => {
    const env = newEnv();
    sudo(env, "groupadd developers");
    sudo(env, "useradd john");
    expect(sudo(env, "gpasswd -a john developers").text).toBe("Adding user john to group developers\n");
    expect(sudo(env, "gpasswd -d john developers").text).toBe("Removing user john from group developers\n");
    expect(sudo(env, "gpasswd -d john developers").text).toContain("is not a member of 'developers'");
  });

  it("cannot delete a user's primary group", () => {
    const env = newEnv();
    sudo(env, "useradd john");
    expect(sudo(env, "groupdel john").text).toBe("groupdel: cannot remove the primary group of user 'john'\n");
  });

  it("assigns unique GIDs and keeps /etc/group in sync", () => {
    const env = newEnv();
    sudo(env, "groupadd a1");
    sudo(env, "groupadd a2");
    const gids = env.state.groups.map((g) => g.gid);
    expect(new Set(gids).size).toBe(gids.length);
    expect(out(env, "grep ^a2 /etc/group")).toBe("a2:x:1002:\n");
  });

  it("group membership grants access through group permission bits", () => {
    const env = newEnv();
    sudo(env, "groupadd developers");
    sudo(env, "mkdir /srv/shared");
    sudo(env, "chgrp developers /srv/shared");
    sudo(env, "chmod 770 /srv/shared");
    expect(out(env, "touch /srv/shared/x")).toBe("touch: cannot touch '/srv/shared/x': Permission denied\n");
    sudo(env, "usermod -aG developers student");
    expect(run(env, "touch /srv/shared/x").exitCode).toBe(0);
  });
});
