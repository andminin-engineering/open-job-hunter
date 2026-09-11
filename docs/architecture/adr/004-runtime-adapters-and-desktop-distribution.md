# ADR-004: One core, multiple runtime adapters

- Status: Accepted
- Date: 2026-09-11

## Context

AI agents expect MCP over stdio, automations benefit from HTTP, and non-technical Windows users expect a normal application. Maintaining separate implementations would multiply defects and make behavior drift likely.

## Decision

Expose explicit `mcp`, `http` and `all` entry points around one application core. Package the HTTP entry point in Electron for Windows. Electron selects a free loopback port, starts the backend as a child process and opens the UI only after a successful health check.

## Consequences

- Each consumer receives an appropriate interface without duplicated domain behavior.
- MCP stdout stays free of HTTP logs and protocol contamination.
- The desktop artifact is larger because it includes Electron, but it requires no Node.js installation.
- Desktop lifecycle, renderer isolation and artifact signing become explicit operational responsibilities.
