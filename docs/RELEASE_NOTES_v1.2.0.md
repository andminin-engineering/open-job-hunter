# Open Job Hunter v1.2.0

## Highlights

- Choose Spanish or English for the AI evaluation narrative independently from the languages listed as professional skills.
- Start from an empty onboarding form instead of accidentally saving the shipped example profile.
- Navigate large application histories with server-side search, ordering, real totals and paginated loading.
- Keep active applications, **Con oferta**, rejections, personal discards, unevaluated vacancies and legacy states visible without rewriting stored data.
- Preserve keyboard focus and provide accessible status announcements while loading more vacancies.

## Privacy and compatibility

- Existing profiles remain compatible and default to Spanish evaluation responses.
- Existing pipeline data is not migrated or renamed. The stored `oferta` state is displayed as **Con oferta** because receiving an offer does not imply accepting it.
- Legacy `aplicada` and `entrevista_inicial` records remain visible and read-only.
- Evaluation continues to run through the user's local Ollama instance.

## Known limitations

- Windows executables are currently unsigned and may trigger Microsoft SmartScreen. Verify `SHA256SUMS.txt` and the GitHub build-provenance attestation before running them.
- The selected response language applies to the evaluation narrative. Email drafts, application packages and some interface text retain their existing language behavior.
- Local model output can contain incorrect claims or occasional words in another language. Review every recommendation against the original vacancy and your profile.
- Automatic application submission and automatic updates are not provided.
- The dependency audit has no high or critical findings. Moderate findings remain in the Electron packaging toolchain; they are not part of the application runtime path.

## Verification artifacts

The release workflow publishes the Windows installer, portable executable, SHA-256 manifest and CycloneDX SBOM. It also runs the complete build, unit-test, runtime-test, doctor, dependency-audit and Microsoft Defender gates and creates GitHub provenance and SBOM attestations.
