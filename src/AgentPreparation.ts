import { posix } from "node:path";
import { Effect } from "effect";
import type { ExecError, CopyError } from "./errors.js";
import type { SandboxService } from "./SandboxFactory.js";
import type { AgentProvider, PreparedAgentRuntime } from "./AgentProvider.js";

const shellEscape = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";

export const prepareAgentRuntime = async (
  provider: AgentProvider,
  hostRepoDir: string,
): Promise<PreparedAgentRuntime | undefined> =>
  provider.prepareRun?.({ hostRepoDir });

export const applyPreparedAgentRuntime = (
  prepared: PreparedAgentRuntime | undefined,
  sandbox: SandboxService,
): Effect.Effect<void, ExecError | CopyError> =>
  Effect.gen(function* () {
    for (const file of prepared?.sandboxFiles ?? []) {
      const parentDir = posix.dirname(file.sandboxPath);
      yield* sandbox.exec(`mkdir -p ${shellEscape(parentDir)}`);
      yield* sandbox.copyIn(file.hostPath, file.sandboxPath);
    }
  });
