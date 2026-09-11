# Privacy policy

Effective date: 2026-09-11

Open Job Hunter is a local-first, open-source application. It does not operate a developer-controlled account, analytics, advertising or telemetry service.

## Data stored locally

The application may store:

- the professional profile configured by the user;
- discovered job offers and their evaluations;
- application pipeline status and recruiter feedback;
- scheduler preferences;
- optional email-delivery configuration supplied through the runtime environment.

The Windows desktop edition stores profile and pipeline files under the application's per-user data directory, normally `%APPDATA%\open-job-hunter\`. Source and Docker installations use the absolute paths documented in the environment configuration or project defaults.

## Network interactions

Open Job Hunter will not transfer information to other networked systems unless specifically requested by the user or the person installing or operating it. Depending on the operation selected, it can contact:

- **Ollama:** job descriptions and relevant profile information are sent to the configured `OLLAMA_BASE_URL` for evaluation. The default is a service on the same computer. If the operator configures a remote URL, that operator is responsible for the remote service's privacy terms.
- **Job-board and vacancy URLs:** search parameters and ordinary request metadata are sent when the user invokes discovery or enrichment. Content is retrieved from providers such as Remotive, Greenhouse, Lever or a URL supplied by the user. Those providers apply their own privacy policies.
- **SMTP provider:** when email digests are enabled, recipient addresses and digest contents are sent to the SMTP service explicitly configured by the operator. That provider's privacy policy applies.
- **GitHub:** downloading the application or browsing its project pages is governed by GitHub's privacy statement. The application itself does not report usage to GitHub.

The local HTTP interface binds to `127.0.0.1` by default. Exposing it to a network requires an explicit operator configuration change.

## Retention and deletion

Data remains until the user edits or deletes it. Uninstalling the desktop application intentionally does not delete user-created profile and pipeline data. To remove it completely:

1. Close Open Job Hunter.
2. Uninstall the application through Windows Settings if the installed edition was used, or delete the portable executable.
3. Delete `%APPDATA%\open-job-hunter\` if the locally stored profile and pipeline should also be erased.

For source or Docker installations, delete the explicitly configured data and profile paths or their mounted volumes.

## Security and user control

The desktop renderer is sandboxed, Node integration is disabled, HTTP access is loopback-only by default, and cross-origin access requires explicit configuration. No application can guarantee absolute security; vulnerabilities should be reported privately according to [SECURITY.md](./SECURITY.md).

## Changes

Material changes to data handling will be documented in this file and included with the corresponding release. The Git history provides the revision record.

## Contact

Privacy questions may be raised through the repository's issue tracker when they contain no sensitive information. Security-sensitive reports must use GitHub's private vulnerability reporting flow described in [SECURITY.md](./SECURITY.md).
