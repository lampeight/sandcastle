import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SANDBOX_REPO_DIR } from "./SandboxFactory.js";

const GITIGNORE = `.env
logs/
runs/
worktrees/
`;

const ROOT_GITIGNORE_BLOCK = `# Sandcastle
.sandcastle/.env
.sandcastle/logs/
.sandcastle/runs/
.sandcastle/worktrees/
`;

export interface TemplateMetadata {
  name: string;
  description: string;
}

const TEMPLATES: TemplateMetadata[] = [
  {
    name: "blank",
    description: "Bare scaffold — write your own prompt and orchestration",
  },
  {
    name: "simple-loop",
    description: "Picks issues one by one and closes them",
  },
  {
    name: "sequential-reviewer",
    description:
      "Implements issues one by one, with a code review step after each",
  },
  {
    name: "parallel-planner",
    description:
      "Plans parallelizable issues, executes on separate branches, merges",
  },
  {
    name: "parallel-planner-with-review",
    description:
      "Plans parallelizable issues, executes with per-branch review, merges",
  },
  {
    name: "prd-campaign",
    description:
      "Runs a PRD campaign with implementer, reviewer, and final handoff phases",
  },
];

export const listTemplates = (): TemplateMetadata[] => TEMPLATES;

// ---------------------------------------------------------------------------
// Agent registry (internal — not part of public API)
// ---------------------------------------------------------------------------

export interface AgentEntry {
  readonly name: string;
  readonly label: string;
  readonly defaultModel: string;
  readonly factoryImport: string;
  readonly dockerfileTemplate: string;
  /** Lines to include in the generated `.env.example` for this agent's API key. */
  readonly envExample: string;
}

const CLAUDE_CODE_DOCKERFILE = `FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \\
  git \\
  curl \\
  jq \\
  ripgrep \\
  && rm -rf /var/lib/apt/lists/*

{{BACKLOG_MANAGER_TOOLS}}

{{PROFILE_TOOLS}}

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -g $AGENT_GID node && usermod -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER \${AGENT_UID}:\${AGENT_GID}

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Claude to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at ${SANDBOX_REPO_DIR}
# and overrides the working directory to ${SANDBOX_REPO_DIR} at container start.
# Structure your Dockerfile so that ${SANDBOX_REPO_DIR} can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
`;

const PI_DOCKERFILE = `FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \\
  git \\
  curl \\
  jq \\
  ripgrep \\
  && rm -rf /var/lib/apt/lists/*

{{BACKLOG_MANAGER_TOOLS}}

{{PROFILE_TOOLS}}

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -g $AGENT_GID node && usermod -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node

# Install pi coding agent (run as root before USER agent)
RUN npm install -g @mariozechner/pi-coding-agent

USER \${AGENT_UID}:\${AGENT_GID}

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at ${SANDBOX_REPO_DIR}
# and overrides the working directory to ${SANDBOX_REPO_DIR} at container start.
# Structure your Dockerfile so that ${SANDBOX_REPO_DIR} can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
`;

const CODEX_DOCKERFILE = `FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \\
  git \\
  curl \\
  jq \\
  ripgrep \\
  && rm -rf /var/lib/apt/lists/*

{{BACKLOG_MANAGER_TOOLS}}

{{PROFILE_TOOLS}}

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -g $AGENT_GID node && usermod -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node

# Install Codex CLI (run as root before USER agent)
RUN npm install -g @openai/codex

USER \${AGENT_UID}:\${AGENT_GID}

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at ${SANDBOX_REPO_DIR}
# and overrides the working directory to ${SANDBOX_REPO_DIR} at container start.
# Structure your Dockerfile so that ${SANDBOX_REPO_DIR} can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
`;

const OPENCODE_DOCKERFILE = `FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \\
  git \\
  curl \\
  jq \\
  ripgrep \\
  && rm -rf /var/lib/apt/lists/*

{{BACKLOG_MANAGER_TOOLS}}

{{PROFILE_TOOLS}}

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -g $AGENT_GID node && usermod -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node

# Install OpenCode CLI (run as root before USER agent)
RUN npm install -g opencode-ai@latest

USER \${AGENT_UID}:\${AGENT_GID}

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at \${SANDBOX_REPO_DIR}
# and overrides the working directory to \${SANDBOX_REPO_DIR} at container start.
# Structure your Dockerfile so that \${SANDBOX_REPO_DIR} can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
`;

