// @ts-nocheck
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type {
  CodexAuthSelectionContext,
  CodexAuthUserSelector,
} from "@ai-hero/sandcastle";
import {
  DEFAULT_STRICT_PRIMARY_REMAINING_PERCENT,
  DEFAULT_STRICT_SECONDARY_REMAINING_PERCENT,
  discoverAuthUsers,
  sanitizeCodexPath,
  selectUsageUser,
  strictUsageSelectionMessage,
  type UsageRow,
  type UsageSelection,
  type UsageThresholds,
} from "./auth-selection.mts";

export type AuthSelectionMode = "round-robin" | "soft" | "strict";

export const getAuthSelectionMode = (): AuthSelectionMode => {
  const mode = process.env.SANDCASTLE_AUTH_SELECTION_MODE?.trim();
  if (mode === "round-robin" || mode === "soft" || mode === "strict") {
    return mode;
  }
  return "strict";
};

export const parseUsageThresholds = (): UsageThresholds => ({
  primaryRemainingMin: Number.parseFloat(
    process.env.SANDCASTLE_STRICT_PRIMARY_REMAINING_MIN ??
      String(DEFAULT_STRICT_PRIMARY_REMAINING_PERCENT),
  ),
  secondaryRemainingMin: Number.parseFloat(
    process.env.SANDCASTLE_STRICT_SECONDARY_REMAINING_MIN ??
      String(DEFAULT_STRICT_SECONDARY_REMAINING_PERCENT),
  ),
});

export const loadUsageRows = (): UsageRow[] => {
  const result = spawnSync("codex-usage", ["--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: sanitizeCodexPath(process.env.PATH),
    },
  });
  const stdout = result.stdout?.trim() ?? "";
  if (!stdout) {
    throw new Error(result.stderr?.trim() || "codex-usage produced no stdout JSON");
  }
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("codex-usage did not return a JSON array");
  }
  return parsed as UsageRow[];
};

export const buildUsageSelectionSnapshot = (
  users?: readonly string[],
  thresholds = parseUsageThresholds(),
): UsageSelection => {
  const candidateUsers = users && users.length > 0 ? [...users] : discoverAuthUsers();
  const rows = loadUsageRows();
  return selectUsageUser(rows, candidateUsers, thresholds);
};

export const formatUsageSelection = (selection: UsageSelection): string[] => [
  ...(selection.eligibleUsers.length > 0
    ? [`[auth] eligible: ${selection.eligibleUsers.join(", ")}`]
    : ["[auth] eligible: none"]),
  ...selection.rejectedUsers.map(
    (row: { user: string; reason: string }) =>
      `[auth] rejected ${row.user}: ${row.reason}`,
  ),
  ...selection.erroredUsers.map(
    (row: { user: string; reason: string }) =>
      `[auth] error ${row.user}: ${row.reason}`,
  ),
  ...(selection.missingUsers.length > 0
    ? [`[auth] missing usage rows: ${selection.missingUsers.join(", ")}`]
    : []),
  selection.selectedUser
    ? `[auth] selected user: ${selection.selectedUser}`
    : "[auth] selected user: none",
];

export const printUsageSelection = (
  mode: AuthSelectionMode,
  selection: UsageSelection,
): void => {
  console.log(`[auth] selection mode: ${mode}`);
  for (const line of formatUsageSelection(selection)) {
    console.log(line);
  }
};

export const makeUsageUserSelector =
  (
    mode: Exclude<AuthSelectionMode, "round-robin">,
    options?: { thresholds?: UsageThresholds; onStrictFailure?: (message: string) => never },
  ): CodexAuthUserSelector =>
  async (context: CodexAuthSelectionContext): Promise<string | undefined> => {
    const thresholds = options?.thresholds ?? parseUsageThresholds();
    const selection = buildUsageSelectionSnapshot(context.users, thresholds);
    if (selection.selectedUser) return selection.selectedUser;
    if (mode === "soft") return undefined;
    const message = strictUsageSelectionMessage(selection, thresholds);
    if (options?.onStrictFailure) {
      return options.onStrictFailure(message);
    }
    throw new Error(message);
  };

export const defaultAuthLockDir = (): string =>
  join(process.env.HOME ?? "~", ".codex", "auth-rotation-state.json.lock");
