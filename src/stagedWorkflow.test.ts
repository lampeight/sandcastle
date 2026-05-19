import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStagedWorkflowIssueContract,
  getStagedWorkflowTmuxPanes,
  makeStagedWorkflowRunId,
  parseImplementationResultEnvelope,
  parseMergeResultEnvelope,
  parseReviewResultEnvelope,
  parseStagedWorkflowCliArgs,
  resolveStagedWorkflowRuntimePaths,
  runStagedWorkflow,
} from "./stagedWorkflow.js";

describe("parseStagedWorkflowCliArgs", () => {
  it("applies default and stage-specific model overrides", () => {
    const parsed = parseStagedWorkflowCliArgs(
      [
        "--model",
        "gpt-5.4",
        "--planner-model",
        "gpt-5.5",
        "--synthesizer-model",
        "gpt-5.5",
        "--control-mode",
        "proof-first",
        "--max-issues-per-pass",
        "1",
        "--synthesis-after-review-pass",
        "3",
        "--tmux",
        "--tmux-session-name",
        "sc-test",
      ],
      { default: "gpt-5.4-mini" },
    );

    expect(parsed.models.default).toBe("gpt-5.4");
    expect(parsed.models.planner).toBe("gpt-5.5");
    expect(parsed.models.synthesizer).toBe("gpt-5.5");
    expect(parsed.controlMode).toBe("proof-first");
    expect(parsed.maxIssuesPerPass).toBe(1);
    expect(parsed.synthesisAfterReviewPass).toBe(3);
    expect(parsed.tmuxEnabled).toBe(true);
    expect(parsed.tmuxSessionName).toBe("sc-test");
  });

  it("rejects invalid execution mode", () => {
    expect(() =>
      parseStagedWorkflowCliArgs(["--execution", "diagonal"], {
        default: "gpt-5.4-mini",
      }),
    ).toThrow('Invalid execution mode "diagonal"');
  });

  it("rejects invalid control mode", () => {
    expect(() =>
      parseStagedWorkflowCliArgs(["--control-mode", "deliberate-forever"], {
        default: "gpt-5.4-mini",
      }),
    ).toThrow('Invalid control mode "deliberate-forever"');
  });

  it("rejects invalid max issues per pass", () => {
    expect(() =>
      parseStagedWorkflowCliArgs(["--max-issues-per-pass", "0"], {
        default: "gpt-5.4-mini",
      }),
    ).toThrow('Invalid --max-issues-per-pass value "0"');
  });

  it("rejects invalid synthesis trigger pass", () => {
    expect(() =>
      parseStagedWorkflowCliArgs(["--synthesis-after-review-pass", "0"], {
        default: "gpt-5.4-mini",
      }),
    ).toThrow('Invalid --synthesis-after-review-pass value "0"');
  });
});

describe("runStagedWorkflow", () => {
  it("returns early for --help", async () => {
    const result = await runStagedWorkflow(
      {
        entryFile: "/tmp/example.ts",
        createAgent: () => {
          throw new Error("should not run");
        },
        createSandboxProvider: () => {
          throw new Error("should not run");
        },
        stageFiles: {
          plan: "./plan.md",
          decide: "./decide.md",
          implement: "./implement.md",
          review: "./review.md",
          merge: "./merge.md",
        },
        models: { default: "gpt-5.4-mini" },
      },
      ["--help"],
    );

    expect(result).toBeUndefined();
  });

  it("runs preflight hook and exits for --preflight-only", async () => {
    let preflightCalls = 0;

    const result = await runStagedWorkflow(
      {
        entryFile: "/tmp/example.ts",
        createAgent: () => {
          throw new Error("should not run");
        },
        createSandboxProvider: () => {
          throw new Error("should not run");
        },
        stageFiles: {
          plan: "./plan.md",
          decide: "./decide.md",
          implement: "./implement.md",
          review: "./review.md",
          merge: "./merge.md",
        },
        models: { default: "gpt-5.4-mini" },
        preflight: () => {
          preflightCalls += 1;
        },
      },
      ["--preflight-only"],
    );

    expect(preflightCalls).toBe(1);
    expect(result).toEqual({
      processedIssues: [],
      mergedIssues: [],
      logFile: undefined,
    });
  });
});

