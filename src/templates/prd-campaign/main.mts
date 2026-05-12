import * as sandcastle from "@ai-hero/sandcastle";
import { Output } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { StructuredOutputError } from "@ai-hero/sandcastle";
import type {
  AgentProvider,
  OutputObjectDefinition,
  PreparedAgentRuntime,
  SandboxRunOptions,
} from "@ai-hero/sandcastle";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const MAX_ITERATIONS = 10;
const FULL_MODEL_RETRY_AFTER_REVIEW_FAILURES = 2;
const HITL_STOP_AFTER_REVIEW_FAILURES = 3;
const FALLBACK_IMPLEMENT_MODEL = "claude-sonnet-4-6";
const FALLBACK_ESCALATION_MODEL = "claude-opus-4-6";
const FALLBACK_REVIEW_MODEL = "claude-opus-4-6";
const QUEUE_DRAINED_SIGNAL = "<promise>QUEUE_DRAINED</promise>";
const COMPLETE_SIGNAL = "<promise>COMPLETE</promise>";
const RESULT_TAG = "result";
const REVIEW_TAG = "review";
const HANDOFF_TAG = "handoff";

type CliArgs = {
  prdId: string;
  resume: boolean;
  forceClean: boolean;
};

type CampaignConfig = {
  profile?: string;
  backlogManager?: string;
  repo?: string;
  readyLabel?: string;
  model?: string;
  escalationModel?: string;
  reviewModel?: string;
  usageLimitExit?: {
    enabled?: boolean;
    patterns?: string[];
  };
};

type ImplementResult = {
  status: "implemented" | "blocked" | "queue_drained";
  task_id: string | null;
  task_title: string | null;
  closed_task: boolean;
  verification_summary: string[];
  open_reason: string | null;
  blocker_summary: string | null;
};

type ReviewResult = {
  task_id: string | null;
  closed_task: boolean;
  summary: string;
  open_reason: string | null;
  ready_for_to_issues: string[];
  blocking_issue?: string | null;
  required_test?: string | null;
  file_hint?: string | null;
  acceptance_condition?: string | null;
};

type HandoffResult = {
  prd_id: string;
  summary: string;
  ready_for_to_issues: string[];
  missed_child_closure?: string[];
  need_human_decision: string[];
};

type PendingReviewState = {
  taskId: string;
  taskTitle: string | null;
  iterationBase: string;
  coverageOnlyWarning: string;
  noNewCommitWarning: string;
};

type CampaignState = {
  completedTaskIds: string[];
  openTaskReasons: Record<string, string>;
  retryFailureCounts: Record<string, number>;
  coverageOnlyCounts: Record<string, number>;
  retryTaskId: string | null;
  retryOpenReason: string | null;
  retryReviewResult: ReviewResult | null;
  pendingReview: PendingReviewState | null;
};

type PhaseTiming = {
  phase: string;
  iteration?: number;
  task_id?: string | null;
  model?: string;
  ms: number;
  tokens_expanded?: number;
  result?: string;
};

type RunArtifact = {
  generated_at: string;
  prd_id: string;
  run_status: string;
  hitl_stop_reason: string | null;
  final_review_skipped_reason: string | null;
  campaign_branch: string;
  worktree_path: string;
  queue_drained: boolean;
  iterations_run: number;
  completed_task_ids: string[];
  open_task_ids: string[];
  open_task_reasons: Record<string, string>;
  retry_failure_counts: Record<string, number>;
  coverage_only_counts: Record<string, number>;
  advisory_review_findings: ReviewResult[];
  final_review_summary: string | null;
  final_review_findings_ready_for_to_issues: string[];
  final_review_findings_missed_child_closure: string[];
  final_review_findings_need_human_decision: string[];
  phase_timings: PhaseTiming[];
  config: CampaignConfig;
  usage_limit_stop_reason?: string | null;
};

const hooks = {
  sandbox: {
    onSandboxReady: [{ command: "{{SANDBOX_READY_COMMAND}}" }],
  },
};

