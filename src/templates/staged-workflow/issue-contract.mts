// -nocheck
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractPostCompletionComments, type IssueNote, type IssueView } from "./issue-follow-up.mts";

export type IssuePacket = {
  issue_id: string;
  parent_id: string;
  mode: "fresh" | "review_rework" | "merge_rework" | "audit_rework";
  title: string;
  state?: string;
  raw_issue_context: string;
  parent_context_included: boolean;
  parent_context_reason?: string;
  raw_parent_context?: string;
  notes: IssueNote[];
  post_completion_comments: string[];
  structured_inputs: {
    review_feedback?: string;
    merge_rework_feedback?: string;
    audit_rework_feedback?: string;
  };
};

export type AcceptanceCriterion = {
  id: string;
  text: string;
  type: "positive" | "negative_boundary";
};

export type BlockingFinding = {
  id: string;
  source: "issue_body" | "post_completion_comment" | "review_result" | "merge_rework" | "repo_audit" | "guard";
  text: string;
  code_refs: string[];
};

export type ForbiddenPattern = {
  id: string;
  path_glob: string;
  pattern: string;
  reason: string;
};

export type ProofObligation = {
  id: string;
  text: string;
  contract_ids: string[];
};

export type IssueContract = {
  issue_id: string;
  parent_id: string;
  version: string;
  mode: IssuePacket["mode"];
  goal: string;
  acceptance_criteria: AcceptanceCriterion[];
  blocking_findings: BlockingFinding[];
  forbidden_patterns: ForbiddenPattern[];
  proof_obligations: ProofObligation[];
  out_of_scope: string[];
};

export const issueArtifactDir = (
  artifactRoot: string,
  iteration: number,
  issueId: string,
): string => join(artifactRoot, "issues", issueId, `iteration-${String(iteration).padStart(2, "0")}`);

export const buildIssuePacket = (options: {
  issueId: string;
  parentId: string;
  mode: IssuePacket["mode"];
  issueContext: string;
  issueJson: IssueView;
  reviewFeedback?: string;
  mergeReworkFeedback?: string;
  auditReworkFeedback?: string;
  parentContext?: string;
  parentContextReason?: string;
}): IssuePacket => {
  const notes = Array.isArray(options.issueJson.Notes) ? options.issueJson.Notes : [];
  const title = String(
    (options.issueJson as { title?: unknown }).title ?? extractIssueTitle(options.issueContext, options.issueId),
  ).trim();
  return {
    issue_id: options.issueId,
    parent_id: options.parentId,
    mode: options.mode,
    title,
    state: options.issueJson.state,
    raw_issue_context: options.issueContext,
    parent_context_included: Boolean(options.parentContext),
    parent_context_reason: options.parentContextReason,
    raw_parent_context: options.parentContext,
    notes,
    post_completion_comments: extractPostCompletionComments(options.issueJson),
    structured_inputs: {
      review_feedback: options.reviewFeedback?.trim() || undefined,
      merge_rework_feedback: options.mergeReworkFeedback?.trim() || undefined,
      audit_rework_feedback: options.auditReworkFeedback?.trim() || undefined,
    },
  };
};

export const compileIssueContract = (packet: IssuePacket): IssueContract => {
  const goal = extractGoal(packet);
  const acceptanceCriteria = extractAcceptanceCriteria(packet.raw_issue_context, goal);
  const blockingFindings = extractBlockingFindings(packet);
  const forbiddenPatterns = extractForbiddenPatterns(packet);
  const proofObligations = buildProofObligations(acceptanceCriteria, blockingFindings);

  return {
    issue_id: packet.issue_id,
    parent_id: packet.parent_id,
    version: "v1",
    mode: packet.mode,
    goal,
    acceptance_criteria: acceptanceCriteria,
    blocking_findings: blockingFindings,
    forbidden_patterns: forbiddenPatterns,
    proof_obligations: proofObligations,
    out_of_scope: extractOutOfScope(packet.raw_issue_context),
  };
};

export const persistIssuePacket = (dir: string, packet: IssuePacket): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "issue-packet.json"), `${JSON.stringify(packet, null, 2)}\n`, "utf8");
};

export const persistIssueContract = (dir: string, contract: IssueContract): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "issue-contract.json"), `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  writeFileSync(join(dir, "issue-contract.md"), renderIssueContract(contract), "utf8");
};

export const renderIssueContract = (contract: IssueContract): string =>
  [
    `# Issue Contract ${contract.issue_id}`,
    "",
    `Parent: #${contract.parent_id}`,
    `Version: ${contract.version}`,
    `Mode: ${contract.mode}`,
    "",
    "## Goal",
    "",
    contract.goal,
    "",
    "## Acceptance Criteria",
    "",
    ...contract.acceptance_criteria.map((criterion) => `- ${criterion.id}: ${criterion.text}`),
    "",
    "## Blocking Findings",
    "",
    ...(contract.blocking_findings.length > 0
      ? contract.blocking_findings.map((finding) => `- ${finding.id} [${finding.source}]: ${finding.text}`)
      : ["- none"]),
    "",
    "## Forbidden Patterns",
    "",
    ...(contract.forbidden_patterns.length > 0
      ? contract.forbidden_patterns.map((item) => `- ${item.id}: ${item.path_glob} / ${item.pattern}`)
      : ["- none"]),
    "",
    "## Proof Obligations",
    "",
    ...contract.proof_obligations.map((proof) => `- ${proof.id}: ${proof.text}`),
    "",
  ].join("\n");

