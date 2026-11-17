import { describe, expect, it } from "vitest";
import { newEnv, out, run } from "./helpers";

const SCRIPT = `#!/bin/bash
greet() {
  local who=$1
  echo "Hello, $who!"
}
for n in Alice Bob; do greet "$n"; done
count=0
while [ $count -lt 3 ]; do count=$((count+1)); done
echo "count=$count"
arr=(red green blue)
echo "\${#arr[@]} colors: \${arr[*]}"
if [[ "$1" == t* ]]; then echo "starts with t"; else echo "no t"; fi
case $2 in
  [0-9]*) echo number;;
  *) echo other;;
esac
read -p "Name? " name
echo "Hi $name"
exit 3
`;

describe("bash scripting", () => {
  it("runs functions, loops, arrays, conditionals, case and read", () => {
    const env = newEnv();
    env.state.session.history = [];
    run(env, `cat > s.sh <<'EOF'\n${SCRIPT}EOF`);
    const r = run(env, "bash s.sh test 42", ["Zoe"]);
    expect(r.text).toBe("Hello, Alice!\nHello, Bob!\ncount=3\n3 colors: red green blue\nstarts with t\nnumber\nName? Zoe\nHi Zoe\n");
    expect(r.exitCode).toBe(3);
  });

  it("reads input from a pipe", () => {
    const env = newEnv();
    run(env, `printf '#!/bin/bash\\nread a b\\necho "[$b] [$a]"\\n' > r.sh`);
    expect(out(env, "echo one two three | bash r.sh")).toBe("[two three] [one]\n");
  });

  it("supports while read loops over files", () => {
    const env = newEnv();
    expect(out(env, "while read line; do echo \"> $line\"; done < /etc/hostname")).toBe("> linux-playground\n");
  });

  it("parameter expansion operators", () => {
    const env = newEnv();
    run(env, "f=archive.tar.gz");
    expect(out(env, 'echo ${f%.gz} ${f%%.*} ${f#*.} ${f##*.} ${#f} ${f^^}')).toBe("archive.tar archive tar.gz gz 14 ARCHIVE.TAR.GZ\n");
    expect(out(env, 'echo ${unset:-default} ${f/tar/zip} ${f:0:7}')).toBe("default archive.zip.gz archive\n");
  });

  it("arithmetic and test", () => {
    const env = newEnv();
    expect(out(env, "echo $(( (2+3)*4 % 7 )) $((2**10)) $((7/2))")).toBe("6 1024 3\n");
    expect(out(env, "[ 5 -gt 3 ] && echo yes || echo no")).toBe("yes\n");
    expect(out(env, "[ -d /etc ] && [ ! -f /etc ] && echo dir")).toBe("dir\n");
    expect(out(env, '[ "a" = "b" ]; echo $?')).toBe("1\n");
    expect(out(env, "(( 3 > 2 )) && echo ok")).toBe("ok\n");
    expect(out(env, "for ((i=0; i<3; i++)); do echo -n $i; done; echo")).toBe("012\n");
  });

  it("command substitution and quoting", () => {
    const env = newEnv();
    expect(out(env, 'echo "I am $(whoami) on `hostname`"')).toBe("I am student on linux-playground\n");
    expect(out(env, "echo '$HOME' \"$HOME\" \\$HOME")).toBe("$HOME /home/student $HOME\n");
    expect(out(env, 'x="a   b"; echo $x; echo "$x"')).toBe("a b\na   b\n");
  });

  it("glob expansion", () => {
    const env = newEnv();
    run(env, "touch a1.txt a2.txt b.log");
    expect(out(env, "echo *.txt")).toBe("a1.txt a2.txt\n");
    expect(out(env, "echo a?.txt")).toBe("a1.txt a2.txt\n");
    expect(out(env, "echo *.none")).toBe("*.none\n");
    expect(out(env, "echo '*.txt'")).toBe("*.txt\n");
  });

  it("reports syntax errors with line numbers", () => {
    const env = newEnv();
    run(env, "printf 'echo a\\nif true; then\\necho b\\n' > bad.sh");
    expect(out(env, "bash bad.sh")).toBe("bad.sh: line 4: syntax error: unexpected end of file\n");
    expect(out(env, "echo a; fi")).toBe("bash: syntax error near unexpected token `fi'\n");
    run(env, "printf 'echo start\\nnosuchcmd\\n' > nf.sh");
    expect(out(env, "bash nf.sh")).toBe("start\nnf.sh: line 2: nosuchcmd: command not found\n");
  });

  it("stops runaway loops safely", () => {
    const env = newEnv();
    const r = run(env, "while true; do :; done");
    expect(r.text).toContain("execution limit reached");
  });

  it("script variables do not leak into the parent shell but source does", () => {
    const env = newEnv();
    run(env, "echo 'MYVAR=42' > v.sh");
    run(env, "bash v.sh");
    expect(out(env, 'echo "[$MYVAR]"')).toBe("[]\n");
    run(env, "source v.sh");
    expect(out(env, "echo $MYVAR")).toBe("42\n");
  });

  it("export makes variables visible to child scripts", () => {
    const env = newEnv();
    run(env, "echo 'echo \"color=$COLOR\"' > c.sh");
    run(env, "COLOR=blue");
    expect(out(env, "bash c.sh")).toBe("color=\n");
    run(env, "export COLOR");
    expect(out(env, "bash c.sh")).toBe("color=blue\n");
  });
});