const AGENT_REGISTRY: AgentEntry[] = [
  {
    name: "claude-code",
    label: "Claude Code",
    defaultModel: "claude-opus-4-6",
    factoryImport: "claudeCode",
    dockerfileTemplate: CLAUDE_CODE_DOCKERFILE,
    envExample: `# Anthropic API key
# If you want to use your Claude subscription instead of an API key, see https://github.com/mattpocock/sandcastle/issues/191
ANTHROPIC_API_KEY=`,
  },
  {
    name: "pi",
    label: "Pi",
    defaultModel: "claude-sonnet-4-6",
    factoryImport: "pi",
    dockerfileTemplate: PI_DOCKERFILE,
    envExample: `# Anthropic API key
ANTHROPIC_API_KEY=`,
  },
  {
    name: "codex",
    label: "Codex",
    defaultModel: "gpt-5.4-mini",
    factoryImport: "codex",
    dockerfileTemplate: CODEX_DOCKERFILE,
    envExample: `# Codex uses host auth by default.
# Sandcastle snapshots ~/.codex/auth.json into the sandbox when using the Codex agent.
# Optional: set OPENAI_KEY only if you explicitly want API-key auth instead of host auth.`,
  },
  {
    name: "opencode",
    label: "OpenCode",
    defaultModel: "opencode/big-pickle",
    factoryImport: "opencode",
    dockerfileTemplate: OPENCODE_DOCKERFILE,
    envExample: `# OpenCode API key
OPENCODE_API_KEY=`,
  },
];

export const listAgents = (): AgentEntry[] => AGENT_REGISTRY;

// ---------------------------------------------------------------------------
// Backlog manager registry (internal — not part of public API)
// ---------------------------------------------------------------------------

export interface BacklogManagerEntry {
  readonly name: string;
  readonly label: string;
  readonly templateArgs: Record<string, string>;
  /** Lines to append to `.env.example` for this backlog manager, or empty string if none needed. */
  readonly envExample: string;
}

const GITHUB_CLI_TOOLS = `# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \\
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \\
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \\
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \\
  && apt-get update && apt-get install -y gh \\
  && rm -rf /var/lib/apt/lists/*`;

const GITLAB_CLI_TOOLS = `# Install GitLab CLI
RUN GLAB_DEB_URL=$(curl -fsSL https://gitlab.com/api/v4/projects/34675721/releases/permalink/latest \\
  | jq -r '.assets.links[] | select(.name | endswith("linux_amd64.deb")) | .url') \\
  && curl -fsSL "$GLAB_DEB_URL" -o /tmp/glab.deb \\
  && apt-get update && apt-get install -y /tmp/glab.deb \\
  && rm -f /tmp/glab.deb \\
  && rm -rf /var/lib/apt/lists/*`;

const BEADS_TOOLS = `# Install system dependencies for Beads
RUN apt-get update && apt-get install -y \\
  dpkg-dev \\
  libicu72 \\
  && rm -rf /var/lib/apt/lists/* \\
  && ARCH_DIR=$(dpkg-architecture -qDEB_HOST_MULTIARCH) \\
  && for lib in /usr/lib/$ARCH_DIR/libicu*.so.72; do \\
       ln -s "$lib" "\${lib%.72}.74"; \\
     done

RUN curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash

RUN corepack enable`;

