import { createDefaultState, LinuxEnvironment } from "@/lib/linux-engine";
import { stripAnsi } from "@/lib/linux-engine/util";

export const NOW = Date.UTC(2026, 10, 12, 8, 30, 0);

export function newEnv() {
  return new LinuxEnvironment(createDefaultState({ now: NOW }));
}

/** Run a command, answering interactive prompts with `inputs` one at a time. */
export function run(env: LinuxEnvironment, line: string, inputs: string[] = []) {
  let used = 0;
  let r = env.execute(line, { now: NOW + 1000, inputs: [] });
  while (r.needsInput) {
    if (used >= inputs.length) break;
    used++;
    r = env.execute(line, { now: NOW + 1000, inputs: inputs.slice(0, used) });
  }
  return { ...r, text: stripAnsi(r.output) };
}

/** Run as student and return plain output text. */
export function out(env: LinuxEnvironment, line: string, inputs: string[] = []) {
  return run(env, line, inputs).text;
}

export function sudo(env: LinuxEnvironment, line: string) {
  return run(env, `sudo ${line}`, ["student"]);
}