const copyToWorktree = JSON.parse("{{COPY_TO_WORKTREE}}") as string[];
const DEFAULT_USAGE_LIMIT_PATTERNS = [
  "usage limit",
  "rate limit",
  "quota exceeded",
  "quota has been exceeded",
  "monthly usage limit",
  "daily usage limit",
  "credits have been exhausted",
  "insufficient quota",
  "request too large for current quota",
];

class UsageLimitExceededError extends Error {
  readonly phase: string;

  constructor(message: string, phase: string) {
    super(message);
    this.name = "UsageLimitExceededError";
    this.phase = phase;
  }
}

function mapToObject<T>(map: Map<string, T>): Record<string, T> {
  return Object.fromEntries([...map.entries()].sort());
}

function objectToMap<T>(obj: Record<string, T> | undefined): Map<string, T> {
  return new Map(Object.entries(obj ?? {}));
}

function createObjectSchema<T>(
  parse: (value: unknown) => T,
): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "rockbox-manager",
      validate(value: unknown) {
        try {
          return { value: parse(value) };
        } catch (error) {
          return {
            issues: [
              {
                message:
                  error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      },
    },
  };
}

function expectObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function expectNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return expectString(value, label);
}

function expectOptionalNullableString(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  return expectNullableString(value, label);
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

const implementResultOutput: OutputObjectDefinition<ImplementResult> =
  Output.object({
    tag: RESULT_TAG,
    schema: createObjectSchema<ImplementResult>((value) => {
      const obj = expectObject(value, "ImplementResult");
      const status = expectString(obj.status, "ImplementResult.status");
      if (!["implemented", "blocked", "queue_drained"].includes(status)) {
        throw new Error(
          "ImplementResult.status must be implemented, blocked, or queue_drained",
        );
      }
      return {
        status: status as ImplementResult["status"],
        task_id: expectNullableString(obj.task_id, "ImplementResult.task_id"),
        task_title: expectNullableString(
          obj.task_title,
          "ImplementResult.task_title",
        ),
        closed_task: expectBoolean(
          obj.closed_task,
          "ImplementResult.closed_task",
        ),
        verification_summary: expectStringArray(
          obj.verification_summary,
          "ImplementResult.verification_summary",
        ),
        open_reason: expectNullableString(
          obj.open_reason,
          "ImplementResult.open_reason",
        ),
        blocker_summary: expectNullableString(
          obj.blocker_summary,
          "ImplementResult.blocker_summary",
        ),
      };
    }),
  });

const reviewResultOutput: OutputObjectDefinition<ReviewResult> = Output.object({
  tag: REVIEW_TAG,
  schema: createObjectSchema<ReviewResult>((value) => {
    const obj = expectObject(value, "ReviewResult");
    return {
      task_id: expectNullableString(obj.task_id, "ReviewResult.task_id"),
      closed_task: expectBoolean(obj.closed_task, "ReviewResult.closed_task"),
      summary: expectString(obj.summary, "ReviewResult.summary"),
      open_reason: expectNullableString(
        obj.open_reason,
        "ReviewResult.open_reason",
      ),
      ready_for_to_issues: expectStringArray(
        obj.ready_for_to_issues,
        "ReviewResult.ready_for_to_issues",
      ),
      blocking_issue: expectOptionalNullableString(
        obj.blocking_issue,
        "ReviewResult.blocking_issue",
      ),
      required_test: expectOptionalNullableString(
        obj.required_test,
        "ReviewResult.required_test",
      ),
      file_hint: expectOptionalNullableString(
        obj.file_hint,
        "ReviewResult.file_hint",
      ),
      acceptance_condition: expectOptionalNullableString(
        obj.acceptance_condition,
        "ReviewResult.acceptance_condition",
      ),
    };
  }),
});

const handoffResultOutput: OutputObjectDefinition<HandoffResult> = Output.object({
  tag: HANDOFF_TAG,
  schema: createObjectSchema<HandoffResult>((value) => {
    const obj = expectObject(value, "HandoffResult");
    return {
      prd_id: expectString(obj.prd_id, "HandoffResult.prd_id"),
      summary: expectString(obj.summary, "HandoffResult.summary"),
      ready_for_to_issues: expectStringArray(
        obj.ready_for_to_issues,
        "HandoffResult.ready_for_to_issues",
      ),
      missed_child_closure:
        obj.missed_child_closure === undefined
          ? undefined
          : expectStringArray(
              obj.missed_child_closure,
              "HandoffResult.missed_child_closure",
            ),
      need_human_decision: expectStringArray(
        obj.need_human_decision,
        "HandoffResult.need_human_decision",
      ),
    };
  }),
});

function extractLastTagContent(
  text: string,
  tag: string,
): string | undefined {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  let lastContent: string | undefined;
  let searchFrom = 0;
  while (true) {
    const openIdx = text.indexOf(openTag, searchFrom);
    if (openIdx === -1) break;
    const contentStart = openIdx + openTag.length;
    const closeIdx = text.indexOf(closeTag, contentStart);
    if (closeIdx === -1) break;
    lastContent = text.slice(contentStart, closeIdx);
    searchFrom = closeIdx + closeTag.length;
  }
  return lastContent;
}

function unwrapFences(text: string): string {
  const fenceMatch = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  if (fenceMatch) return (fenceMatch[1] ?? "").trim();
  return text;
}

async function extractObjectOutput<T>(
  stdout: string,
  definition: OutputObjectDefinition<T>,
  context: { commits: { sha: string }[]; branch: string },
): Promise<T> {
  const raw = extractLastTagContent(stdout, definition.tag);
  if (raw === undefined) {
    throw new StructuredOutputError(
      `Structured output tag <${definition.tag}> not found in agent output`,
      { tag: definition.tag, rawMatched: undefined, ...context },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapFences(raw.trim()));
  } catch (cause) {
    throw new StructuredOutputError(
      `Structured output tag <${definition.tag}> contains invalid JSON`,
      { tag: definition.tag, rawMatched: raw, cause, ...context },
    );
  }
  const result = await definition.schema["~standard"].validate(parsed);
  if (result.issues) {
    throw new StructuredOutputError(
      `Structured output tag <${definition.tag}> failed schema validation`,
      { tag: definition.tag, rawMatched: raw, cause: result.issues, ...context },
    );
  }
  return result.value;
}

async function sandboxRunWithOutput<T>(
  sandbox: sandcastle.Sandbox,
  options: SandboxRunOptions & { output: OutputObjectDefinition<T> },
): Promise<sandcastle.SandboxRunResult & { output: T }> {
  let result: sandcastle.SandboxRunResult;
  try {
    result = await sandbox.run(options as SandboxRunOptions);
  } catch (error) {
    if (isUsageLimitError(error)) {
      throw new UsageLimitExceededError(
        error instanceof Error ? error.message : String(error),
        options.name ?? "agent",
      );
    }
    throw error;
  }
  try {
    const output = await extractObjectOutput<T>(result.stdout, options.output, {
      commits: result.commits,
      branch: sandbox.branch,
    });
    return { ...result, output };
  } catch (error) {
    if (isUsageLimitText(result.stdout) || isUsageLimitError(error)) {
      throw new UsageLimitExceededError(
        `Usage limit hit during ${options.name ?? "agent"} run.`,
        options.name ?? "agent",
      );
    }
    throw error;
  }
}

const createAgent = (model: string): AgentProvider => {
  const provider = sandcastle.claudeCode(model);
  const basePrepareRun = provider.prepareRun?.bind(provider);
  return {
    ...provider,
    async prepareRun(options): Promise<PreparedAgentRuntime | undefined> {
      const prepared = await basePrepareRun?.(options);
      const command = provider.buildPrintCommand({
        prompt: "",
        dangerouslySkipPermissions: false,
      }).command;
      const escalationEnabled = command.includes(
        "--dangerously-bypass-approvals-and-sandbox",
      );
      return {
        ...prepared,
        logMessages: [
          ...(prepared?.logMessages ?? []),
          `Agent model: ${model}`,
          ...(escalationEnabled
            ? [
                "Agent escalation: verified via --dangerously-bypass-approvals-and-sandbox",
              ]
            : []),
        ],
      };
    },
  };
};

const parseArgs = (): CliArgs => {
  const rawArgs = process.argv.slice(2);
  const resume = rawArgs.includes("--resume");
  const forceClean = rawArgs.includes("--force-clean");
  const prdIdFlagIndex = rawArgs.indexOf("--prd-id");
  const prdId =
    prdIdFlagIndex >= 0
      ? rawArgs[prdIdFlagIndex + 1]?.trim()
      : rawArgs.find((arg) => !arg.startsWith("-"))?.trim();
  if (!prdId) {
    console.error(
      "Usage: npm run sandcastle -- --prd-id <ID> [--resume|--force-clean]",
    );
    process.exit(1);
  }
  if (resume && forceClean) {
    console.error("Use only one of --resume or --force-clean.");
    process.exit(1);
  }
  return { prdId, resume, forceClean };
};

const commandOutput = async (
  command: string,
  args: string[],
  cwd = process.cwd(),
): Promise<string> => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  return String(stdout).trim();
};

