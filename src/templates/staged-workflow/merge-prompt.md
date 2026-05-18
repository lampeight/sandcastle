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

Once complete, output <promise>COMPLETE</promise>.
