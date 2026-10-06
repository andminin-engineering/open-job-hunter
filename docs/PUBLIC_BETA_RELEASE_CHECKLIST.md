# Public beta release checklist

This checklist does not authorize a release. The human owner must explicitly approve the tag, publication and external announcement after reviewing the evidence.

## Product readiness

- [x] The example profile contains no real person's background and evaluations are blocked until the user configures a profile.
- [x] Missing Ollama and missing-model states display actionable guidance.
- [ ] A clean Windows installation completes the flow in `BETA_TESTING.md`.
- [x] Installer and portable edition start with isolated data, and silent uninstall removes the temporary installation. User-data retention remains documented separately.
- [x] Known limitations are recorded in `RELEASE_NOTES_v1.2.0.md`.

## Quality and security

- [x] `npm ci --ignore-scripts`
- [x] `npm run build`
- [x] `npm test`
- [x] `npm run test:runtime`
- [x] `npm run doctor`
- [x] `npm audit --audit-level=high`
- [x] Independent review coverage of the exact release diff, including workflows and build scripts. Coverage was split by authorship; no provider approved code it authored.
- [x] Human owner authorized the merge and the reviewed release sequence.
- [x] No unresolved critical/high review findings.
- [x] Private vulnerability reporting is enabled.
- [ ] GitHub account MFA is confirmed by the human owner; the available API token cannot read this account setting.

## Release evidence

- [x] Immutable tag `v1.2.0` points to reviewed commit `0635efa081a07ffcf06cda47c0128b72bdb38d35` and matches `package.json`.
- [x] [GitHub-hosted workflow](https://github.com/andminin-engineering/open-job-hunter/actions/runs/37463765942) built the Windows artifacts from the committed lockfile.
- [x] Microsoft Defender scan passed.
- [x] SHA-256 manifest and CycloneDX SBOM are published beside both executables.
- [x] Each executable has GitHub build-provenance and SBOM attestations for its published SHA-256 digest.
- [x] Product and file version metadata match `v1.2.0`.
- [x] [Release `v1.2.0`](https://github.com/andminin-engineering/open-job-hunter/releases/tag/v1.2.0) is the stable channel and identifies the Windows artifacts as unsigned.

## Community operations

- [ ] Beta feedback and bug-report forms are enabled.
- [ ] A maintainer is available to acknowledge reports and remove accidentally posted personal data.
- [ ] Feedback is labeled and triaged without copying personal information into project records.
- [ ] The announcement links only to the official release and issue forms.
- [ ] Metrics are recorded in aggregate: downloads, stars, professions represented, issues opened/resolved and completion rate.

## SignPath readiness

Status: code signing through SignPath Foundation has been requested and is pending approval. The current v1.2.0 Windows executables are unsigned; the items below are readiness checks, not evidence of approval or an active signing service.

- [ ] Repository, release and download surfaces link to the Code signing policy.
- [ ] Maintainer, reviewer and signing-approver roles are current.
- [ ] Privacy, security, license and third-party notices are current.
- [ ] Release signing requires origin verification and manual approval.
- [ ] Evidence demonstrates real maintenance and community use; no star exchanges, incentives or artificial activity are used.
