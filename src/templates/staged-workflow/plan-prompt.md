# ISSUES

Here are the open issues in the repo:

<issues-json>

!`{{LIST_TASKS_COMMAND}}`

</issues-json>

The list above has already been filtered to issues ready for work.

# TASK

Build a plan for the next workflow pass.

Rules:

1. Find the best issue or issues to progress right now.
2. Respect dependencies and likely merge-conflict overlap.
3. Prefer a small set of issues that can be advanced safely this pass.
4. Each issue must include a branch name using `sandcastle/issue-{id}-{slug}`.

# OUTPUT

Output JSON wrapped in `<plan>` tags:

<plan>
{"issues":[{"id":"42","title":"Example","branch":"sandcastle/issue-42-example"}]}
</plan>
