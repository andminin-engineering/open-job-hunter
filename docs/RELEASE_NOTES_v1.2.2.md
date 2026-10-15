# Open Job Hunter v1.2.2

v1.2.2 is a maintenance release for the Windows desktop application and MCP
server. It preserves the application features, configuration, and local data
format of v1.2.1.

## Quality maintenance

- Restricted Vitest collection to the repository's own `tests/**/*.spec.ts`
  suite, preventing archived dependencies or nested repositories from being
  mistaken for project tests.
- Published privacy-safe engineering evidence for the test-scope remediation.
- Revalidated compilation, 62 automated tests, runtime behavior, and installation
  diagnostics before release preparation.

## Existing safeguards

- Release builds run compilation, automated tests, runtime checks, dependency
  audit, and Microsoft Defender scanning.
- Published assets include SHA-256 checksums, a CycloneDX SBOM, and GitHub
  build-provenance attestations.
- Candidate profiles, evaluation history, and pipeline data remain local and are
  not included in release artifacts.

## Installation and verification

Download either the Setup or Portable executable and verify it against
`SHA256SUMS.txt`. GitHub CLI users can also verify provenance:

```powershell
Get-FileHash .\Open-Job-Hunter-Portable-1.2.2-x64.exe -Algorithm SHA256
gh attestation verify .\Open-Job-Hunter-Portable-1.2.2-x64.exe --repo andminin-engineering/open-job-hunter
```

Code signing through SignPath Foundation remains pending approval. Windows
SmartScreen may therefore display a warning; verify the published integrity
evidence before running the application.