const BACKLOG_MANAGER_REGISTRY: BacklogManagerEntry[] = [
  {
    name: "github-issues",
    label: "GitHub Issues",
    templateArgs: {
      REPO_RESOLVER_COMMAND: `repo="\${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"`,
      LIST_TASKS_COMMAND: `gh issue list --state open --label Sandcastle --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`,
      VIEW_TASK_COMMAND: "gh issue view <ID>",
      CLOSE_TASK_COMMAND: `gh issue close <ID> --comment "Completed by Sandcastle"`,
      VIEW_PRD_COMMAND: `repo="\${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"; gh issue view --repo "$repo" "{{PRD_ID}}" --comments`,
      LIST_CHILDREN_COMMAND: `repo="\${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"; gh issue list --repo "$repo" --state open --label "{{READY_LABEL}}" --json number,title,body,labels,comments --jq '[.[] | {id: (.number | tostring), title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`,
      VIEW_CHILD_COMMAND: `repo="\${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"; gh issue view --repo "$repo" "{{TASK_ID}}" --comments`,
      COMMENT_CHILD_COMMAND: `repo="\${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"; gh issue comment --repo "$repo" "{{TASK_ID}}" --body-file -`,
      CLOSE_CHILD_COMMAND: `repo="\${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"; gh issue close --repo "$repo" "{{TASK_ID}}" --comment "Accepted by Sandcastle reviewer"`,
      BACKLOG_MANAGER_TOOLS: GITHUB_CLI_TOOLS,
    },
    envExample: `# GitHub personal access token
GITHUB_TOKEN=
GH_TOKEN=
# GitHub repository in owner/name form. If omitted, Sandcastle falls back to gh repo view.
GITHUB_REPOSITORY=`,
  },
  {
    name: "beads",
    label: "Beads",
    templateArgs: {
      REPO_RESOLVER_COMMAND: "",
      LIST_TASKS_COMMAND: "bd ready --json",
      VIEW_TASK_COMMAND: "bd show <ID>",
      CLOSE_TASK_COMMAND: `bd close <ID> "Completed by Sandcastle"`,
      VIEW_PRD_COMMAND: "bd show {{PRD_ID}}",
      LIST_CHILDREN_COMMAND: "bd ready --json",
      VIEW_CHILD_COMMAND: "bd show {{TASK_ID}}",
      COMMENT_CHILD_COMMAND: "cat >/dev/null",
      CLOSE_CHILD_COMMAND: `bd close "{{TASK_ID}}" "Accepted by Sandcastle reviewer"`,
      BACKLOG_MANAGER_TOOLS: BEADS_TOOLS,
    },
    envExample: "",
  },
  {
    name: "gitlab",
    label: "GitLab Issues",
    templateArgs: {
      REPO_RESOLVER_COMMAND: `repo="\${GITLAB_REPO:-$(git remote get-url origin)}"`,
      LIST_TASKS_COMMAND: `repo="\${GITLAB_REPO:-$(git remote get-url origin)}"; glab issue list -R "$repo" --label ready-for-agent -O json -P 100`,
      VIEW_TASK_COMMAND: `repo="\${GITLAB_REPO:-$(git remote get-url origin)}"; glab issue view -R "$repo" <ID>`,
      CLOSE_TASK_COMMAND: `sh -lc 'repo="\${GITLAB_REPO:-$(git remote get-url origin)}" && glab issue note -R "$repo" <ID> -m "Completed by Sandcastle" && glab issue close -R "$repo" <ID>'`,
      VIEW_PRD_COMMAND: `repo="\${GITLAB_REPO:-$(git remote get-url origin)}"; glab issue view -R "$repo" "{{PRD_ID}}" --comments`,
      LIST_CHILDREN_COMMAND: `repo="\${GITLAB_REPO:-$(git remote get-url origin)}"; glab issue list -R "$repo" --label "{{READY_LABEL}}" -O json -P 100`,
      VIEW_CHILD_COMMAND: `repo="\${GITLAB_REPO:-$(git remote get-url origin)}"; glab issue view -R "$repo" "{{TASK_ID}}" --comments`,
      COMMENT_CHILD_COMMAND: `repo="\${GITLAB_REPO:-$(git remote get-url origin)}"; glab issue note -R "$repo" "{{TASK_ID}}" -m "$(cat)"`,
      CLOSE_CHILD_COMMAND: `repo="\${GITLAB_REPO:-$(git remote get-url origin)}"; glab issue note -R "$repo" "{{TASK_ID}}" -m "Accepted by Sandcastle reviewer"; glab issue close -R "$repo" "{{TASK_ID}}"`,
      BACKLOG_MANAGER_TOOLS: GITLAB_CLI_TOOLS,
    },
    envExample: `# GitLab personal access token
GITLAB_TOKEN=
# GitLab repository path. If omitted, Sandcastle falls back to git remote get-url origin.
GITLAB_REPO=`,
  },
];

export const listBacklogManagers = (): BacklogManagerEntry[] =>
  BACKLOG_MANAGER_REGISTRY;

