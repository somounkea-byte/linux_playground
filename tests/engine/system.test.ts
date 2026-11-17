import { describe, expect, it } from "vitest";
import { evaluateChecks, type Check } from "@/lib/linux-engine";
import { newEnv, out, run, sudo } from "./helpers";

describe("processes", () => {
  it("ps aux lists system processes", () => {
    const env = newEnv();
    const text = out(env, "ps aux");
    expect(text.split("\n")[0]).toBe("USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND");
    expect(text).toContain("/sbin/init splash");
    expect(text).toContain("sshd: /usr/sbin/sshd -D");
  });

  it("background jobs, jobs and kill", () => {
    const env = newEnv();
    const r = run(env, "sleep 300 &");
    expect(r.text).toMatch(/^\[1\] \d+\n$/);
    expect(out(env, "jobs")).toBe("[1]+  Running                 sleep 300 &\n");
    const pid = /\d+/.exec(r.text.slice(4))![0];
    expect(out(env, `ps -p ${pid} -o pid,cmd`)).toContain("sleep 300");
    expect(out(env, `kill ${pid}`)).toBe(`[1]+  Terminated              sleep 300\n`);
    expect(out(env, "jobs")).toBe("");
  });

  it("users cannot kill other users' processes", () => {
    const env = newEnv();
    expect(out(env, "kill 1")).toBe("bash: kill: (1) - Operation not permitted\n");
    expect(out(env, "kill 99999")).toBe("bash: kill: (99999) - No such process\n");
  });
});

describe("packages and services", () => {
  it("apt requires root", () => {
    const env = newEnv();
    expect(out(env, "apt install tree")).toContain("are you root?");
  });

  it("installs a package and makes its command available", () => {
    const env = newEnv();
    sudo(env, "apt update");
    const r = sudo(env, "apt install -y tree");
    expect(r.text).toContain("Setting up tree");
    expect(out(env, "which tree")).toBe("/usr/bin/tree\n");
    expect(out(env, "tree -L 1")).toContain("3 directories, 0 files");
    expect(out(env, "dpkg -l tree")).toContain("ii  tree");
    sudo(env, "apt remove -y tree");
    expect(out(env, "which tree")).toBe("");
  });

  it("nginx install starts a service reachable with curl", () => {
    const env = newEnv();
    expect(out(env, "curl -s http://localhost")).toBe("");
    sudo(env, "apt install -y nginx");
    expect(out(env, "systemctl is-active nginx")).toBe("active\n");
    expect(out(env, "curl -s http://localhost")).toContain("Welcome to nginx!");
    expect(out(env, "ss -tuln")).toContain("0.0.0.0:80");
    sudo(env, "systemctl stop nginx");
    expect(out(env, "curl http://localhost")).toBe("curl: (7) Failed to connect to localhost port 80 after 0 ms: Couldn't connect to server\n");
    expect(out(env, "systemctl start nginx")).toContain("Interactive authentication required");
  });

  it("unknown packages fail", () => {
    const env = newEnv();
    expect(sudo(env, "apt install nosuchpkg").text).toContain("E: Unable to locate package nosuchpkg");
  });
});

describe("networking", () => {
  it("ip addr shows interfaces", () => {
    const env = newEnv();
    const t = out(env, "ip addr");
    expect(t).toContain("inet 127.0.0.1/8 scope host lo");
    expect(t).toContain("inet 10.0.2.15/24");
  });

  it("ping known and unknown hosts", () => {
    const env = newEnv();
    const t = out(env, "ping -c 2 google.com");
    expect(t).toContain("PING google.com (142.250.190.78) 56(84) bytes of data.");
    expect(t).toContain("2 packets transmitted, 2 received, 0% packet loss");
    expect(out(env, "ping nowhere.invalid")).toBe("ping: nowhere.invalid: Temporary failure in name resolution\n");
  });

  it("taking an interface down breaks connectivity", () => {
    const env = newEnv();
    sudo(env, "ip link set eth0 down");
    expect(out(env, "ping -c 1 google.com")).toBe("ping: connect: Network is unreachable\n");
    expect(out(env, "hostname -I")).toBe(" \n");
  });
});