describe("staged workflow contract and result helpers", () => {
  const contract = buildStagedWorkflowIssueContract({
    issue: {
      id: "123",
      title: "Keep staged workflow simple",
      branch: "issue-123",
    },
    targetBranch: "main",
    backlogContext: `# Issue 123

## Acceptance criteria
- reviewer sees the real diff
- implementer and reviewer share the same contract`,
  });

  it("builds a lightweight contract with extracted acceptance criteria", () => {
    expect(contract.issue.targetBranch).toBe("main");
    expect(contract.acceptanceCriteria).toEqual([
      { id: "AC-1", text: "reviewer sees the real diff" },
      {
        id: "AC-2",
        text: "implementer and reviewer share the same contract",
      },
    ]);
  });

  it("parses a valid implementation_result envelope", () => {
    const result = parseImplementationResultEnvelope(
      `<implementation_result>${JSON.stringify({
        status: "complete",
        summary: "done",
        acceptance: contract.acceptanceCriteria.map((criterion) => ({
          id: criterion.id,
          status: "done",
          evidence: "covered",
          files: ["src/stagedWorkflow.ts"],
        })),
        commands: [
          {
            command: "npm test",
            result: "passed",
            notes: "ok",
          },
        ],
      })}</implementation_result>`,
      contract,
    );

    expect(result.status).toBe("complete");
    expect(result.acceptance).toHaveLength(2);
  });

  it("rejects implementation_result when a contract row is missing", () => {
    expect(() =>
      parseImplementationResultEnvelope(
        `<implementation_result>${JSON.stringify({
          status: "complete",
          summary: "done",
          acceptance: [
            {
              id: "AC-1",
              status: "done",
              evidence: "covered",
              files: ["src/stagedWorkflow.ts"],
            },
          ],
          commands: [],
        })}</implementation_result>`,
        contract,
      ),
    ).toThrow("implementation_result missing acceptance rows: AC-2");
  });

  it("rejects implementation_result rows with missing evidence", () => {
    expect(() =>
      parseImplementationResultEnvelope(
        `<implementation_result>${JSON.stringify({
          status: "complete",
          summary: "done",
          acceptance: contract.acceptanceCriteria.map((criterion) => ({
            id: criterion.id,
            status: "done",
            evidence: "",
            files: ["src/stagedWorkflow.ts"],
          })),
          commands: [],
        })}</implementation_result>`,
        contract,
      ),
    ).toThrow(
      "implementation_result acceptance AC-1 requires non-empty evidence.",
    );
  });

  it("rejects implementation_result command rows with invalid result", () => {
    expect(() =>
      parseImplementationResultEnvelope(
        `<implementation_result>${JSON.stringify({
          status: "complete",
          summary: "done",
          acceptance: contract.acceptanceCriteria.map((criterion) => ({
            id: criterion.id,
            status: "done",
            evidence: "covered",
            files: ["src/stagedWorkflow.ts"],
          })),
          commands: [
            {
              command: "npm test",
              result: "green",
              notes: "bad enum",
            },
          ],
        })}</implementation_result>`,
        contract,
      ),
    ).toThrow(
      "implementation_result command npm test has invalid result green.",
    );
  });

  it("parses a valid review_result envelope", () => {
    const result = parseReviewResultEnvelope(
      `<review_result>${JSON.stringify({
        status: "approve",
        summary: "looks good",
        acceptance: contract.acceptanceCriteria.map((criterion) => ({
          id: criterion.id,
          status: "pass",
          finding: "",
          required_change: "",
        })),
        findings: [],
      })}</review_result>`,
      contract,
    );

    expect(result.status).toBe("approve");
  });

  it("rejects review approval with a blocking finding", () => {
    expect(() =>
      parseReviewResultEnvelope(
        `<review_result>${JSON.stringify({
          status: "approve",
          summary: "not actually good",
          acceptance: contract.acceptanceCriteria.map((criterion) => ({
            id: criterion.id,
            status: "pass",
            finding: "",
            required_change: "",
          })),
          findings: [
            {
              severity: "blocking",
              file: "src/stagedWorkflow.ts",
              line: 123,
              issue: "wrong diff base",
              suggested_fix: "use TARGET_BRANCH",
            },
          ],
        })}</review_result>`,
        contract,
      ),
    ).toThrow(
      "review_result approved work with failing acceptance rows or blocking findings.",
    );
  });

  it("rejects review findings with invalid severity", () => {
    expect(() =>
      parseReviewResultEnvelope(
        `<review_result>${JSON.stringify({
          status: "changes_required",
          summary: "bad severity",
          acceptance: contract.acceptanceCriteria.map((criterion) => ({
            id: criterion.id,
            status: "fail",
            finding: "needs work",
            required_change: "fix it",
          })),
          findings: [
            {
              severity: "critical",
              file: "src/stagedWorkflow.ts",
              line: 123,
              issue: "wrong severity enum",
              suggested_fix: "use blocking",
            },
          ],
        })}</review_result>`,
        contract,
      ),
    ).toThrow("review_result finding has invalid severity critical.");
  });

  it("parses merge_result envelopes", () => {
    const result = parseMergeResultEnvelope(
      `<merge_result>${JSON.stringify({
        status: "merged",
        summary: "merged issue 123",
        target_branch: "main",
        merged_issues: [{ issue_id: "123", branch: "issue-123" }],
      })}</merge_result>`,
    );

    expect(result.status).toBe("merged");
    expect(result.merged_issues?.[0]?.issue_id).toBe("123");
  });
});