export const getBacklogManager = (
  name: string,
): BacklogManagerEntry | undefined =>
  BACKLOG_MANAGER_REGISTRY.find((b) => b.name === name);

export const getAgent = (name: string): AgentEntry | undefined =>
  AGENT_REGISTRY.find((a) => a.name === name);

// ---------------------------------------------------------------------------
// Project profile registry (internal — not part of public API)
// ---------------------------------------------------------------------------

export interface ProjectProfileEntry {
  readonly name: string;
  readonly label: string;
  readonly templateArgs: Record<string, string>;
}

const PYTHON_UV_TOOLS = `# Install Python, make, and uv for Python/uv projects
RUN apt-get update && apt-get install -y \\
  make \\
  python3 \\
  python3-venv \\
  python3-pip \\
  python-is-python3 \\
  && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

ENV PATH="/home/agent/workspace/.venv/bin:/home/agent/.local/bin:\${PATH}"`;

const PROJECT_PROFILE_REGISTRY: ProjectProfileEntry[] = [
  {
    name: "node-npm",
    label: "Node / npm",
    templateArgs: {
      PROFILE_NAME: "node-npm",
      PROFILE_TOOLS: "",
      SANDBOX_READY_COMMAND: "npm install",
      COPY_TO_WORKTREE: `["node_modules"]`,
      TARGETED_VERIFY_COMMAND: "npm run test",
      BROAD_VERIFY_COMMAND: "npm run test",
    },
  },
  {
    name: "python-uv",
    label: "Python / uv",
    templateArgs: {
      PROFILE_NAME: "python-uv",
      PROFILE_TOOLS: PYTHON_UV_TOOLS,
      SANDBOX_READY_COMMAND:
        "mkdir -p .cache/uv; export UV_CACHE_DIR=$PWD/.cache/uv; uv sync --frozen --all-extras",
      COPY_TO_WORKTREE: "[]",
      TARGETED_VERIFY_COMMAND: "uv run python -m pytest -q",
      BROAD_VERIFY_COMMAND: "make ci",
    },
  },
  {
    name: "generic",
    label: "Generic",
    templateArgs: {
      PROFILE_NAME: "generic",
      PROFILE_TOOLS: "",
      SANDBOX_READY_COMMAND: "true",
      COPY_TO_WORKTREE: "[]",
      TARGETED_VERIFY_COMMAND: "true",
      BROAD_VERIFY_COMMAND: "true",
    },
  },
];

export const listProjectProfiles = (): ProjectProfileEntry[] =>
  PROJECT_PROFILE_REGISTRY;

export const getProjectProfile = (
  name: string,
): ProjectProfileEntry | undefined =>
  PROJECT_PROFILE_REGISTRY.find((p) => p.name === name);

// ---------------------------------------------------------------------------
// Sandbox provider registry (internal — not part of public API)
// ---------------------------------------------------------------------------

export interface SandboxProviderEntry {
  readonly name: string;
  readonly label: string;
  /** Filename written to .sandcastle/ (e.g. "Dockerfile" or "Containerfile") */
  readonly containerfileName: string;
  /** CLI namespace for build/remove commands (e.g. "docker" or "podman") */
  readonly cliNamespace: string;
}

const SANDBOX_PROVIDER_REGISTRY: SandboxProviderEntry[] = [
  {
    name: "docker",
    label: "Docker",
    containerfileName: "Dockerfile",
    cliNamespace: "docker",
  },
  {
    name: "podman",
    label: "Podman",
    containerfileName: "Containerfile",
    cliNamespace: "podman",
  },
];

export const listSandboxProviders = (): SandboxProviderEntry[] =>
  SANDBOX_PROVIDER_REGISTRY;

export const getSandboxProvider = (
  name: string,
): SandboxProviderEntry | undefined =>
  SANDBOX_PROVIDER_REGISTRY.find((p) => p.name === name);

// ---------------------------------------------------------------------------
// Next steps
// ---------------------------------------------------------------------------

