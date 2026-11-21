# Changelog

All notable changes to this project are documented here.

This project follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) and
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Release headings use `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD`. Prereleases append a SemVer
prerelease identifier (for example `## [0.2.0-beta.1] - 2026-12-01`). Build metadata is omitted
from changelog headings because it does not affect precedence. Add entries under
`[Unreleased]` first, then move them into the release heading. Mark incompatible changes as
**Breaking**; they require a MAJOR increment after `1.0.0`, or a MINOR increment during `0.y.z`.

The `0.1.0` entry records the tagged Public Beta baseline. `[Unreleased]` records changes merged
after that tag that have not yet been assigned a release version.

## [Unreleased]

### Added

- OCR evaluation suite with fixtures, ground truth, authorized recordings, offline regression
  metrics, and a gated live runner.
- Browser smoke tests against the production build, canvas-rotation unit coverage, and
  interaction regressions for focus restoration, responsive layouts, partial batch recovery,
  result preservation, and Rich-layout retry.
- Evaluation asset provenance and license notices.
- Semantic Versioning 2.0.0 policy, public compatibility contract, and automated version
  metadata validation.

### Changed

- Preserve completed results, invalidate rotated extractions, and offer a manual Rich layout
  retry for truncated Standard output.
- Remove redundant accept-list generation, unused upload metadata, and dead result and
  thumbnail style hooks.
- Normalize rich-layout markup and HTML tables, handle private-use DOCX bullets, and surface
  multi-frame TIFF/GIF limitations.
- Improve dense thumbnail controls and the short-landscape result layout.
- Pin the GitHub Actions runner image and expand CI coverage.
- Modernize README, security, versioning, and OCR evaluation documentation; align commands and
  validation scope with the implementation.

### Fixed

- Preserve the last successful result and manual edits when a retry or re-extraction fails or is
  cancelled; replace them only after a new extraction succeeds.
- Show the Rich layout retry only when an active Standard result is truncated, avoiding a no-op
  action in mixed-mode batches.
- Align the Ctrl/Cmd+Enter shortcut with pending-file extraction so completed results and edits
  are preserved, and ignore it while a settings panel or editable field has focus.
- Correct the DOCX private-use bullet reference to `U+F0B7`, clarify that DOC and PPT lack
  fixtures, and refresh evaluation checksums.

## [0.1.0] - 2026-11-18

### Added

- Initial Public Beta release of the static, browser-only OCR application.
- Intake for 11 image and document formats with client-side type, size, and leading-byte checks.
- Standard text and Rich layout extraction through the DeepSeek OCR API, with a six-request
  queue, bounded retries, cancellation, and progress reporting.
- Editable results with revert, copy, `.txt` and `.md` export, and image rotation.
- Browser-local API key storage, key verification, demo mode, and a production
  Content-Security-Policy.
- Unit tests and GitHub Pages CI and deployment.

[Unreleased]: https://github.com/IdrisMalik/deepseek-ocr/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/IdrisMalik/deepseek-ocr/releases/tag/v0.1.0