describe("staged workflow prompt templates", () => {
  it("uses TARGET_BRANCH for staged review diffs and no longer closes issues in review", async () => {
    const prompt = await readFile(
      join(process.cwd(), "src/templates/staged-workflow/review-prompt.md"),
      "utf8",
    );

    expect(prompt).toContain("git diff {{TARGET_BRANCH}}...{{BRANCH}}");
    expect(prompt).toContain("git log {{TARGET_BRANCH}}..{{BRANCH}}");
    expect(prompt).not.toContain("glab issue close");
  });

  it("inlines contract and result content into active staged prompts", async () => {
    const [implementPrompt, reviewPrompt, reworkPrompt] = await Promise.all([
      readFile(
        join(
          process.cwd(),
          "src/templates/staged-workflow/implement-prompt.md",
        ),
        "utf8",
      ),
      readFile(
        join(process.cwd(), "src/templates/staged-workflow/review-prompt.md"),
        "utf8",
      ),
      readFile(
        join(
          process.cwd(),
          "src/templates/staged-workflow/review-rework-prompt.md",
        ),
        "utf8",
      ),
    ]);

    expect(implementPrompt).toContain("{{ISSUE_CONTRACT_MD}}");
    expect(implementPrompt).toContain("{{ISSUE_CONTRACT_JSON}}");
    expect(reviewPrompt).toContain("{{IMPLEMENTATION_RESULT_JSON}}");
    expect(reworkPrompt).toContain("{{PREVIOUS_REVIEW_RESULT_JSON}}");
  });

  it("uses TARGET_BRANCH for parallel planner review diffs", async () => {
    const prompt = await readFile(
      join(
        process.cwd(),
        "src/templates/parallel-planner-with-review/review-prompt.md",
      ),
      "utf8",
    );

    expect(prompt).toContain("git diff {{TARGET_BRANCH}}...{{BRANCH}}");
    expect(prompt).toContain("git log {{TARGET_BRANCH}}..{{BRANCH}}");
  });

  it("uses runtime taskCommands and does not inject TARGET_BRANCH into promptArgs", async () => {
    const source = await readFile(
      join(process.cwd(), "src/stagedWorkflow.ts"),
      "utf8",
    );

    expect(source).toContain("workflow.taskCommands?.view");
    expect(source).toContain("taskCommands: runtimeOptions.taskCommands");
    expect(source).not.toContain("TARGET_BRANCH: targetBranch");
  });
});

