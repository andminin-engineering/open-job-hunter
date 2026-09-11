# Third-party components

Open Job Hunter source code is licensed under MIT. Runtime and development dependencies are open-source packages resolved by `package-lock.json`; their individual licenses and notices remain controlling for those components.

Every verified release workflow produces a CycloneDX SBOM containing the exact resolved dependency inventory. The primary runtime components are:

| Component | Purpose | License family |
| --- | --- | --- |
| Model Context Protocol TypeScript SDK | MCP protocol implementation | MIT |
| Zod | Runtime schema validation | MIT |
| Nodemailer | Optional SMTP delivery | MIT-0 |
| Electron | Windows desktop runtime | MIT |
| TypeScript | Compilation | Apache-2.0 |
| Vitest | Automated testing | MIT |

Ollama and job-board services are not embedded proprietary source components. They are separately installed or networked systems selected by the operator and remain subject to their own licenses and terms.

To inspect the complete machine-readable inventory, download `open-job-hunter-sbom.cdx.json` from a verified workflow artifact or tagged release.
