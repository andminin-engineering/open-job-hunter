# Public beta testing guide

Thank you for helping make Open Job Hunter useful for people in different professions. This is beta software: keep your own record of applications and review every AI-generated recommendation before acting on it.

## Before you start

1. Download only from the repository's official GitHub Releases page.
2. Compare the executable's SHA-256 hash with `SHA256SUMS.txt` in the same release.
3. Install and start [Ollama](https://ollama.com), then run `ollama pull qwen2.5:7b`.
4. Never post your CV, job-description text, contact details or credentials in a public issue.

Unsigned beta builds may trigger Windows SmartScreen. A hash and provenance establish build origin, but do not replace an Authenticode signature. If you are not comfortable running an unsigned beta, wait for a signed release.

## Suggested test

1. Start Open Job Hunter and open **Mi perfil**.
2. Replace every example value with your own professional information.
3. Confirm that the header reports the assistant and local AI as ready.
4. Search for a role relevant to your profession.
5. Preview results before selecting **Buscar, evaluar y guardar**.
6. Add one vacancy manually and review the score, strengths and risks critically.
7. Move a saved application to another pipeline stage.
8. Close and reopen the application; confirm that your profile and pipeline remain available.

Source installations can run `npm run doctor` for a privacy-safe local diagnostic. Warnings about an example profile or missing Ollama explain optional setup that is still incomplete; `ERROR` entries indicate a broken installation.

## Send feedback

Open a [Beta feedback issue](https://github.com/andminin-engineering/open-job-hunter/issues/new?template=beta-feedback.yml). Describe your profession in general terms and report whether the evaluation represented it fairly. Use the separate bug template for reproducible defects and GitHub private vulnerability reporting for security issues.

If the project is useful to you, starring the repository helps other people discover it and provides a legitimate signal of community interest. A star is appreciated but never required to test, report a problem or contribute.

## Removing the beta

Follow the uninstall and data-deletion instructions in the [Privacy policy](../PRIVACY.md). Uninstalling intentionally preserves user data until you explicitly remove its directory.
