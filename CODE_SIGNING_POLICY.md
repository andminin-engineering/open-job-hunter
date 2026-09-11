# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Scope

This policy covers official Open Job Hunter Windows artifacts published from `andminin-engineering/open-job-hunter`. Only artifacts built from this repository's maintained source and release workflow may be submitted for signing. Upstream binaries included as dependencies must not be signed as if they were authored by this project.

## Team roles

- **Committer and maintainer:** [Andrea Minín / andminin-engineering](https://github.com/andminin-engineering) — owns the repository and may modify maintained source and build definitions.
- **Reviewer for external contributions:** Andrea Minín — reviews changes proposed by contributors who do not have commit access before merge. Automated analysis and LLM reviews are supplementary evidence and never replace accountable human review.
- **Signing approver:** Andrea Minín — manually verifies and approves or rejects every signing request.

If the team grows, this section must be updated before granting repository or signing permissions. No person or automation receives signing authority merely by contributing code.

## Required release controls

Every signing request must:

1. Refer to an immutable Git tag and source commit in this repository.
2. Be produced by `.github/workflows/release.yml` from the committed lockfile.
3. Pass compilation, unit tests, runtime tests, dependency audit and Microsoft Defender scanning.
4. Produce SHA-256 checksums, a CycloneDX SBOM and GitHub/Sigstore provenance attestations.
5. Receive manual approval from the signing approver after the evidence and exact artifact metadata have been reviewed.
6. Use `Open Job Hunter` consistently as the product name and use one product version across all project-owned binaries in the release.

Rejected or superseded artifacts must not be signed. Signed artifacts must not be modified after signing.

## Repository and account security

Maintainers, reviewers and signing approvers must use multi-factor authentication for GitHub and SignPath. Credentials and signing permissions must never be committed to the repository. GitHub Actions are pinned to immutable commit SHAs and receive only the permissions required by their jobs.

## Privacy

Open Job Hunter does not transfer information to networked systems unless specifically requested by the user or by the person installing or operating it. The precise local storage and user-triggered network interactions are documented in the [Privacy policy](./PRIVACY.md).

## Incident handling

Suspected compromise of a maintainer account, workflow, dependency or signed artifact must be reported through the process in [SECURITY.md](./SECURITY.md). Signing must be suspended during investigation, and SignPath Foundation will be assisted with verification and root-cause analysis when required.
