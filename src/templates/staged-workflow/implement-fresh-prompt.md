# TASK

Implement issue #{{ISSUE_ID}} from the frozen Issue Contract.

The Issue Contract is authoritative.

# ISSUE CONTRACT

{{ISSUE_CONTRACT_MD}}

```json
{{ISSUE_CONTRACT_JSON}}
```

# EXECUTION

Use the smallest useful RED/GREEN loop.

Do not run `glab issue view` or `glab issue list`.

# COMMIT

Make a git commit. The commit message must start with `Sandcastle:`.

Before final output, run `git status --short`. It must be clean.

# FINAL OUTPUT

Output only:

<implementation_result>
{"status":"complete|blocked","summary":"short summary","acceptance":[{"id":"AC-1","status":"done|not_done|not_applicable","evidence":"what proves this row","files":["path/to/file"]}],"commands":[{"command":"command run","result":"passed|failed|not_run","notes":"short note"}]}
</implementation_result>
<promise>COMPLETE</promise>
