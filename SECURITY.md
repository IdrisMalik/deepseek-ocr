# Security policy

## Supported versions

Security fixes are applied to the latest published release line (`0.1.x`). Unreleased changes on the default branch are not a supported release until a version is published. See [VERSIONING.md](VERSIONING.md) for the current compatibility phase and release policy.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository: **Security → Report a vulnerability**. Do not open a public issue for a suspected credential or data-handling vulnerability.

Include the affected version or commit, reproduction steps, impact, and any relevant browser details. Do not include a real API key or sensitive document.

## Security model

DeepSeek OCR Studio is a static, browser-only application. There is no application backend, no server-side storage, and no runtime npm dependency in the production bundle.

- **API key.** The key is verified with `GET https://api.deepseek.com/models`, then stored in the current browser's `localStorage`. It is sent only to DeepSeek as a Bearer token. It is never included in the build or sent to this site's hosting provider.
- **Production CSP.** The production build injects a Content-Security-Policy meta tag that restricts scripts and styles to the site origin, images to same-origin and `blob:` URLs, and network requests to the site origin and `https://api.deepseek.com`. GitHub Pages cannot set response headers, so the policy is delivered as a meta tag.
- **Files.** Files are sent directly from the browser to DeepSeek for recognition, together with the original file name. DeepSeek documents that OCR files are not stored in its Files API and are not passed to a chat model. File content still leaves the device.
- **No secrets in the repository.** API keys are user-supplied at runtime and are not committed.
- **Dependencies.** The production bundle has no runtime dependencies. Development and build tooling is monitored through Dependabot and a production-dependency audit in CI.

## Known limitations

- A browser-stored key is exposed to same-origin script execution, malicious extensions, and shared-device use. There is no server-side secret boundary.
- The app cannot enforce per-account concurrency across other clients using the same key. DeepSeek remains the authority for rate limits and billing.
- Network failures, HTTP 504, client-side timeouts, and recognition timeouts are not retried automatically because the provider may already be processing the file. The user can retry manually.
- The OCR endpoint's CORS behavior is an implementation detail. `Retry-After` is used only when the browser exposes it.
- Live OCR quality, multilingual accuracy, and large-document performance are not established by the automated suites. The OCR evaluation suite records provider behavior on synthetic fixtures only.
- Development-only advisories may remain in build tooling when no patched release exists. They do not ship in the browser bundle; see the audit output before each release.

## Dependency policy

- Keep the production dependency set empty unless a runtime dependency is strictly necessary.
- Prefer small, maintained packages and pinned GitHub Actions.
- Review Dependabot updates and run formatting, type checks, linting, tests, the production build, and `npm audit --omit=dev --audit-level=high`.
- Do not use `npm audit fix --force` without reviewing the resulting major-version changes.
