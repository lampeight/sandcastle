# TASK

Audit the current repo state for these issues:

{{ISSUES}}

Read each per-issue contract under `.sandcastle/staged/<issue-id>/issue-contract.md` first.
Those files may live under hidden `.sandcastle/`.

Merged branches this pass:

{{MERGED_BRANCHES}}

# AUDIT

For each issue:

1. Check whether the repo now satisfies the contract
2. Check whether proof and matrix expectations are met
3. If satisfied, note that it is ready for runtime-managed closure
4. If not satisfied, leave it open and say why

Audit is advisory in the active staged workflow.
Do not close issues from this stage.

Do not invent new work outside the issue contract.

Once complete, output <promise>COMPLETE</promise>.
