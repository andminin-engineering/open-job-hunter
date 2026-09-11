# ADR-005: AI-assisted delivery governance

- Status: Accepted
- Date: 2026-09-11

## Context

Multiple LLM providers can accelerate architecture, implementation, QA and review, but a model may hallucinate evidence or approve code it produced. A credible engineering case study needs responsibility, independence and reproducible gates.

## Decision

Use role-based agent routing with these controls:

- the human owner defines product intent, authorizes releases and accepts residual risk;
- implementation and independent review use separate providers when available;
- a provider cannot approve changes it materially authored;
- review reports identify the exact baseline, commands, findings, verdict and unresolved items;
- deterministic build, test and runtime evidence outranks unsupported reviewer claims;
- local small models provide a second opinion, not a release approval, until calibrated by evaluations.

## Consequences

- Agent collaboration is auditable rather than an informal chat transcript.
- Provider outages can be handled through an explicitly authorized continuity path.
- False positives and false confidence remain visible and are resolved against code and executable evidence.
- Final accountability stays with the human owner.
