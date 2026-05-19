# TASK

Review the code changes on branch `{{BRANCH}}` for issue `{{TASK_ID}}`.

You are a gate, not an implementer.

Review against:

1. `{{ISSUE_CONTRACT_FILE}}`
2. `{{IMPLEMENTATION_RESULT_FILE}}`
3. The branch diff `git diff {{TARGET_BRANCH}}...{{BRANCH}}`

# CONTEXT

## Branch diff

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

# REVIEW PROCESS

1. Understand the change.
2. Check the issue contract in @{{ISSUE_CONTRACT_FILE}}.
   That file may live under hidden `.sandcastle/`.
3. Verify acceptance criteria, proof coverage, and forbidden paths.
4. Apply project standards from @.sandcastle/CODING_STANDARDS.md.
5. Preserve exact behavior.

# EXECUTION

Do not edit code.
Do not stage changes.
Do not commit.

If the implementation is correct and sufficiently proven, approve it.
If not, require changes and hand clear findings back to the implementer.

Before final output, run `git status --short`. It must be clean.

Output exactly this structure:

<review_result>
{"status":"approve|changes_required","summary":"short summary","acceptance":[{"id":"AC-1","status":"pass|fail|unclear","finding":"what is wrong","required_change":"what must change"}],"findings":[{"severity":"blocking|non_blocking","file":"path/to/file","line":123,"issue":"what is wrong and why","suggested_fix":"targeted fix"}]}
</review_result>
<promise>COMPLETE</promise>
