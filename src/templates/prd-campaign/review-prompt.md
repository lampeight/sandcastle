# Task

Review the just-completed child task on the current campaign branch.
Do not modify files and do not commit. You own acceptance and closure.

# Context

## Child task

!`sh -lc '{{VIEW_CHILD_COMMAND}}'`

## Bound PRD

!`sh -lc '{{VIEW_PRD_COMMAND}}'`

## Branch diff

!`git diff {{SOURCE_BRANCH}}...{{CAMPAIGN_BRANCH}}`

## Iteration diff

!`git diff {{ITERATION_BASE}}..{{CAMPAIGN_BRANCH}}`

## Latest implementation commit

!`git show --stat --format=fuller HEAD`

## Latest implementation diff

!`git show --no-ext-diff --unified=80 --format=medium HEAD`

## Commits on this branch

!`git log {{SOURCE_BRANCH}}..{{CAMPAIGN_BRANCH}} --oneline`

## Coverage-only warning

```text
{{COVERAGE_ONLY_WARNING}}
```

## No-new-commit warning

```text
{{NO_NEW_COMMIT_WARNING}}
```

# Review Process

1. Review against both child acceptance and parent PRD constraints.
2. Look for correctness, maintainability, coverage gaps, and adjacent leaks.
3. Focus acceptance on the latest implementation commit. Use branch diff as context.
4. Follow @.sandcastle/CODING_STANDARDS.md.
5. Run targeted verification. Use broad verification for high-risk shared changes: `{{BROAD_VERIFY_COMMAND}}`.
6. If acceptable, close the child task with `{{CLOSE_CHILD_COMMAND}}`.
7. If not acceptable, leave one concise task comment using `{{COMMENT_CHILD_COMMAND}}`.
8. Do not close the parent PRD.

# Output

Always output one `<review>` JSON payload:

```json
{
  "task_id": "{{TASK_ID}}",
  "closed_task": true,
  "summary": "short advisory review summary",
  "open_reason": "string or null",
  "blocking_issue": "precise blocker, or null",
  "required_test": "exact missing test or verification, or null",
  "file_hint": "most relevant file path/area, or null",
  "acceptance_condition": "condition that would allow closure next time, or null",
  "ready_for_to_issues": ["finding 1"]
}
```

Then output `<promise>COMPLETE</promise>`.
