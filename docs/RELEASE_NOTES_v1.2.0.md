# Open Job Hunter v1.2.0

v1.2.0 is the stable release channel. The public beta is the feedback program around it: testers install this release and report their experience through the Beta feedback form. There is no separate beta build.

## Highlights

- Choose Spanish or English for the AI evaluation narrative independently from the languages listed as professional skills.
- Start from an empty onboarding form instead of accidentally saving the shipped example profile.
- Navigate large application histories with server-side search, ordering, real totals and paginated loading.
- Keep active applications, **Con oferta**, rejections, personal discards, unevaluated vacancies and legacy states visible without rewriting stored data.
- Preserve keyboard focus and provide accessible status announcements while loading more vacancies.

## Other changes since v1.1.0

- Evaluations stay blocked until you save your own profile. The dashboard, HTTP API, MCP tools, batch evaluation, discovery imports and the scheduler all refuse to evaluate against the shipped example profile, and searches no longer assume a software-architecture background.
- Local AI readiness is diagnosed instead of failing with a bare "fetch failed": `/health` and the dashboard report whether Ollama is installed, running and has the configured model pulled, and evaluation is blocked with the corrective step until it is ready.
- Job-board data is escaped before it is rendered in the dashboard and only `http(s)` links are made clickable.
- `npm run doctor` reports local readiness with project paths and user names redacted so its output can be shared in public issues.
- This is the first version built and published by the verifiable Windows release pipeline described below.

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
