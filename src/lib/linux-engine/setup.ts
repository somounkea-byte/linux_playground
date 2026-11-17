import { createDefaultState } from "./state";
import { LinuxEnvironment } from "./terminal";
import type { EnvState } from "./types";

/** Build an environment and run a setup script (one command per line) as root. */
export function buildChallengeState(setupScript: string, opts: { fullName?: string; now?: number } = {}): EnvState {
  const state = createDefaultState({ username: "student", password: "student", fullName: opts.fullName, now: opts.now });
  if (!setupScript.trim()) return state;
  const env = new LinuxEnvironment(state);
  const lines = setupScript
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  for (const line of lines) env.runAsRoot(line, { now: opts.now });
  env.state.session.history = [];
  return env.state;
}

/**
 * Run a student's commands non-interactively (practical quiz questions).
 * `sudo` prompts are answered with the default password.
 */
export function runCommands(state: EnvState, commands: string[], now?: number): { transcript: string } {
  const env = new LinuxEnvironment(state);
  let transcript = "";
  for (const line of commands.slice(0, 60)) {
    if (!line.trim()) continue;
    let r = env.execute(line, { now, maxSteps: 5000 });
    let answers = 0;
    while (r.needsInput && answers < 3) {
      answers++;
      r = env.execute(line, { now, maxSteps: 5000, inputs: Array(answers).fill(r.needsInput.secret ? "student" : "y") });
    }
    const p = env.prompt();
    transcript += `${p.user}@${p.host}:${p.display}${p.isRoot ? "#" : "$"} ${line}\n${r.output}`;
    if (transcript.length > 20000) break;
  }
  return { transcript };
}
