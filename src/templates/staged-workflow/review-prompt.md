# TASK

Review the code changes on branch `{{BRANCH}}` for issue `{{TASK_ID}}`.

You are a gate, not an implementer.

# CONTEXT

## Branch diff

!`git diff {{SOURCE_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{SOURCE_BRANCH}}..{{BRANCH}} --oneline`

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

If you approve the work, close the GitLab issue before final output:
`repo="${GITLAB_REPO:-$(git remote get-url origin)}"; glab issue close -R "$repo" {{TASK_ID}}`

Before final output, run `git status --short`. It must be clean.

Output exactly this structure:

<review_result>
{"status":"approve|changes_required","summary":"short summary","findings":[{"severity":"high|medium|low","title":"short title","details":"what is wrong and why","code_refs":["path:line"],"acceptance_criteria":["copied or paraphrased AC"]}]}
</review_result>
<promise>COMPLETE</promise>
