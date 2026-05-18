import { readdirSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_STRICT_PRIMARY_REMAINING_PERCENT = 20;
export const DEFAULT_STRICT_SECONDARY_REMAINING_PERCENT = 0;

export type UsageRateLimit = {
  usedPercent?: number;
  windowDurationMins?: number;
};

export type UsageRow = {
  user?: string;
  error?: string | null;
  email?: string | null;
  active?: boolean;
  rateLimits?: {
    primary?: UsageRateLimit;
    secondary?: UsageRateLimit;
    rateLimitReachedType?: string | null;
  } | null;
};

export type UsageThresholds = {
  primaryRemainingMin: number;
  secondaryRemainingMin: number;
};

type EligibleUsageRow = UsageRow & {
  user: string;
  rateLimits: NonNullable<UsageRow["rateLimits"]>;
};

export type UsageRejection = {
  user: string;
  reason: string;
};

export type UsageSelection = {
  selectedUser?: string;
  eligibleUsers: string[];
  rejectedUsers: UsageRejection[];
  erroredUsers: UsageRejection[];
  missingUsers: string[];
};

export const defaultAuthDir = (): string =>
  process.env.CODEX_HOME?.trim() || join(process.env.HOME ?? "~", ".codex");

export const discoverAuthUsers = (dir = defaultAuthDir()): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter(
        (name) =>
          name.startsWith("auth-") &&
          name.endsWith(".json") &&
          name !== "auth-rotation-state.json" &&
          name !== "auth-user-map.json",
      )
      .map((name) => name.slice("auth-".length, -".json".length))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
};

export const sanitizeCodexPath = (pathValue: string | undefined): string => {
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

export const remaining = (percentUsed?: number): number => {
  if (typeof percentUsed !== "number" || !Number.isFinite(percentUsed)) return 0;
  return Math.max(0, 100 - percentUsed);
};

const hasRateLimits = (row: UsageRow): row is EligibleUsageRow =>
  typeof row.user === "string" &&
  Boolean(row.rateLimits?.primary) &&
  Boolean(row.rateLimits?.secondary);

export const scoreUsageRow = (row: UsageRow): number => {
  const primaryLeft = remaining(row.rateLimits?.primary?.usedPercent);
  const secondaryLeft = remaining(row.rateLimits?.secondary?.usedPercent);
  return primaryLeft * 3 + secondaryLeft;
};

const classifyUsageRow = (
  row: UsageRow,
  thresholds: UsageThresholds,
): { eligible: true } | { eligible: false; reason: string; error?: boolean } => {
  if (row.error) return { eligible: false, reason: row.error, error: true };
  if (!hasRateLimits(row)) {
    return {
      eligible: false,
      reason: "missing primary/secondary rate limit data",
      error: true,
    };
  }
  if (
    row.rateLimits.rateLimitReachedType !== null &&
    row.rateLimits.rateLimitReachedType !== undefined
  ) {
    return {
      eligible: false,
      reason: `rate limit reached: ${row.rateLimits.rateLimitReachedType}`,
    };
  }

  const primaryLeft = remaining(row.rateLimits.primary?.usedPercent);
  const secondaryLeft = remaining(row.rateLimits.secondary?.usedPercent);
  if (primaryLeft <= 0) {
    return { eligible: false, reason: "primary headroom exhausted" };
  }
  if (secondaryLeft <= 0) {
    return { eligible: false, reason: "secondary headroom exhausted" };
  }
  if (primaryLeft < thresholds.primaryRemainingMin) {
    return {
      eligible: false,
      reason: `primary remaining ${primaryLeft}% < ${thresholds.primaryRemainingMin}%`,
    };
  }
  if (secondaryLeft < thresholds.secondaryRemainingMin) {
    return {
      eligible: false,
      reason: `secondary remaining ${secondaryLeft}% < ${thresholds.secondaryRemainingMin}%`,
    };
  }
  return { eligible: true };
};

export const selectUsageUser = (
  usageRows: UsageRow[],
  users: readonly string[],
  thresholds: UsageThresholds,
): UsageSelection => {
  const rowsByUser = new Map(
    usageRows
      .filter(
        (row): row is UsageRow & { user: string } => typeof row.user === "string",
      )
      .map((row) => [row.user, row]),
  );
  const eligibleRows: EligibleUsageRow[] = [];
  const rejectedUsers: UsageRejection[] = [];
  const erroredUsers: UsageRejection[] = [];
  const missingUsers: string[] = [];

  for (const user of users) {
    const row = rowsByUser.get(user);
    if (!row) {
      missingUsers.push(user);
      continue;
    }
    const classification = classifyUsageRow(row, thresholds);
    if (classification.eligible) {
      eligibleRows.push(row as EligibleUsageRow);
    } else if (classification.error) {
      erroredUsers.push({ user, reason: classification.reason });
    } else {
      rejectedUsers.push({ user, reason: classification.reason });
    }
  }

  eligibleRows.sort(
    (left, right) =>
      scoreUsageRow(right) - scoreUsageRow(left) ||
      left.user.localeCompare(right.user),
  );

  return {
    selectedUser: eligibleRows[0]?.user,
    eligibleUsers: eligibleRows.map((row) => row.user),
    rejectedUsers,
    erroredUsers,
    missingUsers,
  };
};

const formatRejections = (
  label: string,
  rows: UsageRejection[],
): string | undefined => {
  if (rows.length === 0) return undefined;
  return `${label}: ${rows.map((row) => `${row.user} (${row.reason})`).join(", ")}`;
};

export const strictUsageSelectionMessage = (
  selection: UsageSelection,
  thresholds: UsageThresholds,
): string => {
  const secondaryRequirement =
    thresholds.secondaryRemainingMin > 0
      ? `secondary >= ${thresholds.secondaryRemainingMin}%`
      : "secondary > 0%";
  const details = [
    formatRejections("errors", selection.erroredUsers),
    formatRejections("threshold_rejections", selection.rejectedUsers),
    selection.missingUsers.length > 0
      ? `missing_usage_rows: ${selection.missingUsers.join(", ")}`
      : undefined,
  ].filter(Boolean);

  return (
    `No Codex users meet strict usage headroom thresholds; refusing to spill into credits. ` +
    `Required remaining headroom: primary >= ${thresholds.primaryRemainingMin}%, ${secondaryRequirement}.` +
    (details.length > 0 ? ` ${details.join("; ")}.` : "")
  );
};
