# TASK

Decide the next action for issue {{TASK_ID}}: {{ISSUE_TITLE}}.

Pull in the issue using `{{VIEW_TASK_COMMAND}}`.

Read @{{ISSUE_CONTRACT_FILE}} before deciding.
That file may live under hidden `.sandcastle/`.

Use this lock-and-key routing:

- `already_satisfied`: current repo state already satisfies the issue contract
- `proof_gap`: code likely satisfies the contract, but proof or matrix coverage is missing
- `code_gap`: implementation work is still required
- `blocked`: cannot proceed safely this pass

Do not edit code in this step.

# OUTPUT

Output JSON wrapped in `<decision>` tags:

<decision>
{"type":"code_gap","summary":"why","proofGaps":[],"codeGaps":[]}
</decision>