export function getNextStepsLines(
  template: string,
  mainFilename: string,
): string[] {
  if (template === "prd-campaign") {
    return [
      "Next steps:",
      "1. Copy .sandcastle/.env.example to .sandcastle/.env and fill required tokens",
      `2. Add "sandcastle": "tsx .sandcastle/${mainFilename}" to package.json scripts if init did not do it`,
      `3. Review .sandcastle/README.md and .sandcastle/config.json`,
      "4. Run `npm run sandcastle -- --prd-id <ID>`",
    ];
  }
  if (template === "blank") {
    return [
      "Next steps:",
      `1. Set the required env vars in .sandcastle/.env (see .sandcastle/.env.example)`,
      "   If you want to use your Claude subscription instead of an API key, see https://github.com/mattpocock/sandcastle/issues/191",
      "2. Read and customize .sandcastle/prompt.md to describe what you want the agent to do",
      `3. Customize .sandcastle/${mainFilename} — it uses the JS API (\`run()\`) to control how the agent runs`,
      `4. Add "sandcastle": "npx tsx .sandcastle/${mainFilename}" to your package.json scripts`,
      "5. Run `npm run sandcastle` to start the agent",
    ];
  } else {
    const hasReviewer = template.includes("review");
    let step = 1;
    const lines: string[] = [
      "Next steps:",
      `${step++}. Set the required env vars in .sandcastle/.env (see .sandcastle/.env.example)`,
      "   If you want to use your Claude subscription instead of an API key, see https://github.com/mattpocock/sandcastle/issues/191",
      `${step++}. Add "sandcastle": "npx tsx .sandcastle/${mainFilename}" to your package.json scripts`,
      `${step++}. Templates use \`copyToWorktree: ["node_modules"]\` to copy your host node_modules into the sandbox for fast startup — the \`npm install\` in the onSandboxReady hook is a safety net for platform-specific binaries. Adjust both if you use a different package manager`,
      `${step++}. Read and customize the prompt files in .sandcastle/ — they shape what the agent does`,
    ];
    if (hasReviewer) {
      lines.push(
        `${step++}. Customize .sandcastle/CODING_STANDARDS.md with your project's standards — the reviewer agent loads it during review`,
      );
    }
    lines.push(`${step++}. Run \`npm run sandcastle\` to start the agent`);
    return lines;
  }
}

// ---------------------------------------------------------------------------
// Scaffolding helpers
// ---------------------------------------------------------------------------

function getTemplatesDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), "templates");
}

const getTemplateDir = (
  templateName: string,
): Effect.Effect<string, Error, never> =>
  Effect.gen(function* () {
    const template = TEMPLATES.find((t) => t.name === templateName);
    if (!template) {
      const names = TEMPLATES.map((t) => t.name).join(", ");
      yield* Effect.fail(
        new Error(`Unknown template: "${templateName}". Available: ${names}`),
      );
    }
    return join(getTemplatesDir(), templateName);
  });

const COMPILED_FILE_EXTENSIONS = [
  ".js",
  ".js.map",
  ".d.ts",
  ".d.ts.map",
  ".mjs",
  ".mjs.map",
  ".d.mts",
  ".d.mts.map",
];

const copyTemplateFiles = (
  templateDir: string,
  destDir: string,
  mainFilename: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = yield* fs
      .readDirectory(templateDir)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    yield* Effect.all(
      files
        .filter(
          (f) =>
            f !== "template.json" &&
            f !== ".env.example" &&
            !COMPILED_FILE_EXTENSIONS.some((ext) => f.endsWith(ext)),
        )
        .map((f) => {
          const destName = f === "main.mts" ? mainFilename : f;
          return fs
            .copyFile(join(templateDir, f), join(destDir, destName))
            .pipe(Effect.mapError((e) => new Error(e.message)));
        }),
      { concurrency: "unbounded" },
    );
  });

/**
 * Replace the agent factory import and call in a scaffolded main.ts.
 *
 * Templates use `claudeCode` as the default factory. When a different agent or
 * model is selected, this function rewrites the import and factory calls.
 */
