# TASK

Implement issue #{{ISSUE_ID}} from the frozen Issue Contract.

The Issue Contract is authoritative. Do not rescope from parent PRD context unless the packet says parent context was included.

# ISSUE PACKET

```json
{{ISSUE_PACKET_JSON}}
```

# ISSUE CONTRACT

{{ISSUE_CONTRACT_MD}}

```json
{{ISSUE_CONTRACT_JSON}}
```

# EXECUTION

Use the smallest useful RED/GREEN loop.

For every contract row:

- acceptance criteria must be implemented
- blocking findings must be addressed
- proof obligations must cite tests

For `must not`, `only`, `no longer`, `single`, `canonical`, or similar boundary language, prove the forbidden path fails.

Do not run `glab issue view` or `glab issue list`. This sandbox is a sealed execution inbox.

# COMMIT

Make a git commit. The commit message must start with `Sandcastle:`.

Before final output, run `git status --short`. It must be clean.

# FINAL OUTPUT

Output only:

<implementation_result>
{"status":"complete|incomplete","issue_id":"{{ISSUE_ID}}","contract_version":"v1","matrix":[{"id":"AC1","kind":"acceptance_criterion|blocking_finding|proof_obligation","status":"claimed_satisfied|not_addressed|disputed","code_refs":["path:line"],"test_refs":["tests/test_file.py::test_name"],"notes":"short proof note"}],"verification_commands":["command run"],"known_gaps":[]}
</implementation_result>
<promise>COMPLETE</promise>
