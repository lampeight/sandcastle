import { describe, expect, it } from "vitest";
import {
  getStagedWorkflowTmuxPanes,
  parseStagedWorkflowCliArgs,
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
        "--control-mode",
        "proof-first",
        "--max-issues-per-pass",
        "1",
        "--tmux",
        "--tmux-session-name",
        "sc-test",
      ],
      { default: "gpt-5.4-mini" },
    );

    expect(parsed.models.default).toBe("gpt-5.4");
    expect(parsed.models.planner).toBe("gpt-5.5");
    expect(parsed.controlMode).toBe("proof-first");
    expect(parsed.maxIssuesPerPass).toBe(1);
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

describe("getStagedWorkflowTmuxPanes", () => {
  it("returns operator watcher panes with semantic log roles", () => {
    const panes = getStagedWorkflowTmuxPanes(
      "/repo",
      "sc-session",
      "/repo/.sandcastle/logs/top.log",
      "operator",
    );

    expect(panes).toHaveLength(3);
    expect(panes[0]?.label).toBe("plan/merge logs");
    expect(panes[1]?.label).toBe("review/audit logs");
    expect(panes[2]?.label).toBe("implementer logs");
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