const rewriteMainTs = (
  configDir: string,
  agent: AgentEntry,
  model: string,
  mainFilename: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const mainTsPath = join(configDir, mainFilename);

    const exists = yield* fs
      .exists(mainTsPath)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    if (!exists) return;

    let content = yield* fs
      .readFileString(mainTsPath)
      .pipe(Effect.mapError((e) => new Error(e.message)));

    // Templates use main.mts as the canonical filename in comments.
    // When the target is main.ts, rewrite those references.
    if (mainFilename === "main.ts") {
      content = content.replace(/main\.mts/g, "main.ts");
    }

    // Replace factory function name in imports (e.g. claudeCode → pi)
    // and all factory calls with the correct model.
    // Templates always use claudeCode as the placeholder factory.
    content = content.replace(/\bclaudeCode\b/g, agent.factoryImport);
    // Replace model strings in factory calls: factoryImport("any-model")
    const factoryCallRe = new RegExp(
      `${agent.factoryImport}\\(["']([^"']+)["']\\)`,
      "g",
    );
    content = content.replace(
      factoryCallRe,
      `${agent.factoryImport}("${model}")`,
    );
    content = content.replace(/"claude-(opus|sonnet)-4-6"/g, `"${model}"`);
    if (agent.name === "codex") {
      content = content.replace(
        /codex\(([^,\n]+)\)/g,
        "codex($1, { hostAuth: true })",
      );
    }

    yield* fs
      .writeFileString(mainTsPath, content)
      .pipe(Effect.mapError((e) => new Error(e.message)));
  });

/**
 * When the user opted out of the Sandcastle label, strip ` --label Sandcastle`
 * from all `.md` files in the scaffolded config directory so that `gh issue list`
 * commands work without a label filter.
 */
const rewritePromptFiles = (
  configDir: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = yield* fs
      .readDirectory(configDir)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    yield* Effect.all(
      mdFiles.map((f) =>
        Effect.gen(function* () {
          const filePath = join(configDir, f);
          const content = yield* fs
            .readFileString(filePath)
            .pipe(Effect.mapError((e) => new Error(e.message)));
          const updated = content.replace(/ --label Sandcastle/g, "");
          if (updated !== content) {
            yield* fs
              .writeFileString(filePath, updated)
              .pipe(Effect.mapError((e) => new Error(e.message)));
          }
        }),
      ),
      { concurrency: "unbounded" },
    );
  });

/** Text file extensions eligible for `{{KEY}}` template argument substitution. */
const TEXT_FILE_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".env",
  ".example",
  ".json",
  ".mts",
  ".ts",
  // Dockerfile / Containerfile have no extension — handled by name check below
]);

const isTextFile = (filename: string): boolean => {
  if (
    filename === "Dockerfile" ||
    filename === "Containerfile" ||
    filename === ".gitignore"
  )
    return true;
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) return false;
  return TEXT_FILE_EXTENSIONS.has(filename.slice(dotIdx));
};

/**
 * Replace `{{KEY}}` template arguments from the backlog manager's
 * `templateArgs` map in all text files in the scaffolded config directory.
 */
const substituteTemplateArgs = (
  configDir: string,
  templateArgs: Record<string, string>,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = yield* fs
      .readDirectory(configDir)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    const textFiles = files.filter(isTextFile);
    yield* Effect.all(
      textFiles.map((f) =>
        Effect.gen(function* () {
          const filePath = join(configDir, f);
          let content = yield* fs
            .readFileString(filePath)
            .pipe(Effect.mapError((e) => new Error(e.message)));
          const original = content;
          for (const [key, value] of Object.entries(templateArgs)) {
            content = content.replace(
              new RegExp(`\\{\\{${key}\\}\\}`, "g"),
              value,
            );
          }
          if (content !== original) {
            yield* fs
              .writeFileString(filePath, content)
              .pipe(Effect.mapError((e) => new Error(e.message)));
          }
        }),
      ),
      { concurrency: "unbounded" },
    );
  });

// ---------------------------------------------------------------------------
// Main scaffold function
// ---------------------------------------------------------------------------

export interface ScaffoldOptions {
  agent: AgentEntry;
  model: string;
  templateName?: string;
  createLabel?: boolean;
  backlogManager?: BacklogManagerEntry;
  sandboxProvider?: SandboxProviderEntry;
  projectProfile?: ProjectProfileEntry;
  repo?: string;
  readyLabel?: string;
  writePackageJson?: boolean;
  sandcastlePackage?: string;
}

export interface ScaffoldResult {
  mainFilename: string;
}

const detectRepoSlug = (
  repoDir: string,
): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const gitConfigPath = join(repoDir, ".git", "config");
    const content = yield* fs
      .readFileString(gitConfigPath)
      .pipe(Effect.orElseSucceed(() => ""));
    const match = content.match(
      /url = (?:git@github\.com:|https:\/\/github\.com\/)([^/\s]+\/[^/\s.]+)(?:\.git)?/,
    );
    return match?.[1] ?? "";
  });

