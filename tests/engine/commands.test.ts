import { describe, expect, it } from "vitest";
import { newEnv, out, run, sudo } from "./helpers";

describe("navigation", () => {
  it("pwd prints the home directory initially", () => {
    expect(out(newEnv(), "pwd")).toBe("/home/student\n");
  });

  it("cd changes directory and supports -, .. and ~", () => {
    const env = newEnv();
    run(env, "cd /var/log");
    expect(out(env, "pwd")).toBe("/var/log\n");
    run(env, "cd ..");
    expect(out(env, "pwd")).toBe("/var\n");
    expect(out(env, "cd -")).toBe("/var/log\n");
    run(env, "cd ~");
    expect(out(env, "pwd")).toBe("/home/student\n");
    run(env, "cd /tmp");
    run(env, "cd");
    expect(env.prompt().display).toBe("~");
  });

  it("cd reports realistic errors", () => {
    const env = newEnv();
    expect(out(env, "cd nowhere")).toBe("bash: cd: nowhere: No such file or directory\n");
    expect(out(env, "cd documents/welcome.txt")).toBe("bash: cd: documents/welcome.txt: Not a directory\n");
    expect(out(env, "cd /root")).toBe("bash: cd: /root: Permission denied\n");
    expect(out(env, "cd a b")).toBe("bash: cd: too many arguments\n");
  });

  it("ls lists, hides dotfiles and supports -a/-l", () => {
    const env = newEnv();
    expect(out(env, "ls")).toContain("documents");
    expect(out(env, "ls")).not.toContain(".bashrc");
    expect(out(env, "ls -a")).toContain(".bashrc");
    const long = out(env, "ls -l documents");
    expect(long).toMatch(/^total \d+\n-rw-rw-r-- 1 student student\s+\d+ Nov 12 \d\d:\d\d welcome.txt\n$/);
    expect(out(env, "ls missing")).toBe("ls: cannot access 'missing': No such file or directory\n");
    expect(out(env, "ls /root")).toBe("ls: cannot open directory '/root': Permission denied\n");
  });

  it("ls output is one-per-line when piped", () => {
    const env = newEnv();
    expect(out(env, "ls | head -2")).toBe("documents\ndownloads\n");
  });
});

describe("file operations", () => {
  it("mkdir, touch, echo >, cat", () => {
    const env = newEnv();
    run(env, "mkdir projects2");
    run(env, "cd projects2");
    run(env, "touch hello.txt");
    run(env, 'echo "Hello Linux" > hello.txt');
    expect(out(env, "cat hello.txt")).toBe("Hello Linux\n");
    run(env, 'echo "Second" >> hello.txt');
    expect(out(env, "cat hello.txt")).toBe("Hello Linux\nSecond\n");
    expect(out(env, "mkdir ../projects2")).toBe("mkdir: cannot create directory ‘../projects2’: File exists\n");
  });

  it("mkdir -p creates parents, brace expansion creates many", () => {
    const env = newEnv();
    run(env, "mkdir -p app/src/components");
    run(env, "touch app/file{1..3}.txt");
    expect(out(env, "ls app")).toBe("file1.txt  file2.txt  file3.txt  src\n");
    expect(out(env, "mkdir a/b")).toBe("mkdir: cannot create directory ‘a/b’: No such file or directory\n");
  });

  it("cp copies files and directories (-r)", () => {
    const env = newEnv();
    run(env, "cp documents/welcome.txt copy.txt");
    expect(out(env, "cat copy.txt")).toContain("Welcome to Linux Playground!");
    expect(out(env, "cp documents backup")).toBe("cp: -r not specified; omitting directory 'documents'\n");
    run(env, "cp -r documents backup");
    expect(out(env, "ls backup")).toBe("welcome.txt\n");
    expect(out(env, "cp missing x")).toBe("cp: cannot stat 'missing': No such file or directory\n");
  });

  it("mv renames and moves", () => {
    const env = newEnv();
    run(env, "touch a.txt");
    run(env, "mv a.txt b.txt");
    expect(out(env, "ls b.txt")).toBe("b.txt\n");
    run(env, "mv b.txt documents/");
    expect(out(env, "ls documents")).toBe("b.txt  welcome.txt\n");
    expect(out(env, "mv documents documents/sub")).toBe("mv: cannot move 'documents' to a subdirectory of itself, 'documents/sub'\n");
  });

  it("rm removes files and refuses directories without -r", () => {
    const env = newEnv();
    run(env, "touch f.txt");
    run(env, "rm f.txt");
    expect(out(env, "ls f.txt")).toContain("No such file or directory");
    expect(out(env, "rm documents")).toBe("rm: cannot remove 'documents': Is a directory\n");
    run(env, "rm -r documents");
    expect(out(env, "ls")).toBe("downloads  projects\n");
    expect(out(env, "rm nothing")).toBe("rm: cannot remove 'nothing': No such file or directory\n");
    expect(run(env, "rm -f nothing").exitCode).toBe(0);
  });

  it("rmdir only removes empty directories", () => {
    const env = newEnv();
    expect(out(env, "rmdir documents")).toBe("rmdir: failed to remove 'documents': Directory not empty\n");
    run(env, "rmdir downloads");
    expect(out(env, "ls")).toBe("documents  projects\n");
  });

  it("cat errors are realistic", () => {
    const env = newEnv();
    expect(out(env, "cat nope")).toBe("cat: nope: No such file or directory\n");
    expect(out(env, "cat documents")).toBe("cat: documents: Is a directory\n");
  });

  it("find, grep, wc, sort, cut and pipes work together", () => {
    const env = newEnv();
    expect(out(env, 'find . -name "*.txt"')).toBe("./documents/welcome.txt\n");
    expect(out(env, "grep -c sudo documents/welcome.txt")).toBe("1\n");
    expect(out(env, "cut -d: -f1 /etc/passwd | sort | head -3")).toBe("_apt\nbackup\nbin\n");
    expect(out(env, "echo one two three | wc -w")).toBe("3\n");
    expect(out(env, "printf 'b\\na\\nb\\n' | sort | uniq -c")).toBe("      1 a\n      2 b\n");
  });

  it("sed and awk transform text", () => {
    const env = newEnv();
    expect(out(env, "echo hello world | sed 's/world/linux/'")).toBe("hello linux\n");
    expect(out(env, "awk -F: '$3 >= 1000 && $3 < 60000 {print $1, $3}' /etc/passwd")).toBe("student 1000\n");
    expect(out(env, "printf '1 2\\n3 4\\n' | awk '{s += $2} END {print s}'")).toBe("6\n");
  });

  it("redirection: 2>, 2>&1, /dev/null, <", () => {
    const env = newEnv();
    expect(out(env, "ls nope 2>/dev/null")).toBe("");
    run(env, "ls nope > err.txt 2>&1");
    expect(out(env, "cat err.txt")).toBe("ls: cannot access 'nope': No such file or directory\n");
    expect(out(env, "wc -l < /etc/hostname")).toBe("1\n");
    expect(out(env, "echo hi > /etc/x")).toBe("bash: /etc/x: Permission denied\n");
  });

  it("command not found suggests similar commands", () => {
    const env = newEnv();
    expect(out(env, "lss")).toContain("Command 'lss' not found, did you mean:");
    expect(out(env, "xyzzy")).toBe("xyzzy: command not found\n");
    expect(run(env, "xyzzy").exitCode).toBe(127);
    expect(out(env, "tree")).toBe("Command 'tree' not found, but can be installed with:\nsudo apt install tree\n");
  });
});

