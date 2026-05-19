import * as sandcastle from "@ai-hero/sandcastle";
import type {
  AgentProvider,
  PromptArgs,
  StagedWorkflowAgentStage,
  StagedWorkflowControlMode,
  StagedWorkflowPreparedIssue,
  StagedWorkflowPrepareIssueContext,
  StagedWorkflowModels,
  StagedWorkflowPreflightContext,
  StagedWorkflowTmuxLayoutPreset,
  StagedWorkflowTmuxOptions,
  StagedWorkflowTmuxPane,
} from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { fileURLToPath } from "node:url";
import type { SandboxProvider } from "@ai-hero/sandcastle";

const hooks = {
  sandbox: { onSandboxReady: [{ command: "{{SANDBOX_READY_COMMAND}}" }] },
};

const copyToWorktree = JSON.parse("{{COPY_TO_WORKTREE}}") as string[];

type LocalStagedWorkflowConfig = {
  createAgent?: (
    model: string,
    stage: StagedWorkflowAgentStage,
  ) => AgentProvider;
  createSandboxProvider?: () => SandboxProvider;
  prepareIssue?: (
    context: StagedWorkflowPrepareIssueContext,
  ) => Promise<StagedWorkflowPreparedIssue | void> | StagedWorkflowPreparedIssue | void;
  promptArgs?: PromptArgs;
  models?: Partial<StagedWorkflowModels>;
  preflight?: (context: StagedWorkflowPreflightContext) => Promise<void> | void;
  maxIssuesPerPass?: number;
  controlMode?: StagedWorkflowControlMode;
  synthesisAfterReviewPass?: number;
  auditEnabled?: boolean;
  issueContractFile?: string;
  copyToWorktree?: string[];
  tmuxLayoutPreset?: StagedWorkflowTmuxLayoutPreset;
  tmuxPanes?: readonly StagedWorkflowTmuxPane[];
  tmuxSessionOptions?: StagedWorkflowTmuxOptions;
  tmuxWindowOptions?: StagedWorkflowTmuxOptions;
};

const loadLocalConfig = async (): Promise<
  LocalStagedWorkflowConfig | undefined
> => {
  try {
    return (await import(
      new URL("./staged-workflow.config.mts", import.meta.url).href
    )) as LocalStagedWorkflowConfig;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("staged-workflow.config.mts") ||
        error.message.includes("ERR_MODULE_NOT_FOUND"))
    ) {
      return undefined;
    }
    throw error;
  }
};

const localConfig = await loadLocalConfig();
const defaultModels: StagedWorkflowModels = {
  default: "{{DEFAULT_MODEL}}",
  planner: "{{PLANNER_MODEL}}",
  decider: "{{DECIDER_MODEL}}",
  implementer: "{{IMPLEMENTER_MODEL}}",
  synthesizer: "{{IMPLEMENTER_MODEL}}",
  reviewer: "{{REVIEWER_MODEL}}",
  merger: "{{MERGER_MODEL}}",
  auditor: "{{AUDITOR_MODEL}}",
};

await sandcastle.runStagedWorkflow({
  entryFile: fileURLToPath(import.meta.url),
  createAgent:
    localConfig?.createAgent ?? ((model) => sandcastle.claudeCode(model)),
  createSandboxProvider:
    localConfig?.createSandboxProvider ?? (() => docker()),
  prepareIssue: localConfig?.prepareIssue,
  hooks,
  copyToWorktree: localConfig?.copyToWorktree ?? copyToWorktree,
  promptArgs: localConfig?.promptArgs,
  preflight: localConfig?.preflight,
  maxIssuesPerPass: localConfig?.maxIssuesPerPass ?? 1,
  controlMode: localConfig?.controlMode ?? "work-first",
  synthesisAfterReviewPass: localConfig?.synthesisAfterReviewPass,
  auditEnabled: localConfig?.auditEnabled ?? false,
  issueContractFile:
    localConfig?.issueContractFile ?? "./.sandcastle/issue-contract.md",
  tmuxLayoutPreset: localConfig?.tmuxLayoutPreset,
  tmuxPanes: localConfig?.tmuxPanes,
  tmuxSessionOptions: localConfig?.tmuxSessionOptions,
  tmuxWindowOptions: localConfig?.tmuxWindowOptions,
  stageFiles: {
    plan: "./.sandcastle/plan-prompt.md",
    decide: "./.sandcastle/decide-prompt.md",
    implement: "./.sandcastle/implement-prompt.md",
    synthesize: "./.sandcastle/implement-synthesis-prompt.md",
    review: "./.sandcastle/review-prompt.md",
    merge: "./.sandcastle/merge-prompt.md",
    audit: "./.sandcastle/audit-prompt.md",
  },
  models: { ...defaultModels, ...localConfig?.models },
});
