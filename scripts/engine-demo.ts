import { LinuxEnvironment, createDefaultState } from "../src/lib/linux-engine";

const env = new LinuxEnvironment(createDefaultState({ now: Date.UTC(2026, 10, 12, 8, 30) }));
const lines = process.argv.slice(2).join(" ").split(" ;; ");
let inputs: string[] = [];
for (const l of lines) {
  const [cmd, ...ins] = l.split(" <<< ");
  inputs = ins;
  const p = env.prompt();
  let r = env.execute(cmd, { inputs: [] });
  let i = 0;
  while (r.needsInput && i < inputs.length) {
    r = env.execute(cmd, { inputs: inputs.slice(0, ++i) });
  }
  process.stdout.write(`${p.user}@${p.host}:${p.display}${p.isRoot ? "#" : "$"} ${cmd}\n${r.output}${r.needsInput ? `[needs input: ${r.needsInput.prompt}]\n` : ""}${r.incomplete ? "[incomplete]\n" : ""}`);
}
