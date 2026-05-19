# TASK

Rework issue {{ISSUE_ID}}: {{ISSUE_TITLE}}

You are not implementing from scratch. Kill the reviewer findings first.

Read @{{ISSUE_CONTRACT_FILE}} before editing.
That file may live under hidden `.sandcastle/`.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# REVIEW FEEDBACK

{{REVIEW_FEEDBACK}}

# EXECUTION

Before editing, identify the specific reviewer findings you are repairing.

Only inspect adjacent code needed for those findings.
Do not restart broad discovery.
Do not refetch issue context with `glab issue view` or `glab issue list`.

Use the smallest useful RED/GREEN loop.

# FEEDBACK LOOPS

Before committing, run `{{TARGETED_VERIFY_COMMAND}}` and then `{{BROAD_VERIFY_COMMAND}}`.

# COMMIT

Make a git commit. Keep it concise and include issue context.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
