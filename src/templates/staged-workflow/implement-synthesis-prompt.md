# TASK

Synthesize and repair issue {{ISSUE_ID}}: {{ISSUE_TITLE}}

This is an escalation pass after repeated reviewer handbacks.

You are not starting over. You are resolving the accumulated review failures.

Read @{{ISSUE_CONTRACT_FILE}} only for boundaries. Do not refetch the issue from the tracker.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# CUMULATIVE REVIEW HISTORY

{{REVIEW_HISTORY}}

# LATEST REVIEW FEEDBACK

{{REVIEW_FEEDBACK}}

# EXECUTION

Before editing, identify the shared invariant or design error that explains the repeated review findings.

Use the cumulative review history as the primary input. The issue contract is a scope boundary, not a request to restart implementation.

Patch the smallest coherent fix that resolves all still-valid review findings.

Add or update regression tests for each still-valid finding.

Do not broaden into unrelated issue scope.

# FEEDBACK LOOPS

Before committing, run `{{TARGETED_VERIFY_COMMAND}}` and then `{{BROAD_VERIFY_COMMAND}}`.

# COMMIT

Make a git commit. Keep it concise and include issue context.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
