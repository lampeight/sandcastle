// -nocheck
import { execFileSync } from "node:child_process";

export type SandcastleContainerInfo = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
};

export type PruneDecision = {
  container: SandcastleContainerInfo;
  reason: "not-running" | "running-older-than-ttl";
};

export type StartupPruneSummary = {
  inspected: number;
  removed: string[];
  failed: string[];
  skippedRunning: string[];
};

const DEFAULT_RUNNING_TTL_MINUTES = 180;

const parseInspectLine = (line: string): SandcastleContainerInfo | null => {
  const [id, rawName, status, createdAt] = line.split("\t");
  if (!id || !rawName || !status || !createdAt) return null;
  const name = rawName.replace(/^\/+/, "");
  if (!name.startsWith("sandcastle-")) return null;
  return {
    id,
    name,
    status,
    createdAt,
  };
};

export const parseStartupPruneEnabled = (raw: string | undefined): boolean => {
  const value = raw?.trim().toLowerCase();
  if (!value) return true;
  if (["0", "false", "off", "no"].includes(value)) return false;
  if (["1", "true", "on", "yes"].includes(value)) return true;
  throw new Error(
    `Invalid SANDCASTLE_PRUNE_STALE_CONTAINERS value: ${raw}. Expected true/false.`,
  );
};

export const parseRunningContainerTtlMinutes = (raw: string | undefined): number => {
  if (!raw?.trim()) return DEFAULT_RUNNING_TTL_MINUTES;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `Invalid SANDCASTLE_PRUNE_RUNNING_CONTAINER_TTL_MINUTES value: ${raw}. Expected a non-negative number.`,
    );
  }
  return value;
};

export const selectPrunableSandcastleContainers = (
  containers: SandcastleContainerInfo[],
  now: Date,
  runningTtlMinutes: number,
): PruneDecision[] =>
  containers.flatMap((container) => {
    if (container.status !== "running") {
      return [{ container, reason: "not-running" as const }];
    }

    if (runningTtlMinutes === 0) {
      return [];
    }

    const createdAtMs = Date.parse(container.createdAt);
    if (Number.isNaN(createdAtMs)) {
      return [];
    }

    const ageMs = now.getTime() - createdAtMs;
    if (ageMs < runningTtlMinutes * 60_000) {
      return [];
    }

    return [{ container, reason: "running-older-than-ttl" as const }];
  });

const execFileUtf8 = (command: string, args: string[]): string =>
  execFileSync(command, args, { encoding: "utf8" }).trim();

const loadSandcastleContainers = (
  run: (command: string, args: string[]) => string,
): SandcastleContainerInfo[] => {
  const ids = run("docker", ["ps", "-aq", "--filter", "name=^sandcastle-"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (ids.length === 0) return [];

  return run("docker", [
    "inspect",
    "--format",
    "{{.Id}}\t{{.Name}}\t{{.State.Status}}\t{{.Created}}",
    ...ids,
  ])
    .split("\n")
    .map((line) => parseInspectLine(line.trim()))
    .filter((value): value is SandcastleContainerInfo => value !== null);
};

export const pruneStaleSandcastleContainers = (options?: {
  run?: (command: string, args: string[]) => string;
  now?: Date;
  runningTtlMinutes?: number;
}): StartupPruneSummary => {
  const run = options?.run ?? execFileUtf8;
  const now = options?.now ?? new Date();
  const runningTtlMinutes =
    options?.runningTtlMinutes ?? DEFAULT_RUNNING_TTL_MINUTES;
  const containers = loadSandcastleContainers(run);
  const decisions = selectPrunableSandcastleContainers(
    containers,
    now,
    runningTtlMinutes,
  );
  const removableIds = new Set(decisions.map((decision) => decision.container.id));
  const removed: string[] = [];
  const failed: string[] = [];
  const skippedRunning = containers
    .filter(
      (container) =>
        container.status === "running" && !removableIds.has(container.id),
    )
    .map((container) => container.name);

  for (const decision of decisions) {
    try {
      run("docker", ["rm", "-f", decision.container.id]);
      removed.push(`${decision.container.name} (${decision.reason})`);
    } catch {
      failed.push(`${decision.container.name} (${decision.reason})`);
    }
  }

  return {
    inspected: containers.length,
    removed,
    failed,
    skippedRunning,
  };
};
