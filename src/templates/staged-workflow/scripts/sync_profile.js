#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const profileRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const PROFILE_FILES = [
  ".gitignore",
  "CODING_STANDARDS.md",
  "auth-rotation-lock.mts",
  "auth-selection.mts",
  "codex-auth.mts",
  "contract-audit.mts",
  "contract-results.mts",
  "implement-prompt.md",
  "issue-contract.mts",
  "issue-follow-up.mts",
  "issue-parent-refs.mts",
  "main.mts",
  "merge-prompt.md",
  "plan-prompt.md",
  "repo-audit.mts",
  "result-envelope.mts",
  "review-prompt.md",
  "run-state.mts",
  "smoke.mts",
  "startup-prune.mts",
];

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

export const syncProfile = (
  targetRepoRoot,
  outputDir = ".sandcastle-profile",
) => {
  const resolvedTarget = path.resolve(targetRepoRoot);
  const resolvedOutputDir = path.resolve(resolvedTarget, outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  for (const relativePath of PROFILE_FILES) {
    const sourcePath = path.join(profileRoot, relativePath);
    if (!fs.existsSync(sourcePath)) continue;
    const targetPath = path.join(resolvedOutputDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }

  const metadataPath = path.join(resolvedOutputDir, ".profile-source.json");
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        sourceRepo: profileRoot,
        targetRepo: resolvedTarget,
        outputDir,
        syncedAt: new Date().toISOString(),
        files: PROFILE_FILES,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return resolvedOutputDir;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const targetOption = consumeOption(process.argv.slice(2), "--target-repo");
  const outputOption = consumeOption(targetOption.args, "--output-dir");
  const targetRepo = targetOption.value ?? process.cwd();
  const outputDir = outputOption.value ?? ".sandcastle-profile";
  const resolvedTarget = syncProfile(targetRepo, outputDir);
  process.stdout.write(
    `Synced Sandcastle profile snapshot into: ${resolvedTarget}\n`,
  );
}
