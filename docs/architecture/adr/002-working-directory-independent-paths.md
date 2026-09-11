# ADR-002: Working-directory-independent paths

- Status: Accepted
- Date: 2026-09-11

## Context

MCP clients spawn servers and control their working directory. On Windows, a client may start a server from `C:\WINDOWS\System32`. Relative persistence paths then create files in the wrong location, fail with permissions errors or read an unintended profile.

## Decision

Project resources are derived from `import.meta.url`. Mutable paths use explicit absolute environment overrides or documented per-user defaults. Relative path overrides are rejected.

## Consequences

- MCP clients, shells, Docker and Electron can start the same application from arbitrary directories.
- Configuration errors fail early instead of writing to surprising locations.
- Packaging must include immutable application resources referenced from the module root.
