// -nocheck
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PlannedIssue = {
  iid: string;
  title: string;
  branch: string;
};

export type IssueReworkPacket = {
  classification: "issue_rework";
  source?: "merger" | "repo_audit";
  issue_id?: string;
  branch?: string;
  reason?: string;
  summary?: string;
  audit_comment_markdown?: string;
  failing_commands?: string[];
  failing_tests?: string[];
  touched_files?: string[];
  status_delta?: string[];
  ci_excerpt?: string[];
};

export type RepoBlockerPacket = {
  classification: "repo_blocker";
  reason?: string;
  summary?: string;
  status_delta?: string[];
  baseline_status?: string[];
  current_status?: string[];
  ci_excerpt?: string[];
};

export type MergedIssuePacket = {
  issue_id?: string;
  branch?: string;
};

export type MergeResult = {
  status: "complete" | "issue_rework" | "repo_blocker";
  summary?: string;
  merged_issues?: MergedIssuePacket[];
  rework_issues?: IssueReworkPacket[];
  repo_blocker?: RepoBlockerPacket;
};

type DeferredIssue = {
  issueId: string;
  branch: string;
  summary?: string;
  feedback: string;
  packet: IssueReworkPacket;
};

export type RepoAuditReworkInput = {
  issue_id: string;
  branch: string;
  summary?: string;
  comment_markdown: string;
};

type ParkedIssue = {
  issue_id: string;
  title?: string;
  branch?: string;
  reason: string;
};

type RunStateSnapshot = {
  run_id: string;
  artifact_root: string;
  log_root: string;
  state_path: string;
  target_branch: string;
  target_head_sha: string;
  startup_status: string[];
  created_worktrees: string[];
  created_issue_branches: string[];
  pending_issue_rework: IssueReworkPacket[];
  parked_issues: ParkedIssue[];
  phase: string;
  last_merge_summary?: string;
};

export type AppliedMergeResult =
  | { kind: "complete" }
  | { kind: "issue_rework"; issues: DeferredIssue[] }
  | { kind: "repo_blocker"; blocker: RepoBlockerPacket };

