# Versioning and release policy

DeepSeek OCR Studio follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
Release versions use `MAJOR.MINOR.PATCH`, with optional prerelease and build metadata:

```text
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
```

A release tag adds a conventional `v` prefix (`v0.1.0`). The prefix is not part of the
SemVer version.

## Current release

- **Version:** `0.1.0`
- **Status:** Public Beta
- **Compatibility phase:** initial development (`0.y.z`)

`Public Beta` is a product-maturity label. It is reported separately through the
`application-status` metadata and the README. It is not a SemVer prerelease identifier.
Prereleases are identified in the version itself, for example `0.2.0-beta.1`.

While the major version is `0`, the public contract is not yet stable. The minor component is
the compatibility boundary: a backward-incompatible contract change increments `MINOR` and
resets `PATCH`. `PATCH` increments remain backward-compatible fixes. The project will release
`1.0.0` when the public contract is considered stable; that transition is a deliberate release
decision, not an automatic consequence of a particular change.

## Authoritative version source

[`package.json`](package.json) `version` is the authoritative product release version. The
following release-facing references are mirrors and must always match it:

| Reference | Location | Notes |
| --- | --- | --- |
| Package manifest | `package.json` → `version` | Authoritative |
| Lockfile root | `package-lock.json` → `version` and `packages[""].version` | Updated by npm |
| Runtime metadata | `src/index.html` → `<meta name="application-version">` | Shipped in the static build |
| Documentation | `README.md` → `**Version …**` line | Must match the full version |
| Release policy | `VERSIONING.md` → Current release → `Version` | Must match the full version |
| Release history | `CHANGELOG.md` → `## [VERSION]` heading | Uses the version without build metadata |

`npm run version:check` validates the SemVer syntax and every mirror above. `npm test` runs the
same check. The build does not define a separate product version.

Use npm to update the manifest and lockfile without creating a commit or tag:

```sh
npm version <version> --no-git-tag-version
```

Then update the runtime metadata, README, `VERSIONING.md`, and changelog in the same change. Do
not create a version tag, hosted release, or deployment until it has been explicitly approved.

## Public compatibility contract

Version increments are classified against this user-facing contract:

1. **Entry points.** The root page and the documented demo query parameter (`?demo=1`).
2. **Input support.** The documented input formats, file-count limit, per-file size limit, and
   client-side intake checks.
3. **Extraction behavior.** Standard text and Rich layout modes, queue concurrency, retry and
   cancellation behavior, and progress reporting as documented in the README.
4. **Result workflow.** Editing, revert, copy, `.txt` and `.md` export, and the documented image
   rotation behavior.
5. **Key handling and privacy boundary.** Browser-local API key storage, key verification,
   demo mode sending nothing to DeepSeek, and the documented network boundary.
6. **Static deployment.** A `dist/` build that loads from a static host or GitHub Pages project
   path with relative assets and the production Content-Security-Policy.
7. **Documented browser support.** Current evergreen browsers, as limited by the APIs the app
   documents using.

The following are explicitly **not** part of the public contract: internal module or file
layout, DOM structure, CSS classes, test IDs, the `localStorage` key name or encoding, asset
filenames or hashes, cache identifiers, dependency versions, CI configuration, upstream
DeepSeek API behavior, and OCR evaluation schemas, fixtures, or recordings.

## Increment rules

| Change | Increment |
| --- | --- |
| Backward-incompatible change to the public contract (after `1.0.0`) | `MAJOR`; reset `MINOR` and `PATCH` to `0` |
| Backward-incompatible change to the public contract during `0.y.z` | `MINOR`; reset `PATCH` to `0` |
| Backward-compatible functionality addition | `MINOR`; reset `PATCH` to `0` |
| Backward-compatible bug fix or documentation-only correction | `PATCH` |
| Prerelease of an upcoming version | Append `-alpha.N`, `-beta.N`, or `-rc.N`; increment `N` for each prerelease |
| Build metadata only | Append `+BUILD`; it does not change precedence |

Prereleases validate an upcoming product release; they are not a label for internal-only
changes. Do not increment versions for unrelated internal schema versions, dependency updates,
or asset cache identifiers.

### Prerelease identifiers

A prerelease is a hyphen followed by dot-separated identifiers containing only ASCII
alphanumerics and hyphens. Numeric identifiers must not contain leading zeros. Build metadata
uses the same identifier characters after `+`, but leading zeros are allowed and the identifier
does not affect precedence.

Precedence follows SemVer 2.0.0:

```text
1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta
< 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0
```

Build metadata is ignored when comparing versions.

## Release checklist

1. Classify each change against the public contract.
2. Choose the version increment, including a prerelease identifier if applicable.
3. Run `npm version <version> --no-git-tag-version` to update `package.json` and the lockfile.
4. Match the version in `src/index.html`, `README.md`, `VERSIONING.md`, and `CHANGELOG.md`.
5. Move changelog entries from `[Unreleased]` into the release heading and mark breaking changes.
6. Run `npm run version:check`, `npm test`, `npm run type`, `npm run lint`,
   `npm run format:check`, and `npm run build`. Run the browser and OCR evaluation suites when
   the change affects their scope.
7. After approval, create the `v<version>` tag and hosted release. Do not tag or publish automatically.

## Versions outside product versioning

The repository also contains counters that are deliberately independent of the product
version:

- `schema_version` values in `tests/ocr-eval/` identify evaluation data schemas. They are not
  app release versions.
- `/v1/` in the DeepSeek OCR endpoint is the provider's API namespace.
- `version: 2` in `.github/dependabot.yml` is the Dependabot configuration schema.
- Dependency versions in `package-lock.json` belong to their respective packages.
- Content hashes in asset filenames are build cache identifiers.

These values must not be changed merely to match a product release.