export const requiredContractRows = (contract: IssueContract): { id: string; kind: string }[] => [
  ...contract.acceptance_criteria.map((item) => ({ id: item.id, kind: "acceptance_criterion" })),
  ...contract.blocking_findings.map((item) => ({ id: item.id, kind: "blocking_finding" })),
  ...contract.proof_obligations.map((item) => ({ id: item.id, kind: "proof_obligation" })),
];

const extractIssueTitle = (context: string, issueId: string): string => {
  const first = context
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return first?.replace(new RegExp(`^#?${issueId}\\s*`), "").trim() || `Issue ${issueId}`;
};

const extractGoal = (packet: IssuePacket): string => {
  const goalLine = findSectionBullets(packet.raw_issue_context, ["goal", "objective"]).at(0);
  return goalLine || packet.title || `Complete issue ${packet.issue_id}`;
};

const extractAcceptanceCriteria = (context: string, fallbackGoal: string): AcceptanceCriterion[] => {
  const lines = findSectionBullets(context, [
    "acceptance criteria",
    "acceptance",
    "definition of done",
    "done when",
  ]);
  const criteria = lines.length > 0 ? lines : [fallbackGoal];
  return criteria.map((text, index) => ({
    id: `AC${index + 1}`,
    text,
    type: isNegativeBoundary(text) ? "negative_boundary" : "positive",
  }));
};

const extractBlockingFindings = (packet: IssuePacket): BlockingFinding[] => {
  const findings: BlockingFinding[] = [];
  let index = 1;

  for (const comment of packet.post_completion_comments) {
    findings.push({
      id: `F${index++}`,
      source: "post_completion_comment",
      text: comment,
      code_refs: extractCodeRefs(comment),
    });
  }

  const reviewFeedback = packet.structured_inputs.review_feedback;
  if (reviewFeedback) {
    findings.push({
      id: `F${index++}`,
      source: "review_result",
      text: reviewFeedback,
      code_refs: extractCodeRefs(reviewFeedback),
    });
  }

  const mergeFeedback = packet.structured_inputs.merge_rework_feedback;
  if (mergeFeedback) {
    findings.push({
      id: `F${index++}`,
      source: "merge_rework",
      text: mergeFeedback,
      code_refs: extractCodeRefs(mergeFeedback),
    });
  }

  const auditFeedback = packet.structured_inputs.audit_rework_feedback;
  if (auditFeedback) {
    findings.push({
      id: `F${index++}`,
      source: "repo_audit",
      text: auditFeedback,
      code_refs: extractCodeRefs(auditFeedback),
    });
  }

  return findings;
};

const extractForbiddenPatterns = (packet: IssuePacket): ForbiddenPattern[] => {
  const sourceText = [
    packet.raw_issue_context,
    ...packet.post_completion_comments,
    packet.structured_inputs.review_feedback ?? "",
    packet.structured_inputs.merge_rework_feedback ?? "",
    packet.structured_inputs.audit_rework_feedback ?? "",
  ].join("\n");
  const lines = sourceText.split("\n").map((line) => line.trim()).filter(Boolean);
  const patterns: ForbiddenPattern[] = [];

  for (const line of lines) {
    const match = line.match(/forbid(?:den)?\s+pattern\s*:\s*(.+?)\s+in\s+(.+)/i);
    if (!match) continue;
    patterns.push({
      id: `FP${patterns.length + 1}`,
      pattern: match[1]!.trim(),
      path_glob: match[2]!.trim(),
      reason: line,
    });
  }

  return patterns;
};

const buildProofObligations = (
  criteria: AcceptanceCriterion[],
  findings: BlockingFinding[],
): ProofObligation[] => [
  ...criteria.map((criterion, index) => ({
    id: `P${index + 1}`,
    text: `Provide code and test proof for ${criterion.id}.`,
    contract_ids: [criterion.id],
  })),
  ...findings.map((finding, index) => ({
    id: `P${criteria.length + index + 1}`,
    text: `Provide proof that blocking finding ${finding.id} is addressed.`,
    contract_ids: [finding.id],
  })),
];

const extractOutOfScope = (context: string): string[] =>
  findSectionBullets(context, ["out of scope", "non goals", "non-goals"]);

const findSectionBullets = (context: string, sectionNames: string[]): string[] => {
  const result: string[] = [];
  const normalizedSections = sectionNames.map((name) => name.toLowerCase());
  let inSection = false;

  for (const rawLine of context.split("\n")) {
    const line = rawLine.trim();
    const normalized = line.toLowerCase().replace(/[*#_`]/g, "").replace(/:$/, "");
    if (normalizedSections.includes(normalized)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (!line) {
      if (result.length > 0) break;
      continue;
    }
    if (/^#{1,6}\s+/.test(line) || (/^[A-Z][A-Za-z\s-]+:$/.test(line) && result.length > 0)) {
      break;
    }
    const bullet = line.match(/^[-*]\s+\[?[ xX]?\]?\s*(.+)$/)?.[1]?.trim();
    if (bullet) {
      result.push(bullet);
      continue;
    }
    if (result.length === 0 && !line.endsWith(":")) {
      result.push(line);
    }
  }

  return result;
};

const isNegativeBoundary = (text: string): boolean =>
  /\b(must not|no longer|only|single|canonical|forbid|forbidden|without|never)\b/i.test(text);

const extractCodeRefs = (text: string): string[] => [
  ...new Set(
    [...text.matchAll(/\b(?:src|tests|docs|scripts|templates)\/[A-Za-z0-9_./-]+:\d+\b/g)].map(
      (match) => match[0],
    ),
  ),
];
