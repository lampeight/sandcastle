# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Read @{{ISSUE_CONTRACT_FILE}} before editing.
That file may live under hidden `.sandcastle/`.
Use `{{ISSUE_CONTRACT_FILE}}` as the source of truth for the task.
Do not rely on partial backlog summaries if they conflict with the issue contract.
If you fetch live issue context for extra detail, the issue contract still wins.

# ISSUE CONTRACT

{{ISSUE_CONTRACT_MD}}

```json
{{ISSUE_CONTRACT_JSON}}
```

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

Before final output, run `git status --short`. It must be clean.

Output only:

<implementation_result>
{"status":"complete|blocked","summary":"short summary","acceptance":[{"id":"AC-1","status":"done|not_done|not_applicable","evidence":"what proves this row","files":["path/to/file"]}],"commands":[{"command":"command run","result":"passed|failed|not_run","notes":"short note"}]}
</implementation_result>
<promise>COMPLETE</promise>

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
