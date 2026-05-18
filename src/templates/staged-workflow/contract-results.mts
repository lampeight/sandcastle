// -nocheck
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseTaggedJson } from "./result-envelope.mts";
import { requiredContractRows, type IssueContract } from "./issue-contract.mts";

export type ContractRowKind =
  | "acceptance_criterion"
  | "blocking_finding"
  | "proof_obligation";

export type ImplementationRowStatus = "claimed_satisfied" | "not_addressed" | "disputed";
export type ReviewRowStatus = "pass" | "fail" | "partial" | "untested";

export type ContractMatrixRow<TStatus extends string> = {
  id: string;
  kind: ContractRowKind;
  status: TStatus;
  code_refs: string[];
  test_refs: string[];
  notes?: string;
};

export type ImplementationResult = {
  status: "complete" | "incomplete";
  issue_id: string;
  contract_version: string;
  matrix: ContractMatrixRow<ImplementationRowStatus>[];
  verification_commands: string[];
  known_gaps: string[];
};

export type ReviewResult = {
  status: "approve" | "changes_required";
  summary?: string;
  issue_id: string;
  contract_version: string;
  matrix: ContractMatrixRow<ReviewRowStatus>[];
};

export const parseImplementationResult = (
  stdout: string,
  contract: IssueContract,
): ImplementationResult => {
  const parsed = parseTaggedJson<ImplementationResult>(
    stdout,
    "implementation_result",
    `Implementer for ${contract.issue_id}`,
  );
  validateImplementationResult(parsed, contract);
  return parsed;
};

export const parseReviewResult = (stdout: string, contract: IssueContract): ReviewResult => {
  const parsed = parseTaggedJson<ReviewResult>(
    stdout,
    "review_result",
    `Reviewer for ${contract.issue_id}`,
  );
  validateReviewResult(parsed, contract);
  return parsed;
};

export const validateImplementationResult = (
  result: ImplementationResult,
  contract: IssueContract,
): void => {
  if (result.status !== "complete" && result.status !== "incomplete") {
    throw new Error(`Implementer for ${contract.issue_id} returned invalid status.`);
  }
  assertCommonResultFields(result.issue_id, result.contract_version, contract, "Implementer");
  validateMatrix(result.matrix, contract, ["claimed_satisfied", "not_addressed", "disputed"], "Implementer");
  if (result.status === "complete" && result.known_gaps.length > 0) {
    throw new Error(`Implementer for ${contract.issue_id} returned complete with known_gaps.`);
  }
};

export const validateReviewResult = (result: ReviewResult, contract: IssueContract): void => {
  if (result.status !== "approve" && result.status !== "changes_required") {
    throw new Error(`Reviewer for ${contract.issue_id} returned invalid status.`);
  }
  assertCommonResultFields(result.issue_id, result.contract_version, contract, "Reviewer");
  validateMatrix(result.matrix, contract, ["pass", "fail", "partial", "untested"], "Reviewer");
  const allPass = result.matrix.every((row) => row.status === "pass");
  if (result.status === "approve" && !allPass) {
    throw new Error(`Reviewer for ${contract.issue_id} approved with non-pass matrix rows.`);
  }
  if (result.status === "changes_required" && allPass) {
    throw new Error(`Reviewer for ${contract.issue_id} requested changes with all rows passing.`);
  }
};

export const persistImplementationResult = (
  dir: string,
  result: ImplementationResult,
): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "implementation-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(join(dir, "implementation-result.md"), renderImplementationResult(result), "utf8");
};

export const persistReviewResult = (dir: string, result: ReviewResult): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "review-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(join(dir, "review-result.md"), renderReviewResult(result), "utf8");
};

export const buildReviewFeedback = (review: ReviewResult): string => {
  const failingRows = review.matrix.filter((row) => row.status !== "pass");
  return [
    review.summary?.trim() ? `Summary: ${review.summary.trim()}` : "",
    ...failingRows.map((row, index) =>
      [
        `Finding ${index + 1} [${row.status}]: ${row.kind} ${row.id}`,
        row.notes ? `Details: ${row.notes}` : "",
        row.code_refs.length > 0 ? `Code refs: ${row.code_refs.join(", ")}` : "",
        row.test_refs.length > 0 ? `Test refs: ${row.test_refs.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const renderImplementationResult = (result: ImplementationResult): string =>
  renderMatrixDocument("Implementation Result", result.status, result.matrix, result.verification_commands);

export const renderReviewResult = (result: ReviewResult): string =>
  renderMatrixDocument("Review Result", result.status, result.matrix, []);

const assertCommonResultFields = (
  issueId: string,
  contractVersion: string,
  contract: IssueContract,
  context: string,
): void => {
  if (issueId !== contract.issue_id) {
    throw new Error(`${context} returned issue_id ${issueId}, expected ${contract.issue_id}.`);
  }
  if (contractVersion !== contract.version) {
    throw new Error(
      `${context} returned contract_version ${contractVersion}, expected ${contract.version}.`,
    );
  }
};

const validateMatrix = <TStatus extends string>(
  matrix: ContractMatrixRow<TStatus>[],
  contract: IssueContract,
  allowedStatuses: readonly string[],
  context: string,
): void => {
  if (!Array.isArray(matrix)) {
    throw new Error(`${context} matrix must be an array.`);
  }
  const required = requiredContractRows(contract);
  const seen = new Set(matrix.map((row) => row.id));
  const missing = required.filter((row) => !seen.has(row.id));
  if (missing.length > 0) {
    throw new Error(`${context} matrix missing rows: ${missing.map((row) => row.id).join(", ")}`);
  }

  const validKinds = new Map(required.map((row) => [row.id, row.kind]));
  for (const row of matrix) {
    if (!validKinds.has(row.id)) {
      throw new Error(`${context} matrix contains unknown row id ${row.id}.`);
    }
    if (row.kind !== validKinds.get(row.id)) {
      throw new Error(`${context} matrix row ${row.id} has wrong kind ${row.kind}.`);
    }
    if (!allowedStatuses.includes(row.status)) {
      throw new Error(`${context} matrix row ${row.id} has invalid status ${row.status}.`);
    }
    row.code_refs ??= [];
    row.test_refs ??= [];
  }
};

const renderMatrixDocument = <TStatus extends string>(
  title: string,
  status: string,
  matrix: ContractMatrixRow<TStatus>[],
  verificationCommands: string[],
): string =>
  [
    `# ${title}`,
    "",
    `Status: ${status}`,
    "",
    "## Matrix",
    "",
    ...matrix.map((row) => `- ${row.id} (${row.kind}): ${row.status}${row.notes ? ` - ${row.notes}` : ""}`),
    "",
    "## Verification Commands",
    "",
    ...(verificationCommands.length > 0 ? verificationCommands.map((command) => `- ${command}`) : ["- none"]),
    "",
  ].join("\n");
