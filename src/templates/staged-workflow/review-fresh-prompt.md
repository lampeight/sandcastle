# TASK

Review branch `{{SOURCE_BRANCH}}` for issue #{{ISSUE_ID}} against the Issue Contract.

Do not edit code.

# ISSUE CONTRACT

{{ISSUE_CONTRACT_MD}}

```json
{{ISSUE_CONTRACT_JSON}}
```

# IMPLEMENTATION RESULT

```json
{{IMPLEMENTATION_RESULT_JSON}}
```

# DIFF

!`git diff {{TARGET_BRANCH}}...{{SOURCE_BRANCH}}`

# COMMITS

!`git log {{TARGET_BRANCH}}..{{SOURCE_BRANCH}} --oneline`

# REVIEW RULES

Review only from the contract, implementation result, diff, code, and tests.

Approval is forbidden unless every acceptance row is `pass`.

Do not run `glab issue view` or `glab issue list`.

Before final output, run `git status --short`. It must be clean.

# FINAL OUTPUT

Output only:

<review_result>
{"status":"approve|changes_required","summary":"short summary","acceptance":[{"id":"AC-1","status":"pass|fail|unclear","finding":"what is wrong","required_change":"what must change"}],"findings":[{"severity":"blocking|non_blocking","file":"path/to/file","line":123,"issue":"what is wrong and why","suggested_fix":"targeted fix"}]}
</review_result>
<promise>COMPLETE</promise>
