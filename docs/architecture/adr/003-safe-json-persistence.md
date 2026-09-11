# ADR-003: Safe JSON persistence across processes

- Status: Accepted
- Date: 2026-09-11

## Context

The MCP process, HTTP process and automation scripts may write concurrently. A plain read-modify-write cycle loses updates, while removing a lock merely because it is old can corrupt work owned by a slow but live process.

## Decision

Serialize mutations with an exclusive lock directory containing owner PID, unique token and creation time. Recover a stale lock only when its owner is demonstrably dead. Write the complete next state to a unique temporary file and atomically rename it over the database. Release a lock only if its token still matches.

## Consequences

- Independent processes preserve every accepted update.
- Crashed writers can be recovered without breaking legitimate aged locks.
- This remains intentionally lightweight; high-volume or networked deployments should migrate behind a storage interface to SQLite or a transactional service.
