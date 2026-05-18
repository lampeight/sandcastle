# TASK

Audit the current repo state for these issues:

{{ISSUES}}

Read @{{ISSUE_CONTRACT_FILE}} first.
That file may live under hidden `.sandcastle/`.

Merged branches this pass:

{{MERGED_BRANCHES}}

# AUDIT

For each issue:

1. Check whether the repo now satisfies the contract
2. Check whether proof and matrix expectations are met
3. If satisfied, close it with `{{AUDIT_CLOSE_TASK_COMMAND}}`
4. If not satisfied, leave it open

Do not invent new work outside the issue contract.

Once complete, output <promise>COMPLETE</promise>.