describe("staged workflow runtime paths", () => {
  it("creates a run-scoped artifact root from the item id", () => {
    const previousRunId = process.env.SANDCASTLE_RUN_ID;
    const previousArtifactRoot = process.env.SANDCASTLE_ARTIFACT_ROOT;
    delete process.env.SANDCASTLE_RUN_ID;
    delete process.env.SANDCASTLE_ARTIFACT_ROOT;
    try {
      const now = new Date("2026-05-19T06:03:33.901Z");
      expect(makeStagedWorkflowRunId(["--item-id", "296"], now)).toBe(
        "296-2026-05-19T06-03-33-901Z",
      );
      expect(
        resolveStagedWorkflowRuntimePaths({
          repoDir: "/repo",
          argv: ["--item-id", "296"],
          now,
        }),
      ).toEqual({
        runId: "296-2026-05-19T06-03-33-901Z",
        artifactRoot: "/repo/.sandcastle/runs/296-2026-05-19T06-03-33-901Z",
        logsDir: "/repo/.sandcastle/runs/296-2026-05-19T06-03-33-901Z/logs",
        mainLogFile:
          "/repo/.sandcastle/runs/296-2026-05-19T06-03-33-901Z/main.out",
      });
    } finally {
      if (previousRunId === undefined) {
        delete process.env.SANDCASTLE_RUN_ID;
      } else {
        process.env.SANDCASTLE_RUN_ID = previousRunId;
      }
      if (previousArtifactRoot === undefined) {
        delete process.env.SANDCASTLE_ARTIFACT_ROOT;
      } else {
        process.env.SANDCASTLE_ARTIFACT_ROOT = previousArtifactRoot;
      }
    }
  });

  it("honors an explicit artifact root", () => {
    const previousRunId = process.env.SANDCASTLE_RUN_ID;
    const previousArtifactRoot = process.env.SANDCASTLE_ARTIFACT_ROOT;
    process.env.SANDCASTLE_RUN_ID = "external-run";
    process.env.SANDCASTLE_ARTIFACT_ROOT = "/tmp/external-artifacts";
    try {
      expect(
        resolveStagedWorkflowRuntimePaths({
          repoDir: "/repo",
          argv: ["--item-id", "296"],
          now: new Date("2026-05-19T06:03:33.901Z"),
        }),
      ).toEqual({
        runId: "external-run",
        artifactRoot: "/tmp/external-artifacts",
        logsDir: "/tmp/external-artifacts/logs",
        mainLogFile: "/tmp/external-artifacts/main.out",
      });
    } finally {
      if (previousRunId === undefined) {
        delete process.env.SANDCASTLE_RUN_ID;
      } else {
        process.env.SANDCASTLE_RUN_ID = previousRunId;
      }
      if (previousArtifactRoot === undefined) {
        delete process.env.SANDCASTLE_ARTIFACT_ROOT;
      } else {
        process.env.SANDCASTLE_ARTIFACT_ROOT = previousArtifactRoot;
      }
    }
  });
});

describe("getStagedWorkflowTmuxPanes", () => {
  it("returns operator watcher panes with semantic log roles", () => {
    const panes = getStagedWorkflowTmuxPanes(
      "/repo",
      "sc-session",
      "/repo/.sandcastle/logs/top.log",
      "operator",
      undefined,
      "/repo/.sandcastle/runs/296-2026/logs",
    );

    expect(panes).toHaveLength(3);
    expect(panes[0]?.label).toBe("plan/merge logs");
    expect(panes[1]?.label).toBe("review/audit logs");
    expect(panes[2]?.label).toBe("implementer logs");
    expect(panes[0]?.shellCommand).toContain(
      "/repo/.sandcastle/runs/296-2026/logs",
    );
  });

  it("prefers explicit pane config over presets", () => {
    const panes = getStagedWorkflowTmuxPanes(
      "/repo",
      "sc-session",
      "/repo/.sandcastle/logs/top.log",
      "operator",
      [{ label: "custom pane", filterTokens: ["custom.log"] }],
    );

    expect(panes).toEqual([
      { label: "custom pane", filterTokens: ["custom.log"] },
    ]);
  });
});
