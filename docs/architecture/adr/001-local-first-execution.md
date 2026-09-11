# ADR-001: Local-first execution

- Status: Accepted
- Date: 2026-09-11

## Context

Candidate profiles, salary expectations and job-search history are sensitive. Sending them to a hosted application by default would add privacy, credential, tenancy and operational concerns that are unnecessary for the initial product.

## Decision

Evaluation uses a user-operated Ollama endpoint and persistence remains on the local machine. Job boards and SMTP are contacted only when their corresponding operation is explicitly configured or invoked.

## Consequences

- Users retain control over private career data and model selection.
- The product has no mandatory hosted backend or account system.
- Users must supply enough local compute for their chosen model.
- Future cloud backends must be opt-in adapters and may not silently change the local-first default.
