# Open Job Hunter v1.2.1

v1.2.1 is a security maintenance release for the Windows desktop application and MCP server. It preserves the features and local data format of v1.2.0.

## Security maintenance

- Updated `@modelcontextprotocol/sdk` to `1.32.1`, resolving [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h) / CVE-2026-104850.
- The application uses the MCP server and standard-input/output transport rather than the affected OAuth client flow, but the vulnerable SDK version is no longer shipped.
- Clarified that the SignPath Foundation code-signing request is pending approval and does not represent an active signing service.

## Existing safeguards

- Release builds run compilation, 62 automated tests, runtime checks, dependency audit and Microsoft Defender scanning.
- The release includes SHA-256 checksums, a CycloneDX SBOM and GitHub build-provenance attestations.
- The professional profile, evaluation history and pipeline remain stored locally.

## Installation and verification

Download either the Setup or Portable executable and verify it against `SHA256SUMS.txt`. GitHub CLI users can also verify provenance:

```powershell
Get-FileHash .\Open-Job-Hunter-Portable-1.2.1-x64.exe -Algorithm SHA256
gh attestation verify .\Open-Job-Hunter-Portable-1.2.1-x64.exe --repo andminin-engineering/open-job-hunter
```

Code signing through SignPath Foundation has been requested and is pending approval. Windows SmartScreen may therefore display a warning; verify the published integrity evidence before running the application.
