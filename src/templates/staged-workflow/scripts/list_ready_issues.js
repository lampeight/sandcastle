#!/usr/bin/env node

const { execFileSync } = require("node:child_process");

const repo =
  process.env.GITLAB_REPO ||
  execFileSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();

const parseBlockedBy = (description) => {
  if (typeof description !== "string" || description.length === 0) return [];
  const sectionMatch = description.match(
    /## Blocked by\s+([\s\S]*?)(?:\n## |\n# |$)/i,
  );
  if (!sectionMatch) return [];
  const ids = [...sectionMatch[1].matchAll(/#(\d+)/g)].map((match) => match[1]);
  return [...new Set(ids)];
};

const glabJson = (args) =>
  JSON.parse(
    execFileSync("glab", args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }),
  );

const issues = glabJson([
  "issue",
  "list",
  "-R",
  repo,
  "--label",
  "ready-for-agent",
  "-O",
  "json",
  "-P",
  "100",
]);

const blockerCache = new Map();

const loadBlocker = (iid) => {
  if (!blockerCache.has(iid)) {
    blockerCache.set(
      iid,
      glabJson(["issue", "view", String(iid), "-R", repo, "-F", "json"]),
    );
  }
  return blockerCache.get(iid);
};

const enriched = issues.map((issue) => {
  const blockedBy = parseBlockedBy(issue.description);
  const blockers = blockedBy.map((iid) => {
    const blocker = loadBlocker(iid);
    return {
      iid: String(blocker.iid),
      title: blocker.title,
      state: blocker.state,
    };
  });
  const openBlockers = blockers.filter((blocker) => blocker.state !== "closed");
  return {
    ...issue,
    id: String(issue.iid),
    gitlab_id: issue.id,
    blocked_by: blockers,
    ready_now: openBlockers.length === 0,
    open_blockers: openBlockers,
  };
});

process.stdout.write(`${JSON.stringify(enriched, null, 2)}\n`);