describe("storage", () => {
  it("df, lsblk, free show simulated data", () => {
    const env = newEnv();
    expect(out(env, "df -h")).toContain("/dev/sda2");
    expect(out(env, "lsblk")).toContain("sdb");
    expect(out(env, "free -h").split("\n")[1]).toMatch(/^Mem:/);
  });

  it("format and mount the spare disk", () => {
    const env = newEnv();
    expect(sudo(env, "mount /dev/sdb /mnt").text).toContain("wrong fs type");
    sudo(env, "mkfs.ext4 /dev/sdb");
    sudo(env, "mkdir /mnt/data");
    expect(sudo(env, "mount /dev/sdb /mnt/data").exitCode).toBe(0);
    expect(out(env, "df -h /mnt/data")).toContain("/dev/sdb");
  });
});

describe("security", () => {
  it("ufw manages firewall rules", () => {
    const env = newEnv();
    expect(out(env, "ufw status")).toBe("ERROR: You need to be root to run this script\n");
    sudo(env, "ufw allow 22/tcp");
    run(env, "sudo ufw enable", ["y"]);
    const status = sudo(env, "ufw status").text;
    expect(status).toContain("Status: active");
    expect(status).toContain("22/tcp                     ALLOW       Anywhere");
  });

  it("journalctl shows service logs", () => {
    const env = newEnv();
    expect(out(env, "journalctl -u ssh")).toContain("Server listening on 0.0.0.0 port 22.");
  });
});

describe("grading checks", () => {
  const CHALLENGE: Check[] = [
    { id: "g", type: "group_exists", group: "developers", description: "developers group" },
    { id: "u1", type: "user_exists", username: "john", description: "john exists" },
    { id: "u2", type: "user_exists", username: "mary", description: "mary exists" },
    { id: "m1", type: "user_in_group", username: "john", group: "developers", description: "john in developers" },
    { id: "m2", type: "user_in_group", username: "mary", group: "developers", description: "mary in developers" },
    { id: "d", type: "file_exists", path: "/var/www/project", kind: "dir", description: "dir" },
    { id: "o", type: "file_owner", path: "/var/www/project", group: "developers", description: "group owner" },
    { id: "p", type: "file_mode", path: "/var/www/project", mode: "770", description: "mode" },
  ];

  it("fails on a fresh environment", () => {
    const env = newEnv();
    expect(evaluateChecks(env.state, CHALLENGE).every((r) => !r.passed)).toBe(true);
  });

  it("passes with one valid command sequence", () => {
    const env = newEnv();
    for (const c of ["groupadd developers", "useradd john", "useradd mary", "usermod -aG developers john", "usermod -aG developers mary", "mkdir -p /var/www/project", "chown :developers /var/www/project", "chmod 770 /var/www/project"]) sudo(env, c);
    expect(evaluateChecks(env.state, CHALLENGE).map((r) => r.passed)).toEqual(Array(CHALLENGE.length).fill(true));
  });

  it("passes with a different valid command sequence", () => {
    const env = newEnv();
    run(env, "sudo -i", ["student"]);
    for (const c of ["addgroup developers", "useradd -m -G developers john", "adduser --disabled-password --gecos '' mary", "gpasswd -a mary developers", "mkdir /var/www/project", "chgrp developers /var/www/project", "chmod u=rwx,g=rwx,o= /var/www/project"]) run(env, c);
    expect(evaluateChecks(env.state, CHALLENGE).every((r) => r.passed)).toBe(true);
  });

  it("command_output checks run on a copy of the state", () => {
    const env = newEnv();
    const before = JSON.stringify(env.state);
    const [r] = evaluateChecks(env.state, [{ id: "x", type: "command_output", command: "touch /tmp/zz; echo hi", contains: "hi", description: "x" }]);
    expect(r.passed).toBe(true);
    expect(JSON.stringify(env.state)).toBe(before);
  });
});
