// -nocheck
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseTaggedJson } from "./result-envelope.mts";

export type RepoAuditIssueRef = {
  issue_id: string;
  branch?: string;
};

export type FailedIssueAudit = {
  issue_id: string;
  summary: string;
  comment_markdown: string;
};

export type FollowUpIssueRequest = {
  parent_id: string;
  title: string;
  goal: string;
  acceptance_criteria: string[];
  blocking_findings: string[];
  proof_obligations: string[];
  out_of_scope: string[];
  source_issue_ids: string[];
  gap_fingerprint?: string;
};

export type RepoAuditResult = {
  status: "pass" | "fail";
  summary?: string;
  closeable_issues: RepoAuditIssueRef[];
  failed_issues: FailedIssueAudit[];
  follow_up_issues: FollowUpIssueRequest[];
};

export const parseRepoAuditResult = (stdout: string): RepoAuditResult => {
  const parsed = parseTaggedJson<RepoAuditResult>(stdout, "repo_audit_result", "Repo auditor");
  if (parsed.status !== "pass" && parsed.status !== "fail") {
    throw new Error(`Repo auditor returned invalid status: ${String(parsed.status)}`);
  }
  parsed.closeable_issues ??= [];
  parsed.failed_issues ??= [];
  parsed.follow_up_issues ??= [];
  if (parsed.status === "pass" && (parsed.failed_issues.length > 0 || parsed.follow_up_issues.length > 0)) {
    throw new Error("Repo auditor returned pass with failed or follow-up issues.");
  }
  return parsed;
};

export const persistRepoAuditResult = (artifactRoot: string, result: RepoAuditResult): void => {
  const dir = join(artifactRoot, "repo-audit");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "repo-audit.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(join(dir, "repo-audit.md"), renderRepoAudit(result), "utf8");
};

export const renderRepoAudit = (result: RepoAuditResult): string =>
  [
    "# Repo Audit",
    "",
    `Status: ${result.status}`,
    result.summary ? `Summary: ${result.summary}` : "",
    "",
    "## Closeable Issues",
    "",
    ...(result.closeable_issues.length > 0
      ? result.closeable_issues.map((issue) => `- ${issue.issue_id}`)
      : ["- none"]),
    "",
    "## Failed Issues",
    "",
    ...(result.failed_issues.length > 0
      ? result.failed_issues.map((issue) => `- ${issue.issue_id}: ${issue.summary}`)
      : ["- none"]),
    "",
    "## Follow-Up Issues",
    "",
    ...(result.follow_up_issues.length > 0
      ? result.follow_up_issues.map((issue) => `- ${issue.title}`)
      : ["- none"]),
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

export const fingerprintFollowUp = (request: FollowUpIssueRequest): string => {
  if (request.gap_fingerprint?.trim()) return request.gap_fingerprint.trim();
  const payload = JSON.stringify({
    parent_id: request.parent_id,
    goal: normalize(request.goal),
    acceptance_criteria: request.acceptance_criteria.map(normalize),
    blocking_findings: request.blocking_findings.map(normalize),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
};

export const followUpMarker = (request: FollowUpIssueRequest): string =>
  `sandcastle-follow-up:${JSON.stringify({
    parent: request.parent_id,
    gap_fingerprint: fingerprintFollowUp(request),
  })}`;

export const buildFollowUpIssueBody = (request: FollowUpIssueRequest): string => {
  const fingerprint = fingerprintFollowUp(request);
  return [
    `<!-- ${followUpMarker({ ...request, gap_fingerprint: fingerprint })} -->`,
    "",
    `Parent: #${request.parent_id}`,
    `Gap fingerprint: ${fingerprint}`,
    "",
    "## Goal",
    "",
    request.goal,
    "",
    "## Acceptance Criteria",
    "",
    ...asBullets(request.acceptance_criteria),
    "",
    "## Blocking Findings",
    "",
    ...asBullets(request.blocking_findings),
    "",
    "## Proof Obligations",
    "",
    ...asBullets(request.proof_obligations),
    "",
    "## Out Of Scope",
    "",
    ...asBullets(request.out_of_scope.length > 0 ? request.out_of_scope : ["Anything not required by the findings above."]),
    "",
    "## Source Issues",
    "",
    ...asBullets(request.source_issue_ids.map((id) => `#${id}`)),
    "",
    "```json follow_up_issue_contract",
    JSON.stringify({ ...request, gap_fingerprint: fingerprint }, null, 2),
    "```",
    "",
  ].join("\n");
};

const asBullets = (items: string[]): string[] =>
  items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");
