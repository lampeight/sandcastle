#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rawArgs = process.argv.slice(2);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const profileRoot = path.resolve(scriptDir, "..");

const consumeFlag = (args, flag) => {
  const next = [];
  let found = false;
  for (const arg of args) {
    if (arg === flag) {
      found = true;
      continue;
    }
    next.push(arg);
  }
  return { found, args: next };
};

const consumeOption = (args, option) => {
  const next = [];
  let value = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) {
      value = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith(`${option}=`)) {
      value = arg.slice(option.length + 1);
      continue;
    }
    next.push(arg);
  }
  return { value, args: next };
};

const shellEscape = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;

const sanitizeCodexPath = (pathValue) => {
  if (!pathValue) return "";
  return pathValue
    .split(":")
    .filter((entry) => {
      const normalized = entry.replace(/\/+$/, "");
      return (
        normalized !== "node_modules/.bin" &&
        !normalized.endsWith("/node_modules/.bin")
      );
    })
    .join(":");
};

const resolveTargetRepoRoot = (explicitTargetRepo, cwd, profileRootValue) => {
  if (explicitTargetRepo) return path.resolve(explicitTargetRepo);
  const resolvedCwd = path.resolve(cwd);
  const resolvedProfileRoot = path.resolve(profileRootValue);
  if (
    resolvedCwd === resolvedProfileRoot &&
    path.basename(resolvedCwd) === ".sandcastle"
  ) {
    return path.dirname(resolvedCwd);
  }
  return resolvedCwd;
};

const findItemId = (args) => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--item-id") return args[index + 1] ?? null;
    if (arg.startsWith("--item-id=")) return arg.slice("--item-id=".length);
  }
  return args.find((arg) => !arg.startsWith("-")) ?? null;
};

