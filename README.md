<div align="center">

# 🎯 open-job-hunter

**An open-source [MCP](https://modelcontextprotocol.io) server that discovers and AI-evaluates job offers against _your_ profile — running 100% locally.**

No cloud, no data leaving your machine, no vendor lock-in. You describe yourself once in a config file, and the server scores every job posting against you, keeps a pipeline, and can email you a daily digest of the best matches.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-server-blue)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://www.typescriptlang.org)

</div>

---

## Why

Job searching at a senior level is a matching problem drowning in noise. You are one of hundreds of applicants per role, and most of your time is spent reading postings that were never a fit. `open-job-hunter` flips that: it pulls openings from multiple job boards, runs each one through a **local LLM** that scores it against your real background, and surfaces only the offers worth your time — with the risks and the angle to pitch already written out.

Because evaluation happens on a local model (Ollama), **your profile and your search never leave your computer.**

## Features

- **Configurable candidate profile** — one `config/profile.json` drives everything. The tool works for _anyone_, not a single person.
- **Local AI evaluation** — every offer is scored `0–100` with `apply` decision, `detected_risks`, `strong_points_to_highlight`, and a tailored `custom_angle`, via your own Ollama model.
- **Multi-source discovery** — Remotive, Greenhouse boards, and Lever boards out of the box, plus generic URL ingestion.
- **Application pipeline** — a local JSON database tracks every offer through states: `nueva → evaluada → postulada → entrevista → oferta` (and more).
- **Scheduler + email digests** — optionally run discovery on a schedule and receive the top matches by email (SMTP).
- **Two interfaces** — a standard **MCP server** (stdio) for use inside Claude / any MCP client, and an **HTTP API** bridge for dashboards and automation.

## Architecture

```
                 ┌────────────────────────────────────────┐
   MCP client ──▶│  MCP server (stdio)                     │
  (Claude, etc.) │      evaluar_oferta_laboral             │
                 │      listar_pipeline_postulaciones       │──▶ Local JSON DB
   HTTP client ─▶│  HTTP bridge (:3000)                    │    (pipeline)
   / dashboard   │      /api/evaluar, /api/discovery/*      │
                 └───────────────┬─────────────────────────┘
                                 │ prompt built from
                                 ▼ config/profile.json
                        ┌──────────────────┐
                        │  Ollama (local)  │  ◀── your data stays here
                        └──────────────────┘
```

The complete engineering case study is documented in [Architecture and decisions](./docs/architecture/README.md), including system diagrams, quality attributes, Architecture Decision Records (ADRs), threat boundaries and the AI-assisted delivery model.

## Quickstart

### Windows desktop app

Download the latest installer or portable build from [GitHub Releases](https://github.com/andminin-engineering/open-job-hunter/releases/latest). No Node.js installation is required. The desktop app stores your profile and pipeline under your Windows user data directory.

> Windows SmartScreen may warn about the first unsigned community release. Verify the published SHA-256 checksum before running it. Code signing is planned for a future release.

### Developer / MCP installation

Requires **Node ≥ 20** and a running **[Ollama](https://ollama.com)** instance.

```bash
# 1. Clone & install
git clone https://github.com/andminin-engineering/open-job-hunter.git
cd open-job-hunter
npm install

# 2. Pull a local model (any instruction model works)
ollama pull qwen2.5:7b

# 3. Create your profile
cp config/profile.example.json config/profile.json
#   ...then edit config/profile.json with your background (see below)

# 4. (optional) configure environment
cp .env.example .env

# 5. Build & run the web interface
npm start
```

## Configure your profile

This is the heart of the tool. Copy the example and make it yours:

```jsonc
{
  "fullName": "Your Name",
  "headline": "Senior Backend Engineer / Solution Architect",
  "seniorityYears": 10,
  "summary": "A 2-3 sentence pitch of who you are and what you solve best.",
  "coreCompetencies": {
    "backend": ["Java (Spring Boot)", "Node.js (NestJS)"],
    "architecture": ["Distributed systems", "DDD", "Resilience patterns"],
    "cloud": ["AWS (ECS, RDS)", "Docker", "Kubernetes"]
  },
  "portfolioUrl": "https://github.com/your-handle",
  "salaryTargetUsd": 3000,
  "languages": [{ "language": "English", "level": "B2" }],
  "search": {
    "keywords": "backend OR software architect OR senior",
    "minScoreToApply": 70,
    "boards": { "greenhouse": ["stripe", "datadog"], "lever": ["lever"] }
  }
}
```

The evaluator prompt is generated from this file, so the more precise your competencies and summary, the sharper the scoring.

## Use as an MCP server

Point any MCP client at the built server. Example for Claude Desktop / Claude Code (`mcp` config):

```json
{
  "mcpServers": {
    "open-job-hunter": {
      "command": "node",
      "args": ["/absolute/path/to/open-job-hunter/build/bin/mcp.js"]
    }
  }
}
```

### MCP tools

| Tool | What it does |
| --- | --- |
| `evaluar_oferta_laboral` | Score a single job description against your profile. |
| `listar_pipeline_postulaciones` | List stored offers, optionally filtered by state. |
| `actualizar_estado_postulacion` | Move an offer to a new pipeline state. |
| `registrar_feedback_postulacion` | Record recruiter feedback on an offer. |

## HTTP API (selected endpoints)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness check. |
| `POST` | `/api/evaluar` | Evaluate one offer. |
| `POST` | `/api/evaluar-lote` | Evaluate a batch of offers. |
| `GET` | `/api/discovery/remotive` | Discover jobs from Remotive. |
| `GET` | `/api/discovery/greenhouse` | Discover jobs from a Greenhouse board. |
| `GET` | `/api/discovery/lever` | Discover jobs from a Lever board. |
| `GET` | `/api/pipeline` | Read the pipeline. |
| `POST` | `/api/scheduler/run-now` | Trigger a discovery + digest cycle. |

## Privacy

The LLM evaluation runs against a **local** Ollama instance — your profile, the offers you evaluate, and your pipeline stay on your machine. The only outbound calls are to the public job-board APIs you explicitly query, and (optionally) your own SMTP server for digests.

## Roadmap

- Additional job-board connectors (Ashby, Workable, LinkedIn export).
- Pluggable LLM backends beyond Ollama.
- Signed Windows builds and automatic updates.
- CV/offer gap analysis.

## Contributing

Issues and PRs are welcome. This project started as a personal job-search tool and was generalized so anyone can use it — improvements that make it useful to more people are especially appreciated.

## License

[MIT](./LICENSE) © 2026 Andrea Minín
