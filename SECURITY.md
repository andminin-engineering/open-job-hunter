# Security policy

## Supported versions

Security fixes are applied to the latest published release.

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in a public issue. Use GitHub's **Security → Report a vulnerability** flow for this repository. Include affected versions, reproduction steps, impact and any proposed mitigation.

The maintainer will acknowledge a complete report as soon as practical, assess severity, coordinate a fix and publish disclosure details after users have a reasonable opportunity to update.

## Release integrity

Release builds are produced from a locked dependency graph in GitHub Actions. The pipeline runs compilation, automated tests, a high-severity dependency audit, runtime checks and Microsoft Defender scanning. It publishes:

- SHA-256 checksums;
- a CycloneDX software bill of materials (SBOM);
- GitHub/Sigstore build-provenance and SBOM attestations.

Verify an artifact downloaded from GitHub with:

```powershell
Get-FileHash .\Open-Job-Hunter-Portable-<version>-x64.exe -Algorithm SHA256
gh attestation verify .\Open-Job-Hunter-Portable-<version>-x64.exe --repo andminin-engineering/open-job-hunter
```

Unsigned releases can still trigger Microsoft SmartScreen. Provenance and hashes establish build origin and integrity but do not replace Authenticode publisher identity. Trusted code signing is tracked as the next distribution milestone.
