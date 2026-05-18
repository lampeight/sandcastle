# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `{{VIEW_TASK_COMMAND}}`. If it has parent context, pull that in too.

Read @{{ISSUE_CONTRACT_FILE}} before editing.
That file may live under hidden `.sandcastle/`.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXECUTION

If applicable, use RGR:

1. RED
2. GREEN
3. REPEAT
4. REFACTOR

# FEEDBACK LOOPS

Before committing, run `{{TARGETED_VERIFY_COMMAND}}` and then `{{BROAD_VERIFY_COMMAND}}`.

# COMMIT

Make a git commit. Keep it concise and include issue context.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
