# ADR-006: Verifiable release supply chain

- Status: Accepted
- Date: 2026-09-11

## Context

Publishing a checksum beside a locally built executable does not prove which source revision or workflow produced it. An unsigned community binary also lacks a verified publisher identity, increasing friction with Windows SmartScreen.

## Decision

Produce Windows releases in an isolated GitHub-hosted runner from `package-lock.json` using `npm ci`. Pin every GitHub Action dependency to a full commit SHA. Gate artifacts on compilation, tests, runtime checks, dependency audit and Microsoft Defender scanning. Publish SHA-256 hashes, a CycloneDX SBOM and GitHub/Sigstore attestations for provenance and SBOM association.

Authenticode signing remains a separate identity control. Apply for an open-source signing service and prepare MSIX distribution rather than treating attestations as a substitute for Windows code signing.

## Consequences

- Consumers can verify that an artifact originated from this repository's workflow and inspect its dependency inventory.
- Mutable action tags cannot silently change the executed release code.
- Release builds take longer and depend on GitHub's Windows and attestation services.
- SmartScreen warnings may continue until trusted publisher signing or Microsoft Store distribution is implemented.