const makeRunId = (itemId) => {
  const base = itemId ? String(itemId) : "sandcastle";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${base}-${stamp}`;
};

const makeSessionName = (runId, explicitName) =>
  explicitName || `sandcastle-${runId}`;

const listSessionPanes = (sessionName) =>
  execFileSync(
    "tmux",
    [
      "list-panes",
      "-t",
      `${sessionName}:1`,
      "-F",
      "#{pane_id}\t#{pane_start_command}",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [paneId, startCommand] = line.split("\t");
      return { paneId: paneId ?? "", startCommand: startCommand ?? "" };
    });

const retitlePaneByCommand = (sessionName, matcher, title) => {
  const pane = listSessionPanes(sessionName).find((entry) =>
    matcher(entry.startCommand),
  );
  if (!pane?.paneId) return;
  execFileSync("tmux", ["select-pane", "-t", pane.paneId, "-T", title], {
    stdio: "ignore",
  });
};

const setTmuxOption = (sessionName, key, value, cwd) => {
  execFileSync("tmux", ["set-option", "-t", sessionName, key, value], {
    cwd,
    stdio: "ignore",
  });
};

const tmuxFlag = consumeFlag(rawArgs, "--tmux");
const tmuxOption = consumeOption(tmuxFlag.args, "--tmux-session");
const tmuxSessionNameOption = consumeOption(
  tmuxOption.args,
  "--tmux-session-name",
);
const tmuxLayoutOption = consumeOption(
  tmuxSessionNameOption.args,
  "--tmux-layout",
);
const targetRepoOption = consumeOption(tmuxLayoutOption.args, "--target-repo");
const passthroughArgs = targetRepoOption.args;
const targetRepoRoot = resolveTargetRepoRoot(
  targetRepoOption.value,
  process.cwd(),
  profileRoot,
);
const mainScriptPath = path.join(profileRoot, "main.mts");
const itemId = findItemId(passthroughArgs);
const runId = makeRunId(itemId);
const artifactParent =
  path.basename(targetRepoRoot) === ".sandcastle"
    ? targetRepoRoot
    : path.join(targetRepoRoot, ".sandcastle");
const artifactRoot = path.join(artifactParent, "runs", runId);
const logsDir = path.join(artifactRoot, "logs");
const childEnv = {
  ...process.env,
  PATH: sanitizeCodexPath(process.env.PATH),
  SANDCASTLE_PROFILE_ROOT: profileRoot,
  SANDCASTLE_RUN_ID: runId,
  SANDCASTLE_ARTIFACT_ROOT: artifactRoot,
};

if (!tmuxFlag.found) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", mainScriptPath, ...passthroughArgs],
    {
      cwd: targetRepoRoot,
      stdio: "inherit",
      env: childEnv,
    },
  );
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
} else {
  execFileSync("tmux", ["-V"], { stdio: "ignore" });

  const sessionName = makeSessionName(
    runId,
    tmuxSessionNameOption.value ?? tmuxOption.value,
  );
  childEnv.SANDCASTLE_TMUX_SESSION = sessionName;
  const logPath = path.join(artifactRoot, "main.out");
  const watcherPath = path.join(
    profileRoot,
    "scripts",
    "watch_sandcastle_logs.sh",
  );
  const tmuxLayout = tmuxLayoutOption.value ?? "full";
  const command = [
    `cd ${shellEscape(targetRepoRoot)}`,
    `mkdir -p ${shellEscape(logsDir)}`,
    `PATH=${shellEscape(childEnv.PATH)} SANDCASTLE_PROFILE_ROOT=${shellEscape(profileRoot)} SANDCASTLE_RUN_ID=${shellEscape(runId)} SANDCASTLE_ARTIFACT_ROOT=${shellEscape(artifactRoot)} SANDCASTLE_TMUX_SESSION=${shellEscape(sessionName)} node --import tsx ${shellEscape(mainScriptPath)} ${passthroughArgs.map(shellEscape).join(" ")} | tee ${shellEscape(logPath)}`,
  ].join(" && ");

  const newWatcherCommand = (filterTokens, label) =>
    `bash ${shellEscape(watcherPath)} ${shellEscape(logsDir)} ${shellEscape(filterTokens)} ${shellEscape(label)}`;

  execFileSync("tmux", ["new-session", "-d", "-s", sessionName, command], {
    cwd: targetRepoRoot,
    stdio: "ignore",
  });
  execFileSync(
    "tmux",
    [
      "split-window",
      "-t",
      sessionName,
      "-c",
      targetRepoRoot,
      "-h",
      newWatcherCommand("implementer", "implementer logs"),
    ],
    { cwd: targetRepoRoot, stdio: "ignore" },
  );

  if (tmuxLayout === "full") {
    execFileSync(
      "tmux",
      [
        "split-window",
        "-t",
        `${sessionName}:1.1`,
        "-c",
        targetRepoRoot,
        "-v",
        newWatcherCommand("planner,merger", "plan/merge logs"),
      ],
      { cwd: targetRepoRoot, stdio: "ignore" },
    );
    execFileSync(
      "tmux",
      [
        "split-window",
        "-t",
        `${sessionName}:1.2`,
        "-c",
        targetRepoRoot,
        "-v",
        newWatcherCommand("reviewer,auditor,repo-audit", "review/audit logs"),
      ],
      { cwd: targetRepoRoot, stdio: "ignore" },
    );
  }

  retitlePaneByCommand(
    sessionName,
    (commandText) =>
      commandText.includes(`node --import tsx ${shellEscape(mainScriptPath)}`),
    "main",
  );
  retitlePaneByCommand(
    sessionName,
    (commandText) => commandText.includes("'implementer logs'"),
    "implementer logs",
  );
  retitlePaneByCommand(
    sessionName,
    (commandText) => commandText.includes("'plan/merge logs'"),
    "plan/merge logs",
  );
  retitlePaneByCommand(
    sessionName,
    (commandText) => commandText.includes("'review/audit logs'"),
    "review/audit logs",
  );

  setTmuxOption(sessionName, "remain-on-exit", "on", targetRepoRoot);
  setTmuxOption(sessionName, "pane-border-status", "top", targetRepoRoot);
  setTmuxOption(
    sessionName,
    "pane-border-format",
    "#{pane_index}: #{pane_title}",
    targetRepoRoot,
  );
  setTmuxOption(sessionName, "pane-border-style", "fg=colour8", targetRepoRoot);
  setTmuxOption(
    sessionName,
    "pane-active-border-style",
    "fg=colour14",
    targetRepoRoot,
  );
  execFileSync(
    "tmux",
    [
      "select-layout",
      "-t",
      sessionName,
      tmuxLayout === "full" ? "tiled" : "even-vertical",
    ],
    { cwd: targetRepoRoot, stdio: "ignore" },
  );

  process.stdout.write(`Target repo: ${targetRepoRoot}\n`);
  process.stdout.write(`Profile repo: ${profileRoot}\n`);
  process.stdout.write(`Run ID: ${runId}\n`);
  process.stdout.write(`Artifact root: ${artifactRoot}\n`);
  process.stdout.write(`Started tmux session: ${sessionName}\n`);
  process.stdout.write(`Log file: ${logPath}\n`);
  process.stdout.write(`Tmux layout: ${tmuxLayout}\n`);
  process.stdout.write(`Attach: tmux attach -t ${sessionName}\n`);
  process.stdout.write(
    `Capture main pane: tmux capture-pane -pt ${sessionName}:1.1\n`,
  );
  process.stdout.write(
    `Capture implementer logs pane: tmux capture-pane -pt ${sessionName}:1.2\n`,
  );
  if (tmuxLayout === "full") {
    process.stdout.write(
      `Capture plan/merge logs pane: tmux capture-pane -pt ${sessionName}:1.3\n`,
    );
    process.stdout.write(
      `Capture review/audit logs pane: tmux capture-pane -pt ${sessionName}:1.4\n`,
    );
  }
}
