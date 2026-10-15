# Vitest collection scope validation

Date: 2026-10-15
Task: `OJH-VITEST-SCOPE-001`

## Purpose

Keep the public test command deterministic when a checkout is located near archived
dependencies, nested repositories, or other files that match Vitest's default test
patterns.

## Change

`vitest.config.ts` uses `tests/**/*.spec.ts` as the sole collection scope. An inert
root-relative `exclude` setting was removed because it did not match the archived
dependency directory that originally exposed the discovery issue. The explicit
`include` rule provides the isolation.

No application code, candidate profile, job pipeline, credentials, or local runtime
data is part of this change.

## Review history

An independent read-only review identified two low-severity documentation and
configuration findings:

1. The `exclude` entry was misleading and replaced Vitest's default exclusions.
2. The change needed a structured, task-linked engineering handoff.

Both findings are addressed by the final two-file change. The original internal
multi-agent log remains preserved locally; this document is the public, current,
and privacy-safe engineering record.

## Validation

The release gate for this task is:

```text
npm run build
npm test
npm run test:runtime
npm run doctor
```

Results against the final diff on Windows with Node.js v24.16.0:

- `npm run build`: passed.
- `npm test`: passed, 9 files and 62 tests.
- `npm run test:runtime`: passed, including HTTP, MCP, profile, pagination,
  Ollama diagnostics, XSS defenses, and 12-process persistence checks.
- `npm run doctor`: passed; the clean checkout reported only the expected warning
  that `profile.example.json` is still in use.

`npm ci` also reported deprecated transitive packages and 8 moderate audit
findings already present in the lockfile. They were not automatically changed
because dependency remediation is outside this task's reviewed scope.

## Delivery

```yaml
task_id: OJH-VITEST-SCOPE-001
change_scope:
  - vitest.config.ts
  - docs/quality/2026-10-15-vitest-scope.md
commit_and_push: authorized by the human owner
release_action: none
```
