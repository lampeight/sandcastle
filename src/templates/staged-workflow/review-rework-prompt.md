# TASK

Review rework branch `{{SOURCE_BRANCH}}` for issue #{{ISSUE_ID}}.

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

# PRIOR FAILED REVIEW

```json
{{PREVIOUS_REVIEW_RESULT_JSON}}
```

# DIFF

!`git diff {{TARGET_BRANCH}}...{{SOURCE_BRANCH}}`

# COMMITS

!`git log {{TARGET_BRANCH}}..{{SOURCE_BRANCH}} --oneline`

# REVIEW RULES

First verify the prior failed rows. Then verify every contract row.

Approval is forbidden unless every row is `pass`.

Do not accept broad improvement as proof. Cite code and tests for every row.

Do not run `glab issue view` or `glab issue list`.

Before final output, run `git status --short`. It must be clean.

# FINAL OUTPUT

Output only:

<review_result>
{"status":"approve|changes_required","summary":"short summary","issue_id":"{{ISSUE_ID}}","contract_version":"v1","matrix":[{"id":"AC1","kind":"acceptance_criterion|blocking_finding|proof_obligation","status":"pass|fail|partial|untested","code_refs":["path:line"],"test_refs":["tests/test_file.py::test_name"],"notes":"short evidence note"}]}
</review_result>
<promise>COMPLETE</promise>
