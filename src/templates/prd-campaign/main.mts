import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const MAX_ITERATIONS = 10;
const FULL_MODEL_RETRY_AFTER_REVIEW_FAILURES = 2;
const HITL_STOP_AFTER_REVIEW_FAILURES = 3;
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

type PhaseTiming = {
  phase: string;
  iteration?: number;
  task_id?: string | null;
  model?: string;
  ms: number;
  tokens_expanded?: number;
  result?: string;
};

const hooks = {
  sandbox: {
    onSandboxReady: [{ command: "{{SANDBOX_READY_COMMAND}}" }],
  },
};

const copyToWorktree = JSON.parse("{{COPY_TO_WORKTREE}}") as string[];

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

const extractLastTagContent = (
  text: string,
  tag: string,
): string | undefined => {
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
};

function parseTaggedJsonOutput<T>(
  stdout: string,
  tag: string,
  label: string,
): T {
  const raw = extractLastTagContent(stdout, tag);
  if (!raw)
    throw new Error(`${label} output tag <${tag}> not found in agent stdout.`);
  return JSON.parse(raw.trim()) as T;
}

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
const worktreeName = branch.replace(/\//g, "-");
const worktreePath = join(
  process.cwd(),
  ".sandcastle",
  "worktrees",
  worktreeName,
);
const phaseTimings: PhaseTiming[] = [];

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

    const iterationBase = await gitOutput(["rev-parse", branch]);
    const retryFailures = retryTaskId
      ? (retryFailureCounts.get(retryTaskId) ?? 0)
      : 0;
    const implementModel: string =
      retryTaskId && retryFailures >= FULL_MODEL_RETRY_AFTER_REVIEW_FAILURES
        ? "claude-opus-4-6"
        : "claude-sonnet-4-6";

    const implement: sandcastle.SandboxRunResult =
      await timeAsync<sandcastle.SandboxRunResult>(
        phaseTimings,
        "implementer",
        () =>
          sandbox.run({
            name: "implementer",
            maxIterations: 1,
            completionSignal: QUEUE_DRAINED_SIGNAL,
            agent: sandcastle.claudeCode(implementModel),
            logging: { type: "stdout" },
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
    phaseTimings[phaseTimings.length - 1]!.tokens_expanded = expandedTokenCount(
      implement.stdout,
    );

    if (implement.completionSignal === QUEUE_DRAINED_SIGNAL) {
      queueDrained = true;
      break;
    }

    const implementResult = parseTaggedJsonOutput<ImplementResult>(
      implement.stdout,
      RESULT_TAG,
      "Implementer",
    );

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

    const review: sandcastle.SandboxRunResult =
      await timeAsync<sandcastle.SandboxRunResult>(
        phaseTimings,
        "reviewer",
        () =>
          sandbox.run({
            name: "reviewer",
            maxIterations: 1,
            completionSignal: COMPLETE_SIGNAL,
            agent: sandcastle.claudeCode("claude-opus-4-6"),
            logging: { type: "stdout" },
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: {
              PRD_ID: prdId,
              TASK_ID: implementResult.task_id ?? "",
              ITERATION_BASE: iterationBase,
              CAMPAIGN_BRANCH: branch,
              COVERAGE_ONLY_WARNING: coverageOnlyWarning,
              NO_NEW_COMMIT_WARNING: implement.commits.length
                ? ""
                : "Implementer returned implemented without a new commit. Accept only if existing branch commits already satisfy this task.",
            },
          }),
        {
          iteration,
          task_id: implementResult.task_id,
          model: "claude-opus-4-6",
        },
      );
    phaseTimings[phaseTimings.length - 1]!.tokens_expanded = expandedTokenCount(
      review.stdout,
    );

    const reviewResult = parseTaggedJsonOutput<ReviewResult>(
      review.stdout,
      REVIEW_TAG,
      "Reviewer",
    );
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
    const prdReview: sandcastle.SandboxRunResult =
      await timeAsync<sandcastle.SandboxRunResult>(
        phaseTimings,
        "prd_reviewer",
        () =>
          sandbox.run({
            name: "prd-reviewer",
            maxIterations: 1,
            completionSignal: COMPLETE_SIGNAL,
            agent: sandcastle.claudeCode("claude-opus-4-6"),
            logging: { type: "stdout" },
            promptFile: "./.sandcastle/prd-review-prompt.md",
            promptArgs: {
              PRD_ID: prdId,
              CAMPAIGN_BRANCH: branch,
            },
          }),
        { model: "claude-opus-4-6" },
      );
    phaseTimings[phaseTimings.length - 1]!.tokens_expanded = expandedTokenCount(
      prdReview.stdout,
    );
    handoff = parseTaggedJsonOutput<HandoffResult>(
      prdReview.stdout,
      HANDOFF_TAG,
      "PRD reviewer",
    );
  }

  const runTimestamp = new Date().toISOString().replace(/:/g, "-");
  const artifactDir = join(
    process.cwd(),
    ".sandcastle",
    "runs",
    `prd-${prdId}`,
  );
  const artifactPath = join(artifactDir, `${runTimestamp}.json`);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    artifactPath,
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );

  console.log(
    handoff ? "\nFinal PRD review complete." : "\nFinal PRD review skipped.",
  );
  console.log(`Handoff artifact: ${artifactPath}`);
  console.log(`Campaign worktree: ${wt.worktreePath}`);
  console.log(
    `Cleanup when done: git worktree remove --force ${wt.worktreePath}`,
  );
} finally {
  await sandbox.close();
}

console.log("\nAll done.");
