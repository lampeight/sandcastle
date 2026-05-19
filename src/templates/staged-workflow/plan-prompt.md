# ISSUES

Here are the open issues in the repo:

<issues-json>

!`node ./.sandcastle/scripts/list_ready_issues.js`

</issues-json>

The list above has already been filtered to issues ready for work and annotated with blocker state.

# TASK

Build a plan for the next workflow pass.

Rules:

1. Find the best issue or issues to progress right now.
2. Respect dependencies and likely merge-conflict overlap.
3. Treat `ready_now: true` as eligible now. Do not skip an issue just because its body still contains `Blocked by` if all listed blockers are closed.
4. Prefer a small set of issues that can be advanced safely this pass.
5. Each issue must include a branch name using `sandcastle/issue-{id}-{slug}`.

# OUTPUT

Output JSON wrapped in `<plan>` tags:

<plan>
{"issues":[{"id":"42","title":"Example","branch":"sandcastle/issue-42-example"}]}
</plan>