const writeRepoReadme = (
  configDir: string,
  options: {
    templateName: string;
    profile: ProjectProfileEntry;
    backlogManager: BacklogManagerEntry;
    mainFilename: string;
    readyLabel: string;
    repo: string;
  },
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = `# Sandcastle

Generated setup.

- Template: \`${options.templateName}\`
- Profile: \`${options.profile.name}\`
- Backlog manager: \`${options.backlogManager.name}\`
- Repository: \`${options.repo || "detected at runtime"}\`
- Ready label: \`${options.readyLabel}\`

## Run

\`\`\`bash
npm run sandcastle -- --prd-id <ID>
\`\`\`

Positional PRD id is also accepted:

\`\`\`bash
npm run sandcastle -- <ID>
\`\`\`

## Environment

Copy \`.sandcastle/.env.example\` to \`.sandcastle/.env\` and fill required values.
Never commit \`.sandcastle/.env\`.

## Artifacts

- Logs: \`.sandcastle/logs/\`
- Run artifacts: \`.sandcastle/runs/\`
- Worktrees: \`.sandcastle/worktrees/\`

## Image

\`\`\`bash
sandcastle ${options.backlogManager.name === "gitlab" ? "docker" : "docker"} build-image
\`\`\`

## Cleanup

Remove stale campaign worktrees with:

\`\`\`bash
git worktree list
git worktree remove --force <path>
\`\`\`
`;
    yield* fs
      .writeFileString(join(configDir, "README.md"), content)
      .pipe(Effect.mapError((e) => new Error(e.message)));
  });

const writeCampaignConfig = (
  configDir: string,
  config: Record<string, unknown>,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .writeFileString(
        join(configDir, "config.json"),
        `${JSON.stringify(config, null, 2)}\n`,
      )
      .pipe(Effect.mapError((e) => new Error(e.message)));
  });

const updateRootGitignore = (
  repoDir: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = join(repoDir, ".gitignore");
    const existing = yield* fs
      .readFileString(path)
      .pipe(Effect.orElseSucceed(() => ""));
    if (existing.includes(".sandcastle/.env")) return;
    const separator = existing.trim() ? "\n\n" : "";
    yield* fs
      .writeFileString(path, `${existing}${separator}${ROOT_GITIGNORE_BLOCK}`)
      .pipe(Effect.mapError((e) => new Error(e.message)));
  });

const updatePackageJson = (
  repoDir: string,
  mainFilename: string,
  sandcastlePackage: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = join(repoDir, "package.json");
    const existing = yield* fs
      .readFileString(path)
      .pipe(Effect.orElseSucceed(() => ""));
    let pkg: Record<string, unknown> = {};
    try {
      pkg = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
    } catch {
      yield* Effect.fail(new Error("package.json is not valid JSON."));
    }
    const scripts =
      typeof pkg.scripts === "object" && pkg.scripts !== null
        ? (pkg.scripts as Record<string, unknown>)
        : {};
    scripts.sandcastle = `tsx .sandcastle/${mainFilename}`;
    pkg.scripts = scripts;
    const devDependencies =
      typeof pkg.devDependencies === "object" && pkg.devDependencies !== null
        ? (pkg.devDependencies as Record<string, unknown>)
        : {};
    devDependencies["@ai-hero/sandcastle"] = sandcastlePackage;
    devDependencies.tsx = devDependencies.tsx ?? "^4.21.0";
    pkg.devDependencies = devDependencies;
    yield* fs
      .writeFileString(path, `${JSON.stringify(pkg, null, 2)}\n`)
      .pipe(Effect.mapError((e) => new Error(e.message)));
  });

/**
 * Detect whether the project's package.json has `"type": "module"`.
 * If so, we can use plain `.ts`; otherwise we use `.mts` to ensure ESM.
 */
const detectMainFilename = (
  repoDir: string,
): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pkgPath = join(repoDir, "package.json");
    const exists = yield* fs
      .exists(pkgPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!exists) return "main.mts";
    const content = yield* fs
      .readFileString(pkgPath)
      .pipe(Effect.orElseSucceed(() => ""));
    try {
      const pkg = JSON.parse(content) as Record<string, unknown>;
      return pkg["type"] === "module" ? "main.ts" : "main.mts";
    } catch {
      return "main.mts";
    }
  });

