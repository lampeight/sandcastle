# TASK

Review the code changes on branch `{{BRANCH}}` and improve code clarity, consistency, maintainability, and proof coverage while preserving exact functionality.

# CONTEXT

## Branch diff

!`git diff {{SOURCE_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{SOURCE_BRANCH}}..{{BRANCH}} --oneline`

# REVIEW PROCESS

1. Understand the change.
2. Check the issue contract in @{{ISSUE_CONTRACT_FILE}}.
   That file may live under hidden `.sandcastle/`.
3. Tighten tests, evidence, and matrix coverage where needed.
4. Apply project standards from @.sandcastle/CODING_STANDARDS.md.
5. Preserve exact behavior.

# EXECUTION

If changes are needed:

1. Edit on this branch
2. Run verification
3. Commit the refinements

If the branch is already correct and sufficiently proven, do nothing.

Once complete, output <promise>COMPLETE</promise>.
