# TASK

Review rework branch `{{BRANCH}}` for issue #{{ISSUE_ID}}.

Do not edit code.

# REVIEW INPUTS

- Issue contract: `{{ISSUE_CONTRACT_FILE}}`
- Latest implementation result: `{{IMPLEMENTATION_RESULT_FILE}}`
- Prior review result: `{{REVIEW_RESULT_FILE}}`

# ISSUE CONTRACT

{{ISSUE_CONTRACT_MD}}

```json
{{ISSUE_CONTRACT_JSON}}
```

# IMPLEMENTATION RESULT

```json
{{IMPLEMENTATION_RESULT_JSON}}
```

# PREVIOUS REVIEW RESULT

```json
{{PREVIOUS_REVIEW_RESULT_JSON}}
```

# DIFF

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

# COMMITS

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

# REVIEW RULES

First verify the prior failed rows. Then verify every contract row.

Approval is forbidden unless every row is `pass`.

Do not accept broad improvement as proof. Cite code and tests for every row.

Do not run `glab issue view` or `glab issue list`.

Before final output, run `git status --short`. It must be clean.

# FINAL OUTPUT

Output only:

<review_result>
{"status":"approve|changes_required","summary":"short summary","acceptance":[{"id":"AC-1","status":"pass|fail|unclear","finding":"what is wrong","required_change":"what must change"}],"findings":[{"severity":"blocking|non_blocking","file":"path/to/file","line":123,"issue":"what is wrong and why","suggested_fix":"targeted fix"}]}
</review_result>
<promise>COMPLETE</promise>