const gitOutput = (args: string[], cwd = process.cwd()): Promise<string> =>
  commandOutput("git", args, cwd);

const splitLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const expandedTokenCount = (stdout: string): number =>
  [...stdout.matchAll(/→ ~(\d+) tokens/g)].reduce(
    (total, match) => total + Number.parseInt(match[1] ?? "0", 10),
    0,
  );

const isCoverageOnlyChange = (files: string[]): boolean =>
  files.length > 0 &&
  files.every(
    (file) =>
      file.startsWith("tests/") ||
      file.includes("/tests/") ||
      file.endsWith(".snap"),
  );

const reviewBlockerJson = (review: ReviewResult | null): string =>
  JSON.stringify(
    {
      blocking_issue: review?.blocking_issue ?? review?.open_reason ?? null,
      required_test: review?.required_test ?? null,
      file_hint: review?.file_hint ?? null,
      acceptance_condition: review?.acceptance_condition ?? null,
    },
    null,
    2,
  );

const getUsageLimitPatterns = (): string[] =>
  (config.usageLimitExit?.patterns?.length
    ? config.usageLimitExit.patterns
    : DEFAULT_USAGE_LIMIT_PATTERNS
  ).map((pattern) => pattern.toLowerCase());

const isUsageLimitText = (text: string): boolean => {
  const normalized = text.toLowerCase();
  return getUsageLimitPatterns().some((pattern) => normalized.includes(pattern));
};