export const makeRunId = (parentItemId: string): string => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${parentItemId}-${stamp}`;
};

export const normalizeStatusLines = (status: string): string[] =>
  status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

export const statusCode = (line: string): string => line.slice(0, 2);

export const statusPath = (line: string): string => line.slice(3).trim();

export const isUnmergedStatus = (line: string): boolean => {
  const code = statusCode(line);
  return (
    code.includes("U") ||
    code === "AA" ||
    code === "DD"
  );
};

export const isAllowedStartupPath = (
  line: string,
  allowedRoots: string[] = [".sandcastle"],
): boolean => {
  const path = statusPath(line);
  return allowedRoots.some((root) => path === root || path.startsWith(`${root}/`));
};

export const findUnsafeStartupStatus = (
  lines: string[],
  allowedRoots: string[] = [".sandcastle"],
): string[] =>
  lines.filter((line) => isUnmergedStatus(line) || !isAllowedStartupPath(line, allowedRoots));

const countLines = (lines: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
};

export const diffStatusLines = (
  baseline: string[],
  current: string[],
): string[] => {
  const counts = countLines(baseline);
  const delta: string[] = [];

  for (const line of current) {
    const remaining = counts.get(line) ?? 0;
    if (remaining > 0) {
      counts.set(line, remaining - 1);
      continue;
    }
    delta.push(line);
  }

  return delta;
};

export const statusDeltaExplainedByBaseline = (
  statusDelta: string[],
  baseline: string[],
): boolean => diffStatusLines(baseline, statusDelta).length === 0;

export const buildIssueReworkFeedback = (
  packet: IssueReworkPacket,
  fallbackSummary?: string,
): string => {
  const auditComment = packet.audit_comment_markdown?.trim();
  const auditSection = auditComment
    ? auditComment.toLowerCase().startsWith("repo-audit findings")
      ? auditComment
      : `Repo-audit findings:\n${auditComment}`
    : "";
  return [
    packet.source === "repo_audit"
      ? "Rework pass: repo-audit follow-up"
      : "Rework pass: merger follow-up",
    packet.source === "repo_audit"
      ? "Priority: address repo-audit findings only unless blocked."
      : "Priority: address merger findings only unless blocked.",
    packet.issue_id ? `Issue: ${packet.issue_id}` : "",
    packet.branch ? `Branch: ${packet.branch}` : "",
    packet.summary?.trim()
      ? `Summary: ${packet.summary.trim()}`
      : fallbackSummary?.trim()
        ? `Summary: ${fallbackSummary.trim()}`
        : "",
    packet.source === "repo_audit"
      ? "Finding 1 [repo-audit]: repo auditor rejected issue closure"
      : "Finding 1 [integration]: merger deferred this issue",
    packet.reason?.trim() ? `Details: ${packet.reason.trim()}` : "",
    auditSection,
    packet.failing_commands && packet.failing_commands.length > 0
      ? `Failing commands: ${packet.failing_commands.join(" | ")}`
      : "",
    packet.failing_tests && packet.failing_tests.length > 0
      ? `Failing tests: ${packet.failing_tests.join(" | ")}`
      : "",
    packet.touched_files && packet.touched_files.length > 0
      ? `Touched files: ${packet.touched_files.join(", ")}`
      : "",
    packet.status_delta && packet.status_delta.length > 0
      ? `Status delta: ${packet.status_delta.join(" | ")}`
      : "",
    packet.ci_excerpt && packet.ci_excerpt.length > 0
      ? `CI excerpt: ${packet.ci_excerpt.join(" | ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const buildMergeReworkPreparationFeedback = (
  targetBranch: string,
  status: string,
): string =>
  [
    "Merge context:",
    `Before this implementer pass, Sandcastle merged target branch \`${targetBranch}\` into the issue sandbox.`,
    status.trim()
      ? `Current issue-sandbox merge status:\n${status.trim()}`
      : "The target-branch pre-merge completed with a clean worktree.",
    "Resolve any conflicts and rerun the merger failing commands in this merged context.",
  ].join("\n\n");

export class RunState {
  readonly runId: string;
  readonly artifactRoot: string;
  readonly logRoot: string;
  readonly statePath: string;
  readonly targetBranch: string;
  readonly targetHeadSha: string;
  readonly startupStatus: string[];

  private readonly deferredIssues = new Map<string, DeferredIssue>();
  private readonly parkedIssues = new Map<string, ParkedIssue>();
  private readonly createdWorktrees = new Set<string>();
  private readonly createdIssueBranches = new Set<string>();
  private phase = "starting";
  private lastMergeSummary: string | undefined;

  constructor(options: {
    runId: string;
    artifactRoot: string;
    targetBranch: string;
    targetHeadSha: string;
    startupStatus: string[];
  }) {
    this.runId = options.runId;
    this.artifactRoot = options.artifactRoot;
    this.logRoot = join(options.artifactRoot, "logs");
    this.statePath = join(options.artifactRoot, "run-state.json");
    this.targetBranch = options.targetBranch;
    this.targetHeadSha = options.targetHeadSha;
    this.startupStatus = [...options.startupStatus];

    mkdirSync(this.logRoot, { recursive: true });
    this.persist();
  }

  setPhase(phase: string): void {
    this.phase = phase;
    this.persist();
  }

  recordWorktree(worktreePath: string, branch: string): void {
    this.createdWorktrees.add(worktreePath);
    this.createdIssueBranches.add(branch);
    this.persist();
  }

  hasDeferredIssueRework(): boolean {
    return this.deferredIssues.size > 0;
  }

  hasDeferredIssue(issueId: string): boolean {
    return this.deferredIssues.has(issueId);
  }

  getDeferredIssues(): PlannedIssue[] {
    return [...this.deferredIssues.values()].map((item) => ({
      iid: item.issueId,
      title:
        item.summary?.trim() ||
        (item.packet.source === "repo_audit"
          ? `Deferred repo-audit rework for ${item.issueId}`
          : `Deferred merge rework for ${item.issueId}`),
      branch: item.branch,
    }));
  }

  consumeDeferredFeedback(issueId: string): string {
    const deferred = this.deferredIssues.get(issueId);
    if (!deferred) return "";
    this.deferredIssues.delete(issueId);
    this.persist();
    return deferred.feedback;
  }

  getDeferredIssueSource(issueId: string): IssueReworkPacket["source"] | undefined {
    return this.deferredIssues.get(issueId)?.packet.source;
  }

  parkIssue(issueId: string, title: string, branch: string, reason: string): void {
    this.parkedIssues.set(issueId, {
      issue_id: issueId,
      title,
      branch,
      reason,
    });
    this.persist();
  }

  isParkedIssue(issueId: string): boolean {
    return this.parkedIssues.has(issueId);
  }

  getParkedIssues(): ParkedIssue[] {
    return [...this.parkedIssues.values()];
  }

  queueRepoAuditRework(
    failedIssues: RepoAuditReworkInput[],
    fallbackSummary?: string,
  ): DeferredIssue[] {
    const queued: DeferredIssue[] = [];
    for (const item of failedIssues) {
      const issueId = item.issue_id.trim();
      if (!issueId) {
        throw new Error("Repo audit rework issue missing issue_id.");
      }
      const branch = item.branch.trim();
      if (!branch) {
        throw new Error(`Repo audit rework issue ${issueId} missing branch.`);
      }
      const packet: IssueReworkPacket = {
        classification: "issue_rework",
        source: "repo_audit",
        issue_id: issueId,
        branch,
        reason: "Repo audit failed after merge.",
        summary: item.summary?.trim() || fallbackSummary?.trim() || undefined,
        audit_comment_markdown: item.comment_markdown,
      };
      const deferred = this.deferIssueRework(packet, fallbackSummary);
      queued.push(deferred);
    }
    if (queued.length > 0) this.persist();
    return queued;
  }

  applyMergeResult(result: MergeResult): AppliedMergeResult {
    this.lastMergeSummary = result.summary?.trim() || undefined;

    if (result.status === "complete") {
      const mergedIssueIds = new Set(
        (result.merged_issues ?? [])
          .map((issue) => issue.issue_id?.trim())
          .filter((issueId): issueId is string => Boolean(issueId)),
      );
      if (mergedIssueIds.size === 0 && this.deferredIssues.size > 0) {
        throw new Error("Merger returned complete during deferred rework without merged_issues.");
      }
      for (const issueId of mergedIssueIds) {
        this.deferredIssues.delete(issueId);
      }
      this.persist();
      return { kind: "complete" };
    }

    if (result.status === "repo_blocker") {
      const blocker = result.repo_blocker;
      if (!blocker || blocker.classification !== "repo_blocker") {
        throw new Error("Merger returned repo_blocker without a valid repo_blocker packet.");
      }
      this.persist();
      return { kind: "repo_blocker", blocker };
    }

    const reworkIssues = Array.isArray(result.rework_issues) ? result.rework_issues : [];
    if (reworkIssues.length === 0) {
      throw new Error("Merger returned issue_rework without any rework_issues.");
    }

    const appliedIssues: DeferredIssue[] = [];
    for (const packet of reworkIssues) {
      if (packet.classification !== "issue_rework") {
        throw new Error("Merger rework issue classification must be issue_rework.");
      }
      const issueId = packet.issue_id?.trim();
      if (!issueId) {
        throw new Error("Merger rework issue missing issue_id.");
      }
      const branch = packet.branch?.trim();
      if (!branch) {
        throw new Error(`Merger rework issue ${issueId} missing branch.`);
      }
      const statusDelta = packet.status_delta ?? [];
      if (
        statusDelta.length > 0 &&
        statusDeltaExplainedByBaseline(statusDelta, this.startupStatus)
      ) {
        throw new Error(
          `invalid_merge_classification: issue ${issueId} status_delta is fully explained by startup dirt.`,
        );
      }

      appliedIssues.push(this.deferIssueRework(packet, result.summary));
    }

    this.persist();
    return { kind: "issue_rework", issues: appliedIssues };
  }

  assertStatusMatchesBaseline(currentStatus: string[], context: string): void {
    const delta = diffStatusLines(this.startupStatus, currentStatus);
    if (delta.length > 0) {
      throw new Error(
        `${context} left unexpected repo dirt beyond the startup baseline.\n` +
          `Run ID: ${this.runId}\n` +
          `Artifact root: ${this.artifactRoot}\n` +
          `Status delta:\n${delta.join("\n")}`,
      );
    }
  }

  assertStatusMatchesAllowedDeltas(
    currentStatus: string[],
    allowedDeltas: string[][],
    context: string,
  ): void {
    const delta = diffStatusLines(this.startupStatus, currentStatus);
    const allowed = allowedDeltas.flat();
    const unexpected = diffStatusLines(allowed, delta);
    if (unexpected.length > 0) {
      throw new Error(
        `${context} left unexpected repo dirt beyond the startup baseline.\n` +
          `Run ID: ${this.runId}\n` +
          `Artifact root: ${this.artifactRoot}\n` +
          `Status delta:\n${delta.join("\n")}\n` +
          `Allowed delta:\n${allowed.join("\n") || "(none)"}`,
      );
    }
  }

  logPath(name: string): string {
    return join(this.logRoot, name);
  }

  snapshot(): RunStateSnapshot {
    return {
      run_id: this.runId,
      artifact_root: this.artifactRoot,
      log_root: this.logRoot,
      state_path: this.statePath,
      target_branch: this.targetBranch,
      target_head_sha: this.targetHeadSha,
      startup_status: [...this.startupStatus],
      created_worktrees: [...this.createdWorktrees],
      created_issue_branches: [...this.createdIssueBranches],
      pending_issue_rework: [...this.deferredIssues.values()].map((item) => item.packet),
      parked_issues: [...this.parkedIssues.values()],
      phase: this.phase,
      last_merge_summary: this.lastMergeSummary,
    };
  }

  private persist(): void {
    writeFileSync(this.statePath, `${JSON.stringify(this.snapshot(), null, 2)}\n`, "utf8");
  }

  private deferIssueRework(
    packet: IssueReworkPacket,
    fallbackSummary?: string,
  ): DeferredIssue {
    const issueId = packet.issue_id?.trim();
    if (!issueId) {
      throw new Error("Deferred rework issue missing issue_id.");
    }
    const branch = packet.branch?.trim();
    if (!branch) {
      throw new Error(`Deferred rework issue ${issueId} missing branch.`);
    }
    const normalizedPacket = {
      ...packet,
      issue_id: issueId,
      branch,
    };
    const deferred: DeferredIssue = {
      issueId,
      branch,
      summary: normalizedPacket.summary?.trim() || fallbackSummary?.trim() || undefined,
      feedback: buildIssueReworkFeedback(normalizedPacket, fallbackSummary),
      packet: normalizedPacket,
    };
    this.deferredIssues.set(issueId, deferred);
    return deferred;
  }
}
