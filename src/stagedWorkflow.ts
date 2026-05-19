import { mkdir, symlink, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { AgentProvider, PromptArgs, SandboxHooks } from "./index.js";
import { createSandbox, run } from "./index.js";
import type { SandboxProvider } from "./SandboxProvider.js";

const execFile = promisify(execFileCallback);

export type StagedWorkflowExecutionMode = "parallel" | "sequential";
export type StagedWorkflowControlMode = "work-first" | "proof-first";
export type StagedWorkflowDecisionType =
  | "already_satisfied"
  | "proof_gap"
  | "code_gap"
  | "blocked";

export interface StagedWorkflowIssue {
  readonly id: string;
  readonly title: string;
  readonly branch: string;
}

export interface StagedWorkflowPlan {
  readonly issues: readonly StagedWorkflowIssue[];
}

export interface StagedWorkflowDecision {
  readonly type: StagedWorkflowDecisionType;
  readonly summary?: string;
  readonly proofGaps?: readonly string[];
  readonly codeGaps?: readonly string[];
}

export interface StagedWorkflowModels {
  readonly default: string;
  readonly planner?: string;
  readonly decider?: string;
  readonly implementer?: string;
  readonly synthesizer?: string;
  readonly reviewer?: string;
  readonly merger?: string;
  readonly auditor?: string;
}

export type StagedWorkflowAgentStage =
  | "planner"
  | "decider"
  | "implementer"
  | "synthesizer"
  | "reviewer"
  | "merger"
  | "auditor";

export interface StagedWorkflowStageFiles {
  readonly plan: string;
  readonly decide?: string;
  readonly implement: string;
  readonly synthesize?: string;
  readonly review: string;
  readonly merge: string;
  readonly audit?: string;
}

export interface StagedWorkflowCliOptions {
  readonly models: StagedWorkflowModels;
  readonly maxPasses?: number;
  readonly maxIssuesPerPass?: number;
  readonly execution?: StagedWorkflowExecutionMode;
  readonly controlMode?: StagedWorkflowControlMode;
  readonly synthesisAfterReviewPass?: number;
  readonly auditEnabled?: boolean;
  readonly preflightOnly?: boolean;
  readonly tmuxEnabled?: boolean;
  readonly tmuxSessionName?: string;
  readonly logFile?: string;
  readonly showHelp?: boolean;
  readonly passthroughArgs: readonly string[];
}

export interface StagedWorkflowRuntimePaths {
  readonly runId: string;
  readonly artifactRoot: string;
  readonly logsDir: string;
  readonly mainLogFile: string;
}

export type StagedWorkflowTmuxLayoutPreset = "generic" | "operator";
export type StagedWorkflowTmuxOptions = Readonly<Record<string, string>>;

export interface StagedWorkflowTmuxPane {
  readonly label: string;
  readonly filterTokens?: readonly string[];
  readonly shellCommand?: string;
}

export interface StagedWorkflowPreflightContext {
  readonly repoDir: string;
  readonly argv: readonly string[];
  readonly runId: string;
  readonly artifactRoot: string;
  readonly logsDir: string;
  readonly logFile: string;
  readonly models: StagedWorkflowModels;
  readonly maxPasses: number;
  readonly maxIssuesPerPass?: number;
  readonly synthesisAfterReviewPass?: number;
  readonly execution: StagedWorkflowExecutionMode;
  readonly controlMode: StagedWorkflowControlMode;
  readonly auditEnabled: boolean;
}

export type StagedWorkflowIssueMode =
  | "fresh"
  | "review_rework"
  | "merge_rework"
  | "audit_rework";

export interface StagedWorkflowPrepareIssueContext {
  readonly repoDir: string;
  readonly worktreePath: string;
  readonly runtimePaths: StagedWorkflowRuntimePaths;
  readonly pass: number;
  readonly issue: StagedWorkflowIssue;
  readonly mode: StagedWorkflowIssueMode;
  readonly reviewPass: number;
  readonly reviewFeedback?: string;
  readonly issueContractFile: string;
  readonly promptArgs: PromptArgs;
}

export interface StagedWorkflowPreparedIssue {
  readonly issueContractFile?: string;
  readonly promptArgs?: PromptArgs;
}

export interface StagedWorkflowOptions {
  readonly entryFile: string;
  readonly createAgent: (
    model: string,
    stage: StagedWorkflowAgentStage,
  ) => AgentProvider;
  readonly createSandboxProvider: () => SandboxProvider;
  readonly stageFiles: StagedWorkflowStageFiles;
  readonly models: StagedWorkflowModels;
  readonly hooks?: SandboxHooks;
  readonly copyToWorktree?: string[];
  readonly promptArgs?: PromptArgs;
  readonly maxPasses?: number;
  readonly maxIssuesPerPass?: number;
  readonly execution?: StagedWorkflowExecutionMode;
  readonly controlMode?: StagedWorkflowControlMode;
  readonly synthesisAfterReviewPass?: number;
  readonly auditEnabled?: boolean;
  readonly preflight?: (
    context: StagedWorkflowPreflightContext,
  ) => Promise<void> | void;
  readonly prepareIssue?: (
    context: StagedWorkflowPrepareIssueContext,
  ) =>
    | Promise<StagedWorkflowPreparedIssue | void>
    | StagedWorkflowPreparedIssue
    | void;
  readonly repoDir?: string;
  readonly logsDir?: string;
  readonly logFile?: string;
  readonly tmuxSessionName?: string;
  readonly tmuxLayoutPreset?: StagedWorkflowTmuxLayoutPreset;
  readonly tmuxPanes?: readonly StagedWorkflowTmuxPane[];
  readonly tmuxSessionOptions?: StagedWorkflowTmuxOptions;
  readonly tmuxWindowOptions?: StagedWorkflowTmuxOptions;
  readonly planTag?: string;
  readonly decisionTag?: string;
  readonly issueContractFile?: string;
}

export interface StagedWorkflowRunIssueResult {
  readonly issue: StagedWorkflowIssue;
  readonly decision: StagedWorkflowDecision;
  readonly commits: readonly { sha: string }[];
  readonly shouldAudit: boolean;
}

export interface StagedWorkflowRunResult {
  readonly processedIssues: readonly StagedWorkflowRunIssueResult[];
  readonly mergedIssues: readonly StagedWorkflowIssue[];
  readonly logFile?: string;
}

const DEFAULT_PLAN_TAG = "plan";
const DEFAULT_DECISION_TAG = "decision";
const TMUX_CHILD_ENV = "SANDCASTLE_TMUX_CHILD";

const HELP_TEXT = `Staged workflow flags:
  --model <name>               Default model for all stages
  --planner-model <name>       Override planner model
  --decider-model <name>       Override proof/code decision model
  --implementer-model <name>   Override implementer model
  --synthesizer-model <name>   Override cumulative review synthesis model
  --reviewer-model <name>      Override reviewer model
  --merger-model <name>        Override merger model
  --auditor-model <name>       Override auditor model
  --max-passes <n>             Override workflow loop count
  --max-issues-per-pass <n>    Limit issues executed in each pass
  --execution <sequential|parallel>
  --control-mode <work-first|proof-first>
  --synthesis-after-review-pass <n>
                              Run one cumulative synthesis fixer after this failed review pass
  --no-audit                   Disable audit stage
  --preflight-only             Run preflight hook, then exit
  --tmux                       Launch inside tmux
  --tmux-session-name <name>   tmux session name
  --log-file <path>            Log file path for tmux launch
  --help                       Show this help`;

const stageModel = (
  models: StagedWorkflowModels,
  stage: StagedWorkflowAgentStage,
): string => models[stage] ?? models.default;

const logStageModel = (
  stage: StagedWorkflowAgentStage,
  model: string,
  detail?: string,
): void => {
  const suffix = detail === undefined ? "" : ` ${detail}`;
  console.log(`[model] ${stage}: ${model}${suffix}`);
};

const shellEscape = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`;
const MAX_REVIEW_PASSES = 5;

const timestampForPath = (date: Date): string =>
  date.toISOString().replace(/[:.]/g, "-");

const slugForPath = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const findItemId = (argv: readonly string[]): string | undefined => {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === "--item-id") return argv[index + 1];
    if (arg.startsWith("--item-id=")) return arg.slice("--item-id=".length);
  }
  return argv.find((arg) => !arg.startsWith("-"));
};

export const makeStagedWorkflowRunId = (
  argv: readonly string[],
  now = new Date(),
): string => {
  const explicit = process.env.SANDCASTLE_RUN_ID?.trim();
  if (explicit) return explicit;
  const itemId = findItemId(argv);
  const base = slugForPath(itemId ?? "staged-workflow") || "staged-workflow";
  return `${base}-${timestampForPath(now)}`;
};

export const resolveStagedWorkflowRuntimePaths = (options: {
  readonly repoDir: string;
  readonly argv: readonly string[];
  readonly logFile?: string;
  readonly logsDir?: string;
  readonly now?: Date;
}): StagedWorkflowRuntimePaths => {
  const runId = makeStagedWorkflowRunId(options.argv, options.now);
  const artifactRoot = resolve(
    options.repoDir,
    process.env.SANDCASTLE_ARTIFACT_ROOT?.trim() ||
      join(".sandcastle", "runs", runId),
  );
  const logsDir = resolve(
    options.repoDir,
    options.logsDir ?? join(artifactRoot, "logs"),
  );
  const mainLogFile = resolve(
    options.repoDir,
    options.logFile ?? join(artifactRoot, "main.out"),
  );
  return { runId, artifactRoot, logsDir, mainLogFile };
};

const extractLastTag = (stdout: string, tag: string): string => {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g");
  const matches = [...stdout.matchAll(regex)];
  const raw = matches.at(-1)?.[1];
  if (!raw) {
    throw new Error(`Expected <${tag}>...</${tag}> in agent output.`);
  }
  return raw.trim();
};

const parseTaggedJson = <T>(stdout: string, tag: string): T =>
  JSON.parse(extractLastTag(stdout, tag)) as T;

const ensureReviewResult = (
  stdout: string,
): {
  status: "approve" | "changes_required";
  summary: string;
  findings: Array<{
    title?: string;
    details?: string;
    code_refs?: string[];
  }>;
} => {
  const parsed = parseTaggedJson<{
    status?: unknown;
    summary?: unknown;
    findings?: unknown;
    matrix?: unknown;
  }>(stdout, "review_result");
  if (parsed.status !== "approve" && parsed.status !== "changes_required") {
    throw new Error(
      `Unknown review status "${String(parsed.status)}". Expected "approve" or "changes_required".`,
    );
  }
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings
    : Array.isArray(parsed.matrix)
      ? parsed.matrix
          .filter(
            (
              row,
            ): row is {
              id?: unknown;
              status?: unknown;
              notes?: unknown;
              code_refs?: unknown;
            } =>
              typeof row === "object" && row !== null && row.status !== "pass",
          )
          .map((row) => ({
            title: typeof row.id === "string" ? row.id : "Review finding",
            details: typeof row.notes === "string" ? row.notes : "",
            code_refs: Array.isArray(row.code_refs)
              ? row.code_refs.filter(
                  (entry): entry is string => typeof entry === "string",
                )
              : [],
          }))
      : [];
  return {
    status: parsed.status,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    findings,
  };
};

type StagedWorkflowReviewResult = ReturnType<typeof ensureReviewResult>;

const formatReviewFeedback = (
  reviewPass: number,
  reviewResult: StagedWorkflowReviewResult,
): string =>
  [
    `Review pass ${reviewPass} requires changes.`,
    reviewResult.summary ? `Summary: ${reviewResult.summary}` : "",
    ...reviewResult.findings.map((finding, index) => {
      const details =
        typeof finding?.details === "string" ? finding.details : "";
      const refs =
        Array.isArray(finding?.code_refs) && finding.code_refs.length > 0
          ? ` [${finding.code_refs.join(", ")}]`
          : "";
      return `Finding ${index + 1}: ${String(finding?.title ?? "Untitled finding")}${refs}${details ? ` - ${details}` : ""}`;
    }),
  ]
    .filter(Boolean)
    .join("\n");

const ensureDecision = (
  stdout: string,
  tag: string,
): StagedWorkflowDecision => {
  const parsed = parseTaggedJson<StagedWorkflowDecision>(stdout, tag);
  const validTypes: readonly StagedWorkflowDecisionType[] = [
    "already_satisfied",
    "proof_gap",
    "code_gap",
    "blocked",
  ];
  if (!validTypes.includes(parsed.type)) {
    throw new Error(
      `Unknown decision type "${String(parsed.type)}". Expected one of: ${validTypes.join(", ")}`,
    );
  }
  return parsed;
};

const formatIssueList = (issues: readonly StagedWorkflowIssue[]): string =>
  issues.map((issue) => `- ${issue.id}: ${issue.title}`).join("\n");

const formatBranchList = (issues: readonly StagedWorkflowIssue[]): string =>
  issues.map((issue) => `- ${issue.branch}`).join("\n");

const withLogSymlink = async (logFile: string): Promise<void> => {
  const latestPath = join(dirname(logFile), "staged-workflow.latest.log");
  await mkdir(dirname(logFile), { recursive: true });
  try {
    await unlink(latestPath);
  } catch {}
  try {
    await symlink(basename(logFile), latestPath);
  } catch {}
};

const stagedLogPath = (
  repoDir: string,
  name: string,
  logsDir?: string,
): string =>
  join(
    logsDir ??
      resolveStagedWorkflowRuntimePaths({
        repoDir,
        argv: process.argv.slice(2),
      }).logsDir,
    name,
  );

const buildLogWatcherShell = (
  logsDir: string,
  label: string,
  filterTokens: readonly string[],
): string => {
  const filterArg = filterTokens.join(",");
  return `/bin/bash -lc ${shellEscape(
    `filter_tokens=${shellEscape(filterArg)}; label=${shellEscape(label)}; logs_dir=${shellEscape(logsDir)}; mkdir -p "$logs_dir"; current_file=""; tail_pid=""; if [[ -t 1 ]]; then c_reset=$'\\033[0m'; c_title=$'\\033[1;36m'; c_key=$'\\033[0;33m'; c_dim=$'\\033[0;90m'; else c_reset=""; c_title=""; c_key=""; c_dim=""; fi; cleanup() { if [[ -n "$tail_pid" ]] && kill -0 "$tail_pid" 2>/dev/null; then kill "$tail_pid" 2>/dev/null || true; wait "$tail_pid" 2>/dev/null || true; fi; }; trap cleanup EXIT INT TERM; render_header() { local current_name="$1"; clear; printf '%s== %s ==%s\\n' "$c_title" "$label" "$c_reset"; printf '%sfile%s: %s\\n' "$c_key" "$c_reset" "$current_name"; printf '%sdir %s: %s\\n' "$c_key" "$c_reset" "$logs_dir"; printf '%s%s%s\\n\\n' "$c_dim" '------------------------------------------------------------' "$c_reset"; }; render_header waiting; matches_filter() { local file_name="$1"; local token=""; if [[ -z "$filter_tokens" ]]; then return 0; fi; IFS=',' read -r -a tokens <<< "$filter_tokens"; for token in "\${tokens[@]}"; do [[ -n "$token" ]] || continue; if [[ "$file_name" == *"$token"* ]]; then return 0; fi; done; return 1; }; latest_log_file() { local candidate=""; local candidate_mtime=""; local file=""; local mtime=""; local base_name=""; shopt -s nullglob; for file in "$logs_dir"/*.log; do [[ -f "$file" ]] || continue; base_name="$(basename "$file")"; matches_filter "$base_name" || continue; mtime="$(stat -c '%Y' "$file" 2>/dev/null || true)"; [[ -n "$mtime" ]] || continue; if [[ -z "$candidate_mtime" || "$mtime" -gt "$candidate_mtime" ]]; then candidate="$file"; candidate_mtime="$mtime"; fi; done; shopt -u nullglob; printf '%s\\n' "$candidate"; }; while true; do latest_file="$(latest_log_file)"; if [[ -n "$latest_file" && "$latest_file" != "$current_file" ]]; then cleanup; current_file="$latest_file"; render_header "$(basename "$current_file")"; tail -n 40 -F "$current_file" & tail_pid="$!"; fi; sleep 1; done`,
  )}`;
};

export const getStagedWorkflowTmuxPanes = (
  repoDir: string,
  sessionName: string,
  logFile: string,
  preset: StagedWorkflowTmuxLayoutPreset = "generic",
  tmuxPanes?: readonly StagedWorkflowTmuxPane[],
  logsDir = join(repoDir, ".sandcastle", "logs"),
): readonly StagedWorkflowTmuxPane[] => {
  if (tmuxPanes && tmuxPanes.length > 0) {
    return tmuxPanes;
  }

  if (preset === "operator") {
    return [
      {
        label: "plan/merge logs",
        shellCommand: buildLogWatcherShell(logsDir, "plan/merge logs", [
          "planner",
          "merger",
        ]),
      },
      {
        label: "review/audit logs",
        shellCommand: buildLogWatcherShell(logsDir, "review/audit logs", [
          "reviewer",
          "auditor",
          "repo-audit",
        ]),
      },
      {
        label: "implementer logs",
        shellCommand: buildLogWatcherShell(logsDir, "implementer logs", [
          "implementer",
        ]),
      },
    ];
  }

  return [
    {
      label: "latest logs",
      shellCommand: `/bin/bash -lc ${shellEscape(
        `tail -n 200 -f ${shellEscape(logFile)}`,
      )}`,
    },
    {
      label: "status",
      shellCommand: `/bin/bash -lc ${shellEscape(
        `while true; do clear; echo "[status] $(date -Is)"; echo "repo: $(pwd)"; echo "branch: $(git branch --show-current 2>/dev/null || true)"; echo; git status --short 2>/dev/null || true; echo; echo "log: ${logFile}"; echo "attach: tmux attach -t ${sessionName}"; sleep 2; done`,
      )}`,
    },
    {
      label: "sandcastle files",
      shellCommand: `/bin/bash -lc ${shellEscape(
        `while true; do clear; echo "[sandcastle files] $(date -Is)"; echo; files=$(find .sandcastle -maxdepth 3 -type f 2>/dev/null); if [ -z "$files" ]; then echo "No .sandcastle files yet."; else printf '%s\n' "$files" | xargs ls -lt 2>/dev/null | head -n 20; fi; sleep 2; done`,
      )}`,
    },
  ];
};

const maybeLaunchInTmux = async (
  entryFile: string,
  repoDir: string,
  cliOptions: StagedWorkflowCliOptions,
  runtimePaths: StagedWorkflowRuntimePaths,
  workflowOptions: Pick<
    StagedWorkflowOptions,
    | "tmuxLayoutPreset"
    | "tmuxPanes"
    | "tmuxSessionOptions"
    | "tmuxWindowOptions"
  >,
): Promise<string | undefined> => {
  if (!cliOptions.tmuxEnabled || process.env[TMUX_CHILD_ENV] === "1") {
    return undefined;
  }

  const logFile = runtimePaths.mainLogFile;
  await mkdir(runtimePaths.logsDir, { recursive: true });
  await withLogSymlink(logFile);

  const sessionName =
    cliOptions.tmuxSessionName ?? `sandcastle-${basename(repoDir)}`;

  const childArgs = cliOptions.passthroughArgs.filter(
    (arg) => arg !== "--tmux" && arg !== "--help",
  );
  const command = [
    "env",
    `${TMUX_CHILD_ENV}=1`,
    `SANDCASTLE_RUN_ID=${shellEscape(runtimePaths.runId)}`,
    `SANDCASTLE_ARTIFACT_ROOT=${shellEscape(runtimePaths.artifactRoot)}`,
    "node",
    "--import",
    "tsx",
    shellEscape(entryFile),
    ...childArgs.map(shellEscape),
  ].join(" ");

  const workflowShell = `/bin/bash -lc ${shellEscape(
    `${command} 2>&1 | tee ${shellEscape(logFile)}`,
  )}`;
  const watcherPanes = getStagedWorkflowTmuxPanes(
    repoDir,
    sessionName,
    logFile,
    workflowOptions.tmuxLayoutPreset,
    workflowOptions.tmuxPanes,
    runtimePaths.logsDir,
  );

  const { stdout: workflowPaneRaw } = await execFile("tmux", [
    "new-session",
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    "-s",
    sessionName,
    "-n",
    "workflow",
    workflowShell,
  ]);
  const workflowPaneId = workflowPaneRaw.trim();

  const sessionOptions = {
    "remain-on-exit": "on",
    ...workflowOptions.tmuxSessionOptions,
  };
  for (const [key, value] of Object.entries(sessionOptions)) {
    await execFile("tmux", ["set-option", "-t", sessionName, key, value]);
  }
  for (const [key, value] of Object.entries(
    workflowOptions.tmuxWindowOptions ?? {},
  )) {
    await execFile("tmux", [
      "set-window-option",
      "-t",
      `${sessionName}:workflow`,
      key,
      value,
    ]);
  }

  let splitTargetPaneId = workflowPaneId;
  let firstSplit = true;
  for (const pane of watcherPanes) {
    const { stdout: paneIdRaw } = await execFile("tmux", [
      "split-window",
      firstSplit ? "-h" : "-v",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      splitTargetPaneId,
      pane.shellCommand ??
        buildLogWatcherShell(
          runtimePaths.logsDir,
          pane.label,
          pane.filterTokens ?? [],
        ),
    ]);
    splitTargetPaneId = paneIdRaw.trim();
    await execFile("tmux", [
      "select-pane",
      "-t",
      splitTargetPaneId,
      "-T",
      pane.label,
    ]);
    firstSplit = false;
  }
  await execFile("tmux", ["select-pane", "-t", workflowPaneId, "-T", "main"]);
  await execFile("tmux", [
    "select-layout",
    "-t",
    `${sessionName}:workflow`,
    "tiled",
  ]);

  console.log(`tmux session: ${sessionName}`);
  console.log(`run id: ${runtimePaths.runId}`);
  console.log(`artifact root: ${runtimePaths.artifactRoot}`);
  console.log(`log file: ${logFile}`);
  console.log(`attach: tmux attach -t ${sessionName}`);
  return logFile;
};

export const parseStagedWorkflowCliArgs = (
  argv: readonly string[],
  defaults: StagedWorkflowModels,
): StagedWorkflowCliOptions => {
  const models: {
    default: string;
    planner?: string;
    decider?: string;
    implementer?: string;
    synthesizer?: string;
    reviewer?: string;
    merger?: string;
    auditor?: string;
  } = { ...defaults };
  let maxPasses: number | undefined;
  let maxIssuesPerPass: number | undefined;
  let synthesisAfterReviewPass: number | undefined;
  let execution: StagedWorkflowExecutionMode | undefined;
  let controlMode: StagedWorkflowControlMode | undefined;
  let auditEnabled: boolean | undefined;
  let preflightOnly = false;
  let tmuxEnabled = false;
  let tmuxSessionName: string | undefined;
  let logFile: string | undefined;
  let showHelp = false;

  const readValue = (index: number, flag: string): string => {
    const value = argv[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--model":
        models.default = readValue(index, arg);
        index++;
        break;
      case "--planner-model":
        models.planner = readValue(index, arg);
        index++;
        break;
      case "--decider-model":
        models.decider = readValue(index, arg);
        index++;
        break;
      case "--implementer-model":
        models.implementer = readValue(index, arg);
        index++;
        break;
      case "--synthesizer-model":
        models.synthesizer = readValue(index, arg);
        index++;
        break;
      case "--reviewer-model":
        models.reviewer = readValue(index, arg);
        index++;
        break;
      case "--merger-model":
        models.merger = readValue(index, arg);
        index++;
        break;
      case "--auditor-model":
        models.auditor = readValue(index, arg);
        index++;
        break;
      case "--max-passes":
        maxPasses = Number.parseInt(readValue(index, arg), 10);
        index++;
        break;
      case "--max-issues-per-pass":
        maxIssuesPerPass = Number.parseInt(readValue(index, arg), 10);
        index++;
        break;
      case "--synthesis-after-review-pass":
        synthesisAfterReviewPass = Number.parseInt(readValue(index, arg), 10);
        index++;
        break;
      case "--execution": {
        const value = readValue(index, arg);
        if (value !== "parallel" && value !== "sequential") {
          throw new Error(`Invalid execution mode "${value}"`);
        }
        execution = value;
        index++;
        break;
      }
      case "--control-mode": {
        const value = readValue(index, arg);
        if (value !== "work-first" && value !== "proof-first") {
          throw new Error(`Invalid control mode "${value}"`);
        }
        controlMode = value;
        index++;
        break;
      }
      case "--no-audit":
        auditEnabled = false;
        break;
      case "--preflight-only":
        preflightOnly = true;
        break;
      case "--tmux":
        tmuxEnabled = true;
        break;
      case "--tmux-session-name":
        tmuxSessionName = readValue(index, arg);
        index++;
        break;
      case "--log-file":
        logFile = readValue(index, arg);
        index++;
        break;
      case "--help":
        showHelp = true;
        break;
    }
  }

  if (
    maxPasses !== undefined &&
    (!Number.isFinite(maxPasses) || maxPasses < 1)
  ) {
    throw new Error(`Invalid --max-passes value "${String(maxPasses)}"`);
  }
  if (
    maxIssuesPerPass !== undefined &&
    (!Number.isFinite(maxIssuesPerPass) || maxIssuesPerPass < 1)
  ) {
    throw new Error(
      `Invalid --max-issues-per-pass value "${String(maxIssuesPerPass)}"`,
    );
  }
  if (
    synthesisAfterReviewPass !== undefined &&
    (!Number.isFinite(synthesisAfterReviewPass) ||
      synthesisAfterReviewPass < 1 ||
      synthesisAfterReviewPass > MAX_REVIEW_PASSES)
  ) {
    throw new Error(
      `Invalid --synthesis-after-review-pass value "${String(synthesisAfterReviewPass)}"`,
    );
  }

  return {
    models,
    maxPasses,
    maxIssuesPerPass,
    synthesisAfterReviewPass,
    execution,
    controlMode,
    auditEnabled,
    preflightOnly,
    tmuxEnabled,
    tmuxSessionName,
    logFile,
    showHelp,
    passthroughArgs: argv,
  };
};

const runPlanner = async (
  options: StagedWorkflowOptions,
  models: StagedWorkflowModels,
  pass: number,
): Promise<StagedWorkflowPlan> => {
  const model = stageModel(models, "planner");
  logStageModel("planner", model, `(pass ${pass})`);
  const result = await run({
    sandbox: options.createSandboxProvider(),
    hooks: options.hooks,
    cwd: options.repoDir,
    name: "planner",
    model,
    maxIterations: 1,
    agent: options.createAgent(model, "planner"),
    promptFile: options.stageFiles.plan,
    promptArgs: options.promptArgs,
    logging: {
      type: "file",
      path: stagedLogPath(
        options.repoDir ?? process.cwd(),
        `iteration-${String(pass).padStart(2, "0")}-planner.log`,
        options.logsDir,
      ),
    },
  });

  return parseTaggedJson<StagedWorkflowPlan>(
    result.stdout,
    options.planTag ?? DEFAULT_PLAN_TAG,
  );
};

const runIssuePipeline = async (
  workflow: StagedWorkflowOptions,
  runtimePaths: StagedWorkflowRuntimePaths,
  models: StagedWorkflowModels,
  issue: StagedWorkflowIssue,
  controlMode: StagedWorkflowControlMode,
  synthesisAfterReviewPass: number | undefined,
  pass: number,
): Promise<StagedWorkflowRunIssueResult> => {
  const sandbox = await createSandbox({
    branch: issue.branch,
    sandbox: workflow.createSandboxProvider(),
    cwd: workflow.repoDir,
    hooks: workflow.hooks,
    copyToWorktree: workflow.copyToWorktree,
  });

  try {
    const promptArgs: PromptArgs = {
      ...workflow.promptArgs,
      TASK_ID: issue.id,
      ISSUE_TITLE: issue.title,
      BRANCH: issue.branch,
    };
    const defaultIssueContractFile =
      workflow.issueContractFile ?? "./.sandcastle/issue-contract.md";

    const decision: StagedWorkflowDecision =
      controlMode === "proof-first"
        ? ensureDecision(
            (
              await (() => {
                const model = stageModel(models, "decider");
                logStageModel("decider", model, `(issue ${issue.id})`);
                return sandbox.run({
                  name: `decider:${issue.id}`,
                  model,
                  maxIterations: 1,
                  agent: workflow.createAgent(model, "decider"),
                  promptFile:
                    workflow.stageFiles.decide ??
                    (() => {
                      throw new Error(
                        "proof-first control mode requires a decide prompt file.",
                      );
                    })(),
                  promptArgs,
                  logging: {
                    type: "file",
                    path: stagedLogPath(
                      workflow.repoDir ?? process.cwd(),
                      `iteration-${String(pass).padStart(2, "0")}-issue-${issue.id}-decider.log`,
                      workflow.logsDir,
                    ),
                  },
                });
              })()
            ).stdout,
            workflow.decisionTag ?? DEFAULT_DECISION_TAG,
          )
        : {
            type: "code_gap",
            summary: "work-first control mode skips the decision gate",
          };

    const commits: { sha: string }[] = [];

    if (decision.type === "code_gap" || decision.type === "proof_gap") {
      let reviewFeedback = "";
      const reviewHistory: string[] = [];
      let synthesisUsed = false;
      for (let reviewPass = 1; reviewPass <= MAX_REVIEW_PASSES; reviewPass++) {
        const issueMode: StagedWorkflowIssueMode =
          reviewPass === 1 ? "fresh" : "review_rework";
        const preparedIssue = await workflow.prepareIssue?.({
          repoDir: workflow.repoDir ?? process.cwd(),
          worktreePath: sandbox.worktreePath,
          runtimePaths,
          pass,
          issue,
          mode: issueMode,
          reviewPass,
          reviewFeedback: reviewFeedback || undefined,
          issueContractFile: defaultIssueContractFile,
          promptArgs,
        });
        const effectiveIssueContractFile =
          preparedIssue?.issueContractFile ?? defaultIssueContractFile;
        const effectivePromptArgs: PromptArgs = {
          ...promptArgs,
          ...preparedIssue?.promptArgs,
          ISSUE_CONTRACT_FILE: effectiveIssueContractFile,
        };
        const useSynthesis =
          synthesisAfterReviewPass !== undefined &&
          reviewPass > synthesisAfterReviewPass &&
          !synthesisUsed &&
          workflow.stageFiles.synthesize !== undefined;
        const implementStage = useSynthesis ? "synthesizer" : "implementer";
        const implementModel = stageModel(models, implementStage);
        logStageModel(
          implementStage,
          implementModel,
          `(issue ${issue.id}, review pass ${reviewPass})`,
        );
        const implement = await sandbox.run({
          name: `implementer:${issue.id}`,
          model: implementModel,
          maxIterations: 100,
          agent: workflow.createAgent(implementModel, implementStage),
          promptFile: useSynthesis
            ? workflow.stageFiles.synthesize!
            : reviewPass === 1
              ? workflow.stageFiles.implement
              : workflow.stageFiles.implement.replace(
                  "implement-prompt.md",
                  "implement-rework-prompt.md",
                ),
          promptArgs: {
            ...effectivePromptArgs,
            ISSUE_ID: issue.id,
            REVIEW_FEEDBACK: reviewFeedback,
            REVIEW_HISTORY: reviewHistory.join("\n\n---\n\n"),
            REVIEW_PASS: String(reviewPass),
            SYNTHESIS_TRIGGER_PASS: String(synthesisAfterReviewPass ?? ""),
          },
          logging: {
            type: "file",
            path: stagedLogPath(
              workflow.repoDir ?? process.cwd(),
              `iteration-${String(pass).padStart(2, "0")}-issue-${issue.id}-implementer-pass-${String(reviewPass).padStart(2, "0")}.log`,
              workflow.logsDir,
            ),
          },
        });
        commits.push(...implement.commits);
        if (useSynthesis) {
          synthesisUsed = true;
        }

        const reviewerModel = stageModel(models, "reviewer");
        logStageModel(
          "reviewer",
          reviewerModel,
          `(issue ${issue.id}, pass ${reviewPass})`,
        );
        const review = await sandbox.run({
          name: `reviewer:${issue.id}`,
          model: reviewerModel,
          maxIterations: 1,
          agent: workflow.createAgent(reviewerModel, "reviewer"),
          promptFile: workflow.stageFiles.review,
          promptArgs: {
            ...effectivePromptArgs,
            ISSUE_ID: issue.id,
            REVIEW_FEEDBACK: reviewFeedback,
          },
          logging: {
            type: "file",
            path: stagedLogPath(
              workflow.repoDir ?? process.cwd(),
              `iteration-${String(pass).padStart(2, "0")}-issue-${issue.id}-reviewer-pass-${String(reviewPass).padStart(2, "0")}.log`,
              workflow.logsDir,
            ),
          },
        });
        if (review.commits.length > 0) {
          throw new Error(
            `Reviewer must not commit code for issue ${issue.id}.`,
          );
        }
        const reviewResult = ensureReviewResult(review.stdout);
        if (reviewResult.status === "approve") {
          break;
        }
        const formattedFeedback = formatReviewFeedback(
          reviewPass,
          reviewResult,
        );
        reviewHistory.push(formattedFeedback);
        if (
          synthesisAfterReviewPass !== undefined &&
          reviewPass >= synthesisAfterReviewPass &&
          !synthesisUsed &&
          workflow.stageFiles.synthesize !== undefined
        ) {
          reviewFeedback = [
            `Escalating after review pass ${reviewPass}.`,
            "Use cumulative review history first; do not restart from the issue body.",
            "",
            reviewHistory.join("\n\n---\n\n"),
          ].join("\n");
          continue;
        }
        if (reviewPass === MAX_REVIEW_PASSES) {
          throw new Error(
            `Reviewer still requires changes for issue ${issue.id} after ${MAX_REVIEW_PASSES} passes.`,
          );
        }
        reviewFeedback = formattedFeedback;
      }
    }

    return {
      issue,
      decision,
      commits,
      shouldAudit: decision.type !== "blocked",
    };
  } finally {
    await sandbox.close();
  }
};

const runMerge = async (
  workflow: StagedWorkflowOptions,
  models: StagedWorkflowModels,
  mergedIssues: readonly StagedWorkflowIssue[],
  pass: number,
): Promise<void> => {
  if (mergedIssues.length === 0) return;
  const model = stageModel(models, "merger");
  logStageModel("merger", model, `(pass ${pass})`);
  await run({
    sandbox: workflow.createSandboxProvider(),
    hooks: workflow.hooks,
    cwd: workflow.repoDir,
    name: "merger",
    model,
    maxIterations: 1,
    agent: workflow.createAgent(model, "merger"),
    promptFile: workflow.stageFiles.merge,
    promptArgs: {
      ...workflow.promptArgs,
      BRANCHES: formatBranchList(mergedIssues),
      ISSUES: formatIssueList(mergedIssues),
    },
    logging: {
      type: "file",
      path: stagedLogPath(
        workflow.repoDir ?? process.cwd(),
        `iteration-${String(pass).padStart(2, "0")}-merger.log`,
        workflow.logsDir,
      ),
    },
  });
};

const runAudit = async (
  workflow: StagedWorkflowOptions,
  models: StagedWorkflowModels,
  issues: readonly StagedWorkflowRunIssueResult[],
  pass: number,
): Promise<void> => {
  if (!workflow.stageFiles.audit || issues.length === 0) return;
  const model = stageModel(models, "auditor");
  logStageModel("auditor", model, `(pass ${pass})`);
  await run({
    sandbox: workflow.createSandboxProvider(),
    hooks: workflow.hooks,
    cwd: workflow.repoDir,
    name: "auditor",
    model,
    maxIterations: 1,
    agent: workflow.createAgent(model, "auditor"),
    promptFile: workflow.stageFiles.audit,
    promptArgs: {
      ...workflow.promptArgs,
      ISSUES: formatIssueList(issues.map((entry) => entry.issue)),
      MERGED_BRANCHES: formatBranchList(
        issues
          .filter((entry) => entry.commits.length > 0)
          .map((entry) => entry.issue),
      ),
      ISSUE_CONTRACT_FILE:
        workflow.issueContractFile ?? "./.sandcastle/issue-contract.md",
    },
    logging: {
      type: "file",
      path: stagedLogPath(
        workflow.repoDir ?? process.cwd(),
        `iteration-${String(pass).padStart(2, "0")}-auditor.log`,
        workflow.logsDir,
      ),
    },
  });
};

export const runStagedWorkflow = async (
  options: StagedWorkflowOptions,
  argv: readonly string[] = process.argv.slice(2),
): Promise<StagedWorkflowRunResult | undefined> => {
  const parsed = parseStagedWorkflowCliArgs(argv, options.models);
  if (parsed.showHelp) {
    console.log(HELP_TEXT);
    return undefined;
  }

  const repoDir = resolve(options.repoDir ?? process.cwd());
  const models = parsed.models;
  const maxPasses = parsed.maxPasses ?? options.maxPasses ?? 10;
  const maxIssuesPerPass = parsed.maxIssuesPerPass ?? options.maxIssuesPerPass;
  const synthesisAfterReviewPass =
    parsed.synthesisAfterReviewPass ?? options.synthesisAfterReviewPass;
  const execution = parsed.execution ?? options.execution ?? "sequential";
  const controlMode = parsed.controlMode ?? options.controlMode ?? "work-first";
  const auditEnabled = parsed.auditEnabled ?? options.auditEnabled ?? true;
  const runtimePaths = resolveStagedWorkflowRuntimePaths({
    repoDir,
    argv,
    logFile: parsed.logFile ?? options.logFile,
    logsDir: options.logsDir,
  });
  const runtimeOptions: StagedWorkflowOptions = {
    ...options,
    repoDir,
    logsDir: runtimePaths.logsDir,
    logFile: runtimePaths.mainLogFile,
  };

  if (options.preflight) {
    await options.preflight({
      repoDir,
      argv,
      runId: runtimePaths.runId,
      artifactRoot: runtimePaths.artifactRoot,
      logsDir: runtimePaths.logsDir,
      logFile: runtimePaths.mainLogFile,
      models,
      maxPasses,
      maxIssuesPerPass,
      synthesisAfterReviewPass,
      execution,
      controlMode,
      auditEnabled,
    });
  }
  if (parsed.preflightOnly) {
    return { processedIssues: [], mergedIssues: [], logFile: parsed.logFile };
  }

  const logFile = await maybeLaunchInTmux(
    options.entryFile,
    repoDir,
    parsed,
    runtimePaths,
    {
      tmuxLayoutPreset: options.tmuxLayoutPreset,
      tmuxPanes: options.tmuxPanes,
      tmuxSessionOptions: options.tmuxSessionOptions,
      tmuxWindowOptions: options.tmuxWindowOptions,
    },
  );
  if (logFile) {
    return { processedIssues: [], mergedIssues: [], logFile };
  }

  const processedIssues: StagedWorkflowRunIssueResult[] = [];
  const mergedIssues: StagedWorkflowIssue[] = [];

  for (let pass = 1; pass <= maxPasses; pass++) {
    console.log(`\n=== Pass ${pass}/${maxPasses} ===\n`);
    const plan = await runPlanner(runtimeOptions, models, pass);
    if (!plan.issues.length) {
      console.log("No issues returned by planner. Exiting.");
      break;
    }

    const passIssues =
      maxIssuesPerPass === undefined
        ? [...plan.issues]
        : plan.issues.slice(0, maxIssuesPerPass);
    const deferredCount = plan.issues.length - passIssues.length;
    if (deferredCount > 0) {
      console.log(
        `[planner] deferring ${deferredCount} issue(s); executing ${passIssues.length} this pass.`,
      );
    }

    const executeIssue = (issue: StagedWorkflowIssue) =>
      runIssuePipeline(
        runtimeOptions,
        runtimePaths,
        models,
        issue,
        controlMode,
        synthesisAfterReviewPass,
        pass,
      );

    const passResults =
      execution === "parallel"
        ? await Promise.all(passIssues.map(executeIssue))
        : await passIssues.reduce<Promise<StagedWorkflowRunIssueResult[]>>(
            async (promise, issue) => {
              const results = await promise;
              results.push(await executeIssue(issue));
              return results;
            },
            Promise.resolve([]),
          );

    processedIssues.push(...passResults);

    const mergeable = passResults
      .filter((entry) => entry.commits.length > 0)
      .map((entry) => entry.issue);

    if (mergeable.length === 0 && !auditEnabled) {
      console.log("No mergeable work and audit disabled. Exiting.");
      break;
    }

    await runMerge(runtimeOptions, models, mergeable, pass);
    mergedIssues.push(...mergeable);

    if (auditEnabled) {
      await runAudit(
        runtimeOptions,
        models,
        passResults.filter((entry) => entry.shouldAudit),
        pass,
      );
    }
  }

  return {
    processedIssues,
    mergedIssues,
    logFile: parsed.logFile ?? options.logFile,
  };
};