export const scaffold = (
  repoDir: string,
  options: ScaffoldOptions,
): Effect.Effect<ScaffoldResult, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const {
      agent,
      model,
      templateName = "blank",
      createLabel = true,
      backlogManager = BACKLOG_MANAGER_REGISTRY[0]!, // default: github-issues
      sandboxProvider = SANDBOX_PROVIDER_REGISTRY[0]!, // default: docker
      projectProfile = PROJECT_PROFILE_REGISTRY[0]!, // default: node-npm
      repo,
      readyLabel = templateName === "prd-campaign"
        ? "ready-for-agent"
        : "Sandcastle",
      writePackageJson = false,
      sandcastlePackage = "npm:@lampeight/sandcastle@0.5.10-lampeight.1",
    } = options;
    const fs = yield* FileSystem.FileSystem;
    const configDir = join(repoDir, ".sandcastle");

    const exists = yield* fs
      .exists(configDir)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    if (exists) {
      yield* Effect.fail(
        new Error(
          ".sandcastle/ directory already exists. Remove it first if you want to re-initialize.",
        ),
      );
    }

    const mainFilename = yield* detectMainFilename(repoDir);

    yield* fs
      .makeDirectory(configDir, { recursive: false })
      .pipe(Effect.mapError((e) => new Error(e.message)));

    const templateDir = yield* getTemplateDir(templateName);
    const detectedRepo = repo ?? (yield* detectRepoSlug(repoDir));
    const templateArgs = {
      ...backlogManager.templateArgs,
      ...projectProfile.templateArgs,
      REPO: detectedRepo,
      READY_LABEL: readyLabel,
    };

    // Build .env.example from agent + backlog manager env blocks
    const envExampleParts = [agent.envExample];
    if (backlogManager.envExample) {
      envExampleParts.push(backlogManager.envExample);
    }
    let envExampleContent = envExampleParts.join("\n") + "\n";
    if (detectedRepo) {
      envExampleContent = envExampleContent
        .replace("GITHUB_REPOSITORY=", `GITHUB_REPOSITORY=${detectedRepo}`)
        .replace("GITLAB_REPO=", `GITLAB_REPO=${detectedRepo}`);
    }

    yield* Effect.all(
      [
        fs
          .writeFileString(
            join(configDir, sandboxProvider.containerfileName),
            agent.dockerfileTemplate,
          )
          .pipe(Effect.mapError((e) => new Error(e.message))),
        fs
          .writeFileString(join(configDir, ".gitignore"), GITIGNORE)
          .pipe(Effect.mapError((e) => new Error(e.message))),
        fs
          .writeFileString(join(configDir, ".env.example"), envExampleContent)
          .pipe(Effect.mapError((e) => new Error(e.message))),
        copyTemplateFiles(templateDir, configDir, mainFilename),
      ],
      { concurrency: "unbounded" },
    );

    // Rewrite main file with the selected agent factory and model
    yield* rewriteMainTs(configDir, agent, model, mainFilename);

    // Replace backlog manager template arguments in all text files (must run before label stripping)
    yield* substituteTemplateArgs(configDir, templateArgs);

    yield* writeRepoReadme(configDir, {
      templateName,
      profile: projectProfile,
      backlogManager,
      mainFilename,
      readyLabel,
      repo: detectedRepo,
    });

    if (templateName === "prd-campaign") {
      yield* writeCampaignConfig(configDir, {
        template: templateName,
        profile: projectProfile.name,
        backlogManager: backlogManager.name,
        repo: detectedRepo,
        readyLabel,
        main: mainFilename,
      });
    }

    // Strip --label Sandcastle from prompt files only for GitHub issue scaffolds
    // when the user explicitly declined label creation.
    if (!createLabel && backlogManager.name === "github-issues") {
      yield* rewritePromptFiles(configDir);
    }

    yield* updateRootGitignore(repoDir);

    if (writePackageJson) {
      yield* updatePackageJson(repoDir, mainFilename, sandcastlePackage);
    }

    return { mainFilename };
  });
