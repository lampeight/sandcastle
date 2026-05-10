# Task

Review the full campaign branch against bound PRD `{{PRD_ID}}`.
This is a governed PRD conformance and handoff step.
Do not modify files, do not commit, and do not close tasks.

# Context

## Bound PRD

!`sh -lc '{{VIEW_PRD_COMMAND}}'`

## Branch diff

!`git diff {{SOURCE_BRANCH}}...{{CAMPAIGN_BRANCH}}`

## Commits on this branch

!`git log {{SOURCE_BRANCH}}..{{CAMPAIGN_BRANCH}} --oneline`

# Review Process

1. Read PRD `{{PRD_ID}}`.
2. Compare PRD scope to branch diff and commit history.
3. Identify missing acceptance coverage, architectural drift, and unresolved decisions.
4. Classify each gap as new child work, missed child closure, or human decision.
5. Do not close the PRD.

# Output

Always output one `<handoff>` JSON payload:

```json
{
  "prd_id": "{{PRD_ID}}",
  "summary": "short final PRD review summary",
  "ready_for_to_issues": ["gap 1"],
  "missed_child_closure": ["task id/reason"],
  "need_human_decision": ["decision 1"]
}
```

Then output `<promise>COMPLETE</promise>`.
