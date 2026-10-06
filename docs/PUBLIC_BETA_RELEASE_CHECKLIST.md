# Public beta release checklist

This checklist does not authorize a release. The human owner must explicitly approve the tag, publication and external announcement after reviewing the evidence.

## Product readiness

- [ ] The example profile contains no real person's background and evaluations are blocked until the user configures a profile.
- [ ] Missing Ollama and missing-model states display actionable guidance.
- [ ] A clean Windows installation completes the flow in `BETA_TESTING.md`.
- [ ] Installer, portable edition and uninstall/data-removal behavior are verified.
- [ ] Known limitations are recorded in the release notes.

## Quality and security

- [ ] `npm ci --ignore-scripts`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run test:runtime`
- [ ] `npm run doctor`
- [ ] `npm audit --audit-level=high`
- [ ] Independent review coverage of the exact `main...release` diff, including workflows and build scripts. Coverage may be split by authorship; no provider approves code it authored.
- [ ] Human owner records the final merge and release authorization, including any explicitly accepted review waiver or non-blocking findings.
- [ ] No unresolved critical/high review findings.
- [ ] GitHub account MFA and private vulnerability reporting are enabled.

## Release evidence

- [ ] Immutable release tag (candidate: `v1.2.0`) points to the reviewed commit and exactly matches `package.json`.
- [ ] GitHub-hosted workflow builds the Windows artifacts from the committed lockfile.
- [ ] Microsoft Defender scan passes.
- [ ] SHA-256 manifest and CycloneDX SBOM are published beside the executables.
- [ ] GitHub build-provenance and SBOM attestations verify successfully.
- [ ] Product name and version metadata match the tag.
- [ ] Release is marked **Pre-release** and identifies the artifact as unsigned when applicable.

## Community operations

- [ ] Beta feedback and bug-report forms are enabled.
- [ ] A maintainer is available to acknowledge reports and remove accidentally posted personal data.
- [ ] Feedback is labeled and triaged without copying personal information into project records.
- [ ] The announcement links only to the official release and issue forms.
- [ ] Metrics are recorded in aggregate: downloads, stars, professions represented, issues opened/resolved and completion rate.

## SignPath readiness

- [ ] Repository, release and download surfaces link to the Code signing policy.
- [ ] Maintainer, reviewer and signing-approver roles are current.
- [ ] Privacy, security, license and third-party notices are current.
- [ ] Release signing requires origin verification and manual approval.
- [ ] Evidence demonstrates real maintenance and community use; no star exchanges, incentives or artificial activity are used.