describe("history and aliases", () => {
  it("records history and expands !!", () => {
    const env = newEnv();
    run(env, "echo first");
    run(env, "pwd");
    expect(out(env, "history")).toBe("    1  echo first\n    2  pwd\n    3  history\n");
    expect(out(env, "!-2")).toBe("pwd\n/home/student\n");
    expect(out(env, "!!")).toBe("pwd\n/home/student\n");
    expect(out(env, "!1")).toBe("echo first\nfirst\n");
  });

  it("supports aliases", () => {
    const env = newEnv();
    run(env, "alias hi='echo hello'");
    expect(out(env, "hi there")).toBe("hello there\n");
    expect(out(env, "type ll")).toBe("ll is aliased to `ls -alF'\n");
  });
});

describe("tab completion", () => {
  it("completes commands and paths", () => {
    const env = newEnv();
    expect(env.complete("whoa").matches).toEqual(["whoami"]);
    expect(env.complete("cat doc").matches).toEqual(["documents/"]);
    expect(env.complete("cat documents/w").matches).toEqual(["documents/welcome.txt"]);
    expect(env.complete("cd d").matches).toEqual(["documents/", "downloads/"]);
    expect(env.complete("cd d").common).toBe("do");
  });
});

describe("interactive prompts", () => {
  it("needs input for sudo and replays with the password", () => {
    const env = newEnv();
    const first = env.execute("sudo whoami");
    expect(first.needsInput?.prompt).toBe("[sudo] password for student: ");
    expect(first.needsInput?.secret).toBe(true);
    expect(first.mutated).toBe(false);
    const second = env.execute("sudo whoami", { inputs: ["student"] });
    expect(second.output).toBe("[sudo] password for student: \nroot\n");
    // cached credentials: no prompt the second time
    expect(env.execute("sudo whoami").output).toBe("root\n");
  });

  it("rejects a wrong sudo password three times", () => {
    const env = newEnv();
    const r = run(env, "sudo ls", ["a", "b", "c"]);
    expect(r.text).toContain("Sorry, try again.");
    expect(r.text).toContain("sudo: 3 incorrect password attempts");
  });

  it("asks for the line again when quotes are unbalanced", () => {
    const env = newEnv();
    expect(env.execute('echo "unterminated').incomplete).toBe(true);
    expect(env.execute('echo "multi\nline"').output).toBe("multi\nline\n");
  });

  it("sudo uses root and builtins are not commands", () => {
    const env = newEnv();
    expect(sudo(env, "cd /root").text).toContain("sudo: cd: command not found");
  });
});
