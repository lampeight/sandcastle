# TASK

Rework issue #{{ISSUE_ID}} from the current Issue Contract and prior failed review rows.

You are not implementing from scratch. Kill the failed rows first.

# ISSUE PACKET

```json
{{ISSUE_PACKET_JSON}}
```

# ISSUE CONTRACT

{{ISSUE_CONTRACT_MD}}

```json
{{ISSUE_CONTRACT_JSON}}
```

# PRIOR FAILED REVIEW

```json
{{PREVIOUS_REVIEW_RESULT_JSON}}
```

# REVIEW FEEDBACK

{{REVIEW_FEEDBACK}}

# EXECUTION

Before editing, identify the contract rows you are repairing.

Only inspect adjacent code needed for those rows. Do not reread broad PRD context unless the failed row explicitly requires it.

Do not run `glab issue view` or `glab issue list`. This sandbox is a sealed execution inbox.

Make a git commit. The commit message must start with `Sandcastle:`.

Before final output, run `git status --short`. It must be clean.

# FINAL OUTPUT

Output only:

<implementation_result>
{"status":"complete|incomplete","issue_id":"{{ISSUE_ID}}","contract_version":"v1","matrix":[{"id":"AC1","kind":"acceptance_criterion|blocking_finding|proof_obligation","status":"claimed_satisfied|not_addressed|disputed","code_refs":["path:line"],"test_refs":["tests/test_file.py::test_name"],"notes":"short proof note"}],"verification_commands":["command run"],"known_gaps":[]}
</implementation_result>
<promise>COMPLETE</promise>
