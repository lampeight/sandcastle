// -nocheck
import { readFileSync } from "node:fs";
import type { IssueView } from "./issue-follow-up.mts";

type PromptArgs = Record<string, unknown>;

type AgentOptions = {
  name?: string;
  promptFile?: string;
  promptArgs?: PromptArgs;
};

export type AgentRunResult = {
  stdout: string;
  commits: { sha: string }[];
  iterations: unknown[];
  completionSignal?: string;
  logFilePath?: string;
};

export type ReadyIssue = {
  iid?: number | string;
  id?: number | string;
  title?: string;
  web_url?: string;
};

const promptBuiltIns = new Set(["SOURCE_BRANCH", "TARGET_BRANCH"]);

const dryRunResult = (
  stdout: string,
  commits: { sha: string }[] = [],
): AgentRunResult => ({
  stdout,
  commits,
  iterations: [],
});

const dryIssue = {
  iid: "309",
  title: "MS-03 PRD 4 - Commercial Catalog Admin lookup and per-SKU entry",
  branch: "sandcastle/issue-309-smoke-commercial-catalog-admin-lookup",
};

const dryIssueContext = (issueId: string): string => [
  `#${issueId} ${dryIssue.title}`,
  "",
  "Parent PRD: #296",
  "",
  "Acceptance criteria:",
  "- Search Commercial Catalog by SKU, product name, alias, and pricelist context.",
  "- Search results expose a direct path into per-SKU detail.",
  "- Operator access is enforced through catalog:read scope boundaries.",
  "",
  "Comments:",
  "- Reopened review note: operator shell must use the child issue findings, not the broad PRD alone.",
].join("\n");

const dryParentIssueContext = (issueId: string): string => [
  `#${issueId} PRD 4 - Commercial Catalog Admin`,
  "",
  "The parent PRD exists only as context. Workers receive child issue packets.",
].join("\n");

export const smokeRequested = (): boolean =>
  process.argv.includes("--dry-run") || process.env.SANDCASTLE_DRY_RUN === "1";

export const validatePromptArgs = (
  filePath: string | undefined,
  args: PromptArgs = {},
  builtIns: Set<string> = new Set(),
): void => {
  if (!filePath) return;
  const prompt = readFileSync(filePath, "utf8");
  const placeholders = [
    ...new Set(
      [...prompt.matchAll(/{{\s*([A-Z0-9_]+)\s*}}/g)].map((match) => match[1]!),
    ),
  ];
  const missing = placeholders.filter(
    (placeholder) =>
      !(placeholder in args) &&
      !builtIns.has(placeholder) &&
      !promptBuiltIns.has(placeholder),
  );
  if (missing.length > 0) {
    throw new Error(`${filePath} has unresolved prompt args: ${missing.join(", ")}`);
  }

  if (
    !filePath.endsWith("merge-prompt.md") &&
    /!`[^`]*\bglab\s+issue\s+(view|list)\b/.test(prompt)
  ) {
    throw new Error(`${filePath} contains a prompt-level GitLab issue fetch.`);
  }
};

