import { rmSync, statSync } from "node:fs";

const DEFAULT_STALE_LOCK_TTL_MS = 15_000;

export const parseAuthLockTtlMs = (raw: string | undefined): number => {
  if (!raw?.trim()) return DEFAULT_STALE_LOCK_TTL_MS;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `Invalid SANDCASTLE_AUTH_ROTATION_STALE_LOCK_TTL_MS value: ${raw}. Expected a non-negative number.`,
    );
  }
  return value;
};

export const authRotationLockIsStale = (
  mtimeMs: number,
  nowMs: number,
  ttlMs: number,
): boolean => nowMs - mtimeMs >= ttlMs;

export const clearStaleAuthRotationLock = (
  lockDir: string,
  options?: { nowMs?: number; ttlMs?: number },
): boolean => {
  const ttlMs = options?.ttlMs ?? DEFAULT_STALE_LOCK_TTL_MS;
  try {
    const stat = statSync(lockDir);
    if (!stat.isDirectory()) return false;
    if (!authRotationLockIsStale(stat.mtimeMs, options?.nowMs ?? Date.now(), ttlMs)) {
      return false;
    }
    rmSync(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
};
