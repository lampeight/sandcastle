// -nocheck
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { requiredContractRows, type IssueContract } from "./issue-contract.mts";
import type { ImplementationResult, ReviewResult } from "./contract-results.mts";

export type ContractAuditResult = {
  status: "pass" | "fail";
  issue_id: string;
  contract_version: string;
  missing_claims: string[];
  unsupported_claims: string[];
  disputed_claims: string[];
  missing_proof: string[];
  failed_forbidden_patterns: {
    id: string;
    path: string;
    line: number;
    text: string;
  }[];
};

export const auditContract = (options: {
  contract: IssueContract;
  implementation: ImplementationResult;
  review: ReviewResult;
  worktreePath?: string;
}): ContractAuditResult => {
  const { contract, implementation, review, worktreePath } = options;
  const required = requiredContractRows(contract);
  const implementationRows = new Map(implementation.matrix.map((row) => [row.id, row]));
  const reviewRows = new Map(review.matrix.map((row) => [row.id, row]));

  const missingClaims = required
    .filter((row) => !implementationRows.has(row.id))
    .map((row) => row.id);
  const unsupportedClaims = implementation.matrix
    .filter((row) => row.status !== "claimed_satisfied")
    .map((row) => row.id);
  const disputedClaims = review.matrix
    .filter((row) => row.status !== "pass")
    .map((row) => row.id);
  const missingProof = required
    .filter((row) => {
      const implementationRow = implementationRows.get(row.id);
      const reviewRow = reviewRows.get(row.id);
      return (
        !implementationRow ||
        !reviewRow ||
        implementationRow.test_refs.length === 0 ||
        reviewRow.test_refs.length === 0
      );
    })
    .map((row) => row.id);
  const failedForbiddenPatterns = worktreePath
    ? findForbiddenPatternMatches(contract, worktreePath)
    : [];

  const status =
    missingClaims.length === 0 &&
    unsupportedClaims.length === 0 &&
    disputedClaims.length === 0 &&
    missingProof.length === 0 &&
    failedForbiddenPatterns.length === 0
      ? "pass"
      : "fail";

  return {
    status,
    issue_id: contract.issue_id,
    contract_version: contract.version,
    missing_claims: missingClaims,
    unsupported_claims: unsupportedClaims,
    disputed_claims: disputedClaims,
    missing_proof: missingProof,
    failed_forbidden_patterns: failedForbiddenPatterns,
  };
};

export const persistContractAudit = (dir: string, result: ContractAuditResult): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "contract-audit.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(join(dir, "contract-audit.md"), renderContractAudit(result), "utf8");
};

export const renderContractAudit = (result: ContractAuditResult): string =>
  [
    `# Contract Audit ${result.issue_id}`,
    "",
    `Status: ${result.status}`,
    `Contract: ${result.contract_version}`,
    "",
    "## Missing Claims",
    "",
    ...(result.missing_claims.length > 0 ? result.missing_claims.map((id) => `- ${id}`) : ["- none"]),
    "",
    "## Unsupported Claims",
    "",
    ...(result.unsupported_claims.length > 0 ? result.unsupported_claims.map((id) => `- ${id}`) : ["- none"]),
    "",
    "## Disputed Claims",
    "",
    ...(result.disputed_claims.length > 0 ? result.disputed_claims.map((id) => `- ${id}`) : ["- none"]),
    "",
    "## Missing Proof",
    "",
    ...(result.missing_proof.length > 0 ? result.missing_proof.map((id) => `- ${id}`) : ["- none"]),
    "",
    "## Forbidden Pattern Matches",
    "",
    ...(result.failed_forbidden_patterns.length > 0
      ? result.failed_forbidden_patterns.map((match) => `- ${match.id}: ${match.path}:${match.line}`)
      : ["- none"]),
    "",
  ].join("\n");

const findForbiddenPatternMatches = (
  contract: IssueContract,
  root: string,
): ContractAuditResult["failed_forbidden_patterns"] => {
  if (contract.forbidden_patterns.length === 0 || !existsSync(root)) return [];
  const matches: ContractAuditResult["failed_forbidden_patterns"] = [];
  for (const filePath of listFiles(root)) {
    const relPath = relative(root, filePath);
    const activePatterns = contract.forbidden_patterns.filter((pattern) =>
      matchesGlob(relPath, pattern.path_glob),
    );
    if (activePatterns.length === 0) continue;
    let lines: string[];
    try {
      lines = readFileSync(filePath, "utf8").split("\n");
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    for (const pattern of activePatterns) {
      const regexp = new RegExp(pattern.pattern);
      lines.forEach((line, index) => {
        if (regexp.test(line)) {
          matches.push({
            id: pattern.id,
            path: relPath,
            line: index + 1,
            text: line.trim(),
          });
        }
      });
    }
  }
  return matches;
};

const listFiles = (root: string): string[] => {
  const ignored = new Set([".git", "node_modules", ".venv", ".cache", "runs", "worktrees"]);
  const files: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (error) {
    if (isMissingPathError(error)) return files;
    throw error;
  }
  for (const entry of entries) {
    if (ignored.has(entry)) continue;
    const path = join(root, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(path);
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    if (stat.isDirectory()) {
      files.push(...listFiles(path));
      continue;
    }
    if (stat.isFile()) files.push(path);
  }
  return files;
};

const isMissingPathError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "ENOENT";

const matchesGlob = (path: string, glob: string): boolean => {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    if (glob.startsWith("**", index)) {
      pattern += ".*";
      index += 1;
      continue;
    }
    const char = glob[index]!;
    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }
    pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`).test(path);
};
