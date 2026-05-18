# TASK

Audit merged Sandcastle work for parent item #{{PARENT_ITEM_ID}} before issue closure.

Do not edit code.

# PARENT ITEM

{{PARENT_ISSUE_CONTEXT}}

# MERGED ISSUE ARTIFACTS

```json
{{MERGED_ISSUE_ARTIFACTS_JSON}}
```

# MERGED DIFF

!`git diff {{TARGET_HEAD_SHA}}..HEAD`

# AUDIT RULES

Check:

- child issue contracts
- implementation matrices
- review matrices
- contract audit results
- parent-level gaps visible only after the merged set is inspected

Close only issues that pass.

If a child issue failed its own contract, put it in `failed_issues`.

If the parent has a real gap not owned by an existing child contract, put a complete standalone child brief in `follow_up_issues`.

# FINAL OUTPUT

Output only:

<repo_audit_result>
{"status":"pass|fail","summary":"short summary","closeable_issues":[{"issue_id":"123","branch":"sandcastle/issue-123"}],"failed_issues":[{"issue_id":"123","summary":"why it failed","comment_markdown":"structured comment to post"}],"follow_up_issues":[{"parent_id":"{{PARENT_ITEM_ID}}","title":"ready-for-agent task title","goal":"standalone goal","acceptance_criteria":["criterion"],"blocking_findings":["finding"],"proof_obligations":["proof"],"out_of_scope":["scope limit"],"source_issue_ids":["123"],"gap_fingerprint":"optional-stable-id"}]}
</repo_audit_result>
<promise>COMPLETE</promise>
