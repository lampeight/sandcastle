# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. Resolve conflicts correctly
3. Run `{{BROAD_VERIFY_COMMAND}}`
4. Fix any merge-level failures before continuing

After all merges, make a single commit summarizing the merge pass.

Here are the issues covered by this merge:

{{ISSUES}}

Output only:

<merge_result>
{"status":"merged|merge_failed","summary":"short summary","target_branch":"target-branch","merged_issues":[{"issue_id":"123","branch":"feature/123"}],"commit":"optional merge commit sha","error":"set only on merge_failed"}
</merge_result>
<promise>COMPLETE</promise>