const isUsageLimitError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return isUsageLimitText(error.message);
};

async function timeAsync<T>(
  phaseTimings: PhaseTiming[],
  phase: string,
  fn: () => Promise<T>,
  extra: Omit<PhaseTiming, "phase" | "ms"> = {},
): Promise<T> {
  const started = performance.now();
  try {
    const result = await fn();
    phaseTimings.push({
      phase,
      ...extra,
      ms: Math.round(performance.now() - started),
      result: "ok",
    });
    return result;
  } catch (error) {
    phaseTimings.push({
      phase,
      ...extra,
      ms: Math.round(performance.now() - started),
      result: error instanceof Error ? error.message : "error",
    });
    throw error;
  }
}

const readCampaignConfig = async (): Promise<CampaignConfig> => {
  try {
    return JSON.parse(
      await readFile(".sandcastle/config.json", "utf-8"),
    ) as CampaignConfig;
  } catch {
    return {};
  }
};

const cliArgs = parseArgs();
const config = await readCampaignConfig();
const prdId = cliArgs.prdId;
const branch = `sandcastle/prd/${prdId}`;
const defaultImplementModel = config.model ?? FALLBACK_IMPLEMENT_MODEL;
const escalatedImplementModel =
  config.escalationModel ?? FALLBACK_ESCALATION_MODEL;