export const createSmokeMode = (options: {
  enabled: boolean;
  parentItemId: string;
  repoRoot: string;
}) => {
  const { enabled, parentItemId, repoRoot } = options;
  let plannerRuns = 0;
  let mergerRuns = 0;
  let repoAuditRuns = 0;
  let totalImplementRuns = 0;
  let totalReviewRuns = 0;

  const dryContractMatrix = (
    promptArgs: PromptArgs | undefined,
    implementation: boolean,
    failing = false,
  ) => {
    const contract = JSON.parse(String(promptArgs?.ISSUE_CONTRACT_JSON ?? "{}")) as {
      acceptance_criteria?: { id: string }[];
      blocking_findings?: { id: string }[];
      proof_obligations?: { id: string }[];
    };
    const rows = [
      ...(contract.acceptance_criteria ?? []).map((row) => ({
        id: row.id,
        kind: "acceptance_criterion",
      })),
      ...(contract.blocking_findings ?? []).map((row) => ({
        id: row.id,
        kind: "blocking_finding",
      })),
      ...(contract.proof_obligations ?? []).map((row) => ({
        id: row.id,
        kind: "proof_obligation",
      })),
    ];
    return rows.map((row, index) => ({
      ...row,
      status: implementation
        ? "claimed_satisfied"
        : failing && (row.id === "AC2" || row.id === "P2")
          ? row.kind === "proof_obligation"
            ? "untested"
            : "fail"
          : "pass",
      code_refs: [`src/example.py:${index + 1}`],
      test_refs: [`tests/test_example.py::test_${row.id.toLowerCase()}`],
      notes: failing && (row.id === "AC2" || row.id === "P2")
        ? "Exercise reviewer feedback handoff."
        : "ok",
    }));
  };

  return {
    enabled,

    announce(): void {
      if (!enabled) return;
      console.log(
        "[dry-run] Exercising planner -> invalid implementer result -> reviewer rework -> merger defer -> deferred merge rework -> repo-audit fail -> deferred audit rework.",
      );
    },

    iterationLimit(defaultLimit: number): number {
      return enabled ? 3 : defaultLimit;
    },

    runAgent(agentOptions: AgentOptions): AgentRunResult | undefined {
      if (!enabled) return undefined;
      validatePromptArgs(agentOptions.promptFile, agentOptions.promptArgs);
      console.log(`[dry-run] ${agentOptions.name ?? "agent"} prompt resolved.`);

      if (agentOptions.name === "planner") {
        plannerRuns += 1;
        if (plannerRuns > 1) {
          throw new Error("Planner should be bypassed while deferred rework is pending.");
        }
        return dryRunResult(`<plan>${JSON.stringify({ issues: [dryIssue] })}</plan>`);
      }
      if (agentOptions.name === "merger") {
        mergerRuns += 1;
        if (mergerRuns === 1) {
          return dryRunResult(
            `<merge_result>${JSON.stringify({
              status: "issue_rework",
              summary: "dry run merger deferred one issue",
              merged_issues: [],
              rework_issues: [
                {
                  classification: "issue_rework",
                  issue_id: dryIssue.iid,
                  branch: dryIssue.branch,
                  reason: "Exercise deferred merge rework routing.",
                  summary: "dry run merge rework",
                  failing_commands: ["make ci PYTEST_JOBS=12"],
                  failing_tests: ["tests/test_example.py::test_merge_follow_up"],
                  touched_files: ["src/example.py"],
                  status_delta: [],
                  ci_excerpt: ["dry run merge follow-up"],
                },
              ],
            })}</merge_result>\n<promise>COMPLETE</promise>`,
          );
        }
        return dryRunResult(
          `<merge_result>${JSON.stringify({
            status: "complete",
            summary: "dry run merged fixture branch",
            merged_issues: [{ issue_id: dryIssue.iid, branch: dryIssue.branch }],
          })}</merge_result>\n<promise>COMPLETE</promise>`,
        );
      }
      if (agentOptions.name === "repo-audit") {
        repoAuditRuns += 1;
        if (repoAuditRuns === 1) {
          return dryRunResult(
            `<repo_audit_result>${JSON.stringify({
              status: "fail",
              summary: "dry run repo audit rejected issue closure",
              closeable_issues: [],
              failed_issues: [
                {
                  issue_id: dryIssue.iid,
                  summary: "API still emits old SKU admin links",
                  comment_markdown:
                    "Repo-audit findings:\n- `src/cirrus_fastmcp/routes/api/commercial_catalog.py:493` still emits `/admin/pricebook/sku/...`.",
                },
              ],
              follow_up_issues: [],
            })}</repo_audit_result>\n<promise>COMPLETE</promise>`,
          );
        }
        return dryRunResult(
          `<repo_audit_result>${JSON.stringify({
            status: "pass",
            summary: "dry run repo audit passed",
            closeable_issues: [{ issue_id: dryIssue.iid, branch: dryIssue.branch }],
            failed_issues: [],
            follow_up_issues: [],
          })}</repo_audit_result>\n<promise>COMPLETE</promise>`,
        );
      }

      throw new Error(`No dry-run fixture for agent ${agentOptions.name ?? "unknown"}.`);
    },

    createIssueSandbox(branch: string): unknown | undefined {
      if (!enabled) return undefined;

      let reviewRuns = 0;
      let implementRuns = 0;
      return {
        branch,
        worktreePath: repoRoot,
        run: async (agentOptions: AgentOptions): Promise<AgentRunResult> => {
          validatePromptArgs(agentOptions.promptFile, agentOptions.promptArgs);
          console.log(`[dry-run] ${agentOptions.name ?? "sandbox-agent"} prompt resolved.`);

          if (agentOptions.name?.includes("implementer")) {
            implementRuns += 1;
            totalImplementRuns += 1;
            const reviewFeedback = String(agentOptions.promptArgs?.REVIEW_FEEDBACK ?? "");
            const packet = JSON.parse(String(agentOptions.promptArgs?.ISSUE_PACKET_JSON ?? "{}")) as {
              mode?: string;
              structured_inputs?: Record<string, string | undefined>;
            };
            if (totalImplementRuns === 1) {
              return dryRunResult(
                `<implementation_result>${JSON.stringify({
                  status: "complete",
                  issue_id: dryIssue.iid,
                  contract_version: "v1",
                  matrix: dryContractMatrix(agentOptions.promptArgs, true).filter(
                    (row) => row.kind !== "proof_obligation",
                  ),
                  verification_commands: ["make test TEST_ARGS='tests/test_example.py' PYTEST_JOBS=2"],
                  known_gaps: [],
                })}</implementation_result>\n<promise>COMPLETE</promise>`,
                [{ sha: "dry-invalid-implementer-envelope" }],
              );
            }
            if (
              totalImplementRuns === 2 &&
              !reviewFeedback.includes("invalid implementation_result envelope")
            ) {
              throw new Error("Dry-run implementer did not receive invalid result feedback.");
            }
            if (totalImplementRuns === 3 && !reviewFeedback.includes("Finding 1")) {
              throw new Error("Dry-run rework implementer did not receive reviewer feedback.");
            }
            if (totalImplementRuns === 4) {
              if (packet.mode !== "merge_rework") {
                throw new Error("Dry-run deferred merge implementer did not receive merge_rework mode.");
              }
              if (!reviewFeedback.includes("merger follow-up")) {
                throw new Error("Dry-run deferred merge implementer did not receive merge rework feedback.");
              }
              if (!packet.structured_inputs?.merge_rework_feedback?.includes("merger follow-up")) {
                throw new Error("Dry-run deferred merge packet omitted merge rework feedback.");
              }
              if (!packet.structured_inputs?.merge_rework_feedback?.includes("merged target branch")) {
                throw new Error("Dry-run deferred merge packet omitted target pre-merge context.");
              }
            }
            if (totalImplementRuns === 5) {
              if (packet.mode !== "audit_rework") {
                throw new Error("Dry-run deferred audit implementer did not receive audit_rework mode.");
              }
              if (!reviewFeedback.includes("repo-audit follow-up")) {
                throw new Error("Dry-run deferred audit implementer did not receive repo-audit feedback.");
              }
              if (
                !packet.structured_inputs?.audit_rework_feedback?.includes(
                  "src/cirrus_fastmcp/routes/api/commercial_catalog.py:493",
                )
              ) {
                throw new Error("Dry-run deferred audit packet omitted repo-audit feedback.");
              }
            }
            return dryRunResult(
              `<implementation_result>${JSON.stringify({
                status: "complete",
                issue_id: dryIssue.iid,
                contract_version: "v1",
                matrix: dryContractMatrix(agentOptions.promptArgs, true),
                verification_commands: ["make test TEST_ARGS='tests/test_example.py' PYTEST_JOBS=2"],
                known_gaps: [],
              })}</implementation_result>\n<promise>COMPLETE</promise>`,
              [
                { sha: `dry-implement-${implementRuns}` },
              ],
            );
          }

          if (agentOptions.name?.includes("reviewer")) {
            reviewRuns += 1;
            totalReviewRuns += 1;
            if (totalReviewRuns === 1) {
              return dryRunResult(
                `<review_result>${JSON.stringify({
                  status: "changes_required",
                  summary: "dry run review requested one rework pass",
                  issue_id: dryIssue.iid,
                  contract_version: "v1",
                  matrix: dryContractMatrix(agentOptions.promptArgs, false, true),
                })}<promise>COMPLETE</promise>`,
              );
            }
            if (reviewRuns >= 1) {
              return dryRunResult(
                `<review_result>${JSON.stringify({
                  status: "approve",
                  summary: "dry run approved after rework",
                  issue_id: dryIssue.iid,
                  contract_version: "v1",
                  matrix: dryContractMatrix(agentOptions.promptArgs, false),
                })}</review_result>\n<promise>COMPLETE</promise>`,
              );
            }
          }

          throw new Error(
            `No dry-run fixture for sandbox agent ${agentOptions.name ?? "unknown"}.`,
          );
        },
        interactive: async () => ({ commits: [], exitCode: 0 }),
        close: async () => ({}),
        [Symbol.asyncDispose]: async () => {},
      };
    },

    fetchIssueContext(issueId: string): string | undefined {
      if (!enabled) return undefined;
      return issueId === parentItemId ? dryParentIssueContext(issueId) : dryIssueContext(issueId);
    },

    fetchIssueJson(issueId: string): IssueView | undefined {
      if (!enabled) return undefined;
      return {
        state: "opened",
        title: issueId === parentItemId ? `PRD ${parentItemId}` : dryIssue.title,
        Notes: [],
      };
    },

    fetchReadyIssues(): { raw: string; parsed: ReadyIssue[] } | undefined {
      if (!enabled) return undefined;
      const raw = JSON.stringify([
        { iid: dryIssue.iid, title: dryIssue.title, web_url: "https://example.invalid/309" },
      ]);
      return { raw, parsed: JSON.parse(raw) as ReadyIssue[] };
    },

    getWorktreeStatus(): string | undefined {
      return enabled ? "" : undefined;
    },
  };
};
