import path from "node:path";

export const resolveTargetRepoRoot = (explicitTargetRepo, cwd, profileRoot) => {
  if (explicitTargetRepo) return path.resolve(explicitTargetRepo);

  const resolvedCwd = path.resolve(cwd);
  const resolvedProfileRoot = path.resolve(profileRoot);
  if (
    resolvedCwd === resolvedProfileRoot &&
    path.basename(resolvedCwd) === ".sandcastle"
  ) {
    return path.dirname(resolvedCwd);
  }

  return resolvedCwd;
};