const reviewModel =
  config.reviewModel ?? config.escalationModel ?? FALLBACK_REVIEW_MODEL;
const worktreeName = branch.replace(/\//g, "-");
const worktreePath = join(
  process.cwd(),
  ".sandcastle",
  "worktrees",
  worktreeName,
);
const phaseTimings: PhaseTiming[] = [];
const stateDir = join(process.cwd(), ".sandcastle", "state");
const statePath = join(stateDir, `prd-${prdId}.json`);

const readCampaignState = async (): Promise<CampaignState | null> => {
  try {
    return JSON.parse(await readFile(statePath, "utf-8")) as CampaignState;
  } catch {
    return null;
  }
};

const writeCampaignState = async (state: CampaignState): Promise<void> => {
  await mkdir(stateDir, { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
};

const clearCampaignState = async (): Promise<void> => {
  await rm(statePath, { force: true });
};

const writeRunArtifact = async (artifact: RunArtifact): Promise<string> => {
  const runTimestamp = new Date().toISOString().replace(/:/g, "-");
  const artifactDir = join(
    process.cwd(),
    ".sandcastle",
    "runs",
    `prd-${prdId}`,
  );
  const artifactPath = join(artifactDir, `${runTimestamp}.json`);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2));
  return artifactPath;
};

if (existsSync(worktreePath)) {
  if (cliArgs.forceClean) {
    await gitOutput(["worktree", "remove", "--force", worktreePath]);
  } else if (cliArgs.resume) {
    const status = await gitOutput([
      "-C",
      worktreePath,
      "status",
      "--porcelain",
    ]);
    if (status) {
      console.error(
        `Cannot resume with dirty campaign worktree: ${worktreePath}`,
      );
      process.exit(1);
    }
    await gitOutput(["worktree", "remove", worktreePath]);
  } else {
    console.error(`Campaign worktree already exists: ${worktreePath}`);
    console.error("Use --resume or --force-clean.");
    process.exit(1);
  }
}

console.log(`\n=== Campaign branch: ${branch} ===`);
console.log(`=== Campaign PRD: ${prdId} ===\n`);

const wt = await timeAsync(phaseTimings, "create_worktree", () =>
  sandcastle.createWorktree({
    branchStrategy: { type: "branch", branch },
  }),
);

const sandbox = await timeAsync(phaseTimings, "create_sandbox", () =>
  wt.createSandbox({
    sandbox: docker(),
    hooks,
    copyToWorktree,
  }),
);

const completedTaskIds = new Set<string>();
const openTaskReasons = new Map<string, string>();
const advisoryFindings: ReviewResult[] = [];
const retryFailureCounts = new Map<string, number>();
const coverageOnlyCounts = new Map<string, number>();

let iterationsRun = 0;
let queueDrained = false;
let retryTaskId: string | null = null;
let retryOpenReason: string | null = null;
let retryReviewResult: ReviewResult | null = null;
let hitlStopReason: string | null = null;
let pendingReview: PendingReviewState | null = null;
let usageLimitStopReason: string | null = null;

const persistedState = await readCampaignState();
if (persistedState) {
  for (const taskId of persistedState.completedTaskIds ?? []) {
    completedTaskIds.add(taskId);
  }
  for (const [taskId, reason] of objectToMap(persistedState.openTaskReasons)) {
    openTaskReasons.set(taskId, reason);
  }
  for (const [taskId, count] of objectToMap(persistedState.retryFailureCounts)) {
    retryFailureCounts.set(taskId, count);
  }
  for (const [taskId, count] of objectToMap(persistedState.coverageOnlyCounts)) {
    coverageOnlyCounts.set(taskId, count);
  }
  retryTaskId = persistedState.retryTaskId;
  retryOpenReason = persistedState.retryOpenReason;
  retryReviewResult = persistedState.retryReviewResult;
  pendingReview = persistedState.pendingReview;
}

const persistCampaignState = async (): Promise<void> =>
  writeCampaignState({
    completedTaskIds: [...completedTaskIds].sort(),
    openTaskReasons: mapToObject(openTaskReasons),
    retryFailureCounts: mapToObject(retryFailureCounts),
    coverageOnlyCounts: mapToObject(coverageOnlyCounts),
    retryTaskId,
    retryOpenReason,
    retryReviewResult,
    pendingReview,
  });

const reviewTask = async (
  iteration: number,
  taskId: string,
  iterationBase: string,
  coverageOnlyWarning: string,
  noNewCommitWarning: string,
): Promise<ReviewResult> => {
  const review = await timeAsync<
    sandcastle.SandboxRunResult & { output: ReviewResult }
  >(
      phaseTimings,
      "reviewer",
      () =>
        sandboxRunWithOutput(sandbox, {
          name: "reviewer",
          maxIterations: 1,
          completionSignal: COMPLETE_SIGNAL,
          agent: createAgent(reviewModel),
          logging: { type: "stdout" },
          output: reviewResultOutput,
          promptFile: "./.sandcastle/review-prompt.md",
          promptArgs: {
            PRD_ID: prdId,
            TASK_ID: taskId,
            ITERATION_BASE: iterationBase,
            CAMPAIGN_BRANCH: branch,
            COVERAGE_ONLY_WARNING: coverageOnlyWarning,
            NO_NEW_COMMIT_WARNING: noNewCommitWarning,
          },
        }),
      {
        iteration,
        task_id: taskId,
        model: reviewModel,
      },
    );
  phaseTimings[phaseTimings.length - 1]!.tokens_expanded = expandedTokenCount(
    review.stdout,
  );
  return review.output;
};

try {
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    iterationsRun = iteration;
    if (
      retryTaskId &&
      (retryFailureCounts.get(retryTaskId) ?? 0) >=
        HITL_STOP_AFTER_REVIEW_FAILURES
    ) {
      hitlStopReason = `Task ${retryTaskId} failed review ${HITL_STOP_AFTER_REVIEW_FAILURES} times.`;
      break;
    }

    let reviewResult: ReviewResult;

    if (pendingReview) {
      reviewResult = await reviewTask(
        iteration,
        pendingReview.taskId,
        pendingReview.iterationBase,
        pendingReview.coverageOnlyWarning,
        pendingReview.noNewCommitWarning,
      );
      pendingReview = null;
      await persistCampaignState();
    } else {
      const iterationBase = await gitOutput(["rev-parse", branch]);
      const retryFailures = retryTaskId
        ? (retryFailureCounts.get(retryTaskId) ?? 0)
        : 0;
      const implementModel: string =
        retryTaskId && retryFailures >= FULL_MODEL_RETRY_AFTER_REVIEW_FAILURES
          ? escalatedImplementModel
          : defaultImplementModel;

      const implement = await timeAsync<
        sandcastle.SandboxRunResult & { output: ImplementResult }
      >(
          phaseTimings,
          "implementer",
          () =>
            sandboxRunWithOutput(sandbox, {
              name: "implementer",
              maxIterations: 1,
              completionSignal: QUEUE_DRAINED_SIGNAL,
              agent: createAgent(implementModel),
              logging: { type: "stdout" },
              output: implementResultOutput,
              promptFile: "./.sandcastle/implement-prompt.md",
              promptArgs: {
                PRD_ID: prdId,
                RETRY_TASK_ID: retryTaskId ?? "",
                RETRY_OPEN_REASON: retryOpenReason ?? "",
                RETRY_BLOCKER_JSON: retryReviewResult
                  ? reviewBlockerJson(retryReviewResult)
                  : "{}",
              },
            }),
          { iteration, task_id: retryTaskId, model: implementModel },
        );
      phaseTimings[phaseTimings.length - 1]!.tokens_expanded =
        expandedTokenCount(implement.stdout);

      if (implement.completionSignal === QUEUE_DRAINED_SIGNAL) {
        queueDrained = true;
        break;
      }

      const implementResult = implement.output;

      if (implementResult.status === "queue_drained") {
        queueDrained = true;
        break;
      }

      if (implementResult.task_id) {
        openTaskReasons.set(
          implementResult.task_id,
          implementResult.open_reason ??
            implementResult.blocker_summary ??
            "Task left open without a recorded reason.",
        );
      }

      if (implementResult.status !== "implemented" || !implementResult.task_id) {
        await persistCampaignState();
        continue;
      }

      const iterationChangedFiles = splitLines(
        await gitOutput(["diff", "--name-only", `${iterationBase}..${branch}`]),
      );
      const coverageOnly = isCoverageOnlyChange(iterationChangedFiles);
      if (coverageOnly) {
        coverageOnlyCounts.set(
          implementResult.task_id,
          (coverageOnlyCounts.get(implementResult.task_id) ?? 0) + 1,
        );
      }
      const coverageOnlyCount =
        coverageOnlyCounts.get(implementResult.task_id) ?? 0;
      const coverageOnlyWarning =
        coverageOnly && coverageOnlyCount >= 2
          ? `Task ${implementResult.task_id} has produced ${coverageOnlyCount} test-only implementation commits. Decide whether production behavior is already complete.`
          : "";
      const noNewCommitWarning = implement.commits.length
        ? ""
        : "Implementer returned implemented without a new commit. Accept only if existing branch commits already satisfy this task.";

      pendingReview = {
        taskId: implementResult.task_id,
        taskTitle: implementResult.task_title,
        iterationBase,
        coverageOnlyWarning,
        noNewCommitWarning,
      };
      await persistCampaignState();

      reviewResult = await reviewTask(
        iteration,
        implementResult.task_id,
        iterationBase,
        coverageOnlyWarning,
        noNewCommitWarning,
      );
      pendingReview = null;
      await persistCampaignState();
    }

    advisoryFindings.push(reviewResult);

    if (reviewResult.task_id && reviewResult.closed_task) {
      completedTaskIds.add(reviewResult.task_id);
      openTaskReasons.delete(reviewResult.task_id);
      retryFailureCounts.delete(reviewResult.task_id);
      if (retryTaskId === reviewResult.task_id) {
        retryTaskId = null;
        retryOpenReason = null;
        retryReviewResult = null;
      }
    }

    if (reviewResult.task_id && !reviewResult.closed_task) {
      const openReason = reviewResult.open_reason ?? reviewResult.summary;
      openTaskReasons.set(reviewResult.task_id, openReason);
      retryTaskId = reviewResult.task_id;
      retryOpenReason = openReason;
      retryReviewResult = reviewResult;
      retryFailureCounts.set(
        reviewResult.task_id,
        (retryFailureCounts.get(reviewResult.task_id) ?? 0) + 1,
      );
    }
    await persistCampaignState();
  }

  let runStatus = hitlStopReason
    ? "hitl_required"
    : queueDrained
      ? "queue_drained"
      : "completed";
  let handoff: HandoffResult | null = null;
  let finalReviewSkippedReason: string | null = null;

  if (openTaskReasons.size > 0) {
    runStatus = hitlStopReason ? "hitl_required" : "blocked_on_children";
    finalReviewSkippedReason =
      "Skipped final PRD review because child blockers remain open.";
  } else {
    const prdReview = await timeAsync<
      sandcastle.SandboxRunResult & { output: HandoffResult }
    >(
        phaseTimings,
        "prd_reviewer",
        () =>
          sandboxRunWithOutput(sandbox, {
            name: "prd-reviewer",
            maxIterations: 1,
            completionSignal: COMPLETE_SIGNAL,
            agent: createAgent(reviewModel),
            logging: { type: "stdout" },
            output: handoffResultOutput,
            promptFile: "./.sandcastle/prd-review-prompt.md",
            promptArgs: {
              PRD_ID: prdId,
              CAMPAIGN_BRANCH: branch,
            },
          }),
        { model: reviewModel },
      );
    phaseTimings[phaseTimings.length - 1]!.tokens_expanded = expandedTokenCount(
      prdReview.stdout,
    );
    handoff = prdReview.output;
  }

  const artifactPath = await writeRunArtifact({
    generated_at: new Date().toISOString(),
    prd_id: prdId,
    run_status: runStatus,
    hitl_stop_reason: hitlStopReason,
    final_review_skipped_reason: finalReviewSkippedReason,
    campaign_branch: branch,
    worktree_path: wt.worktreePath,
    queue_drained: queueDrained,
    iterations_run: iterationsRun,
    completed_task_ids: [...completedTaskIds].sort(),
    open_task_ids: [...openTaskReasons.keys()].sort(),
    open_task_reasons: Object.fromEntries(
      [...openTaskReasons.entries()].sort(),
    ),
    retry_failure_counts: Object.fromEntries(
      [...retryFailureCounts.entries()].sort(),
    ),
    coverage_only_counts: Object.fromEntries(
      [...coverageOnlyCounts.entries()].sort(),
    ),
    advisory_review_findings: advisoryFindings,
    final_review_summary: handoff?.summary ?? null,
    final_review_findings_ready_for_to_issues:
      handoff?.ready_for_to_issues ?? [],
    final_review_findings_missed_child_closure:
      handoff?.missed_child_closure ?? [],
    final_review_findings_need_human_decision:
      handoff?.need_human_decision ?? [],
    phase_timings: phaseTimings,
    config,
    usage_limit_stop_reason: null,
  });

  console.log(
    handoff ? "\nFinal PRD review complete." : "\nFinal PRD review skipped.",
  );
  console.log(`Handoff artifact: ${artifactPath}`);
  console.log(`Campaign worktree: ${wt.worktreePath}`);
  console.log(
    `Cleanup when done: git worktree remove --force ${wt.worktreePath}`,
  );

  if (openTaskReasons.size > 0 || pendingReview || hitlStopReason) {
    await persistCampaignState();
  } else {
    await clearCampaignState();
  }
} catch (error) {
  if (config.usageLimitExit?.enabled !== false && error instanceof UsageLimitExceededError) {
    usageLimitStopReason = `${error.phase}: ${error.message}`;
    await persistCampaignState();
    const artifactPath = await writeRunArtifact({
      generated_at: new Date().toISOString(),
      prd_id: prdId,
      run_status: "usage_limited",
      hitl_stop_reason: hitlStopReason,
      final_review_skipped_reason:
        "Stopped early because the model hit a usage limit before completing the next prompt.",
      campaign_branch: branch,
      worktree_path: wt.worktreePath,
      queue_drained: queueDrained,
      iterations_run: iterationsRun,
      completed_task_ids: [...completedTaskIds].sort(),
      open_task_ids: [...openTaskReasons.keys()].sort(),
      open_task_reasons: Object.fromEntries(
        [...openTaskReasons.entries()].sort(),
      ),
      retry_failure_counts: Object.fromEntries(
        [...retryFailureCounts.entries()].sort(),
      ),
      coverage_only_counts: Object.fromEntries(
        [...coverageOnlyCounts.entries()].sort(),
      ),
      advisory_review_findings: advisoryFindings,
      final_review_summary: null,
      final_review_findings_ready_for_to_issues: [],
      final_review_findings_missed_child_closure: [],
      final_review_findings_need_human_decision: [],
      phase_timings: phaseTimings,
      config,
      usage_limit_stop_reason: usageLimitStopReason,
    });
    console.log("\nStopped cleanly due to model usage limits.");
    console.log(`Reason: ${usageLimitStopReason}`);
    console.log(`Handoff artifact: ${artifactPath}`);
    console.log(`Campaign worktree: ${wt.worktreePath}`);
    console.log("Resume later with the same PRD id once limits reset.");
  } else {
    throw error;
  }
} finally {
  await sandbox.close();
}

console.log("\nAll done.");
