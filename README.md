# DeepSeek OCR Studio

**Version 0.1.0**

A static, browser-only OCR workstation for DeepSeek's official OCR API. File validation and preparation run locally; text recognition runs remotely on DeepSeek. There is no application backend and no runtime npm dependency, so the Vite build can be hosted on any static host, including GitHub Pages. Live OCR requires an internet connection and a DeepSeek API key supplied by the user.

## Getting started

Install Node.js 18.17 or later, then:

```sh
npm install
npm run dev
```

Open http://localhost:5173. Click the key icon, enter your DeepSeek API key, and verify it. Append `?demo=1` to try the full interface with deterministic local responses; demo mode does not call the API or require a key.

To build the static site:

```sh
npm run build
```

The output is written to `dist/`. Relative asset paths keep it loadable from a project path such as `https://<owner>.github.io/<repo>/`.

## Features

- Upload by file picker, drag-and-drop, or clipboard paste. Up to 20 files in the workspace; 100 MiB per file.
- All 11 API formats: PNG, JPEG, WebP, GIF, BMP, TIFF, PDF, DOC, DOCX, PPT, PPTX. Content signatures are checked locally; TIFF and other non-rasterizable inputs are forwarded unchanged.
- Standard text and Rich layout extraction modes.
- A bounded, work-conserving request queue with internal retries, rate-limit handling, cancellation, and per-file progress.
- Editable results with Revert, copy to clipboard, and `.txt` / `.md` downloads.
- Responsive single-pane and dual-pane layouts, light and dark themes, keyboard controls, touch targets, and reduced-motion support.

## Architecture

The application is a single-page TypeScript build with no backend and no runtime dependencies. Files are validated and prepared in the browser; only requests to DeepSeek (key verification and OCR) and the API key leave the device.

The request path is:

1. File intake validates the declared type, size, and content signature.
2. Images are decoded and optionally rotated or scaled, then exported as PNG. Documents are forwarded unchanged.
3. A bounded queue runs OCR requests, retries transient failures, and applies results as each file settles.
4. The browser calls `POST https://api.deepseek.com/v1/tools/ocr` with the user's key, the selected `purpose`, and one file per request.
5. Responses are parsed into page results for editing and export. Application state is held in memory; only the API key is persisted.

```text
src/
  index.html            Static entry document
  main.ts               Entry point: styles + mountApp()
  app/                  Application shell, state and global styles
    App.ts              DOM wiring, file intake, OCR workflow
    state.ts            Shared state and derived selectors
    theme.css           Design tokens (light/dark)
    global.css          Layout and component styles
  components/           Presentation modules
    base/               Icons and toast notifications
    files/              File cards and status feedback
    result/             Result tabs and extracted-text pane
  services/             Domain logic
    api/                DeepSeek OCR client, errors, types
    files.ts            File resolution, validation, preprocessing
    formats.ts          Supported-format registry
    settings.ts         Browser-local API key storage
  utils/                Pure helpers (config, retry, queue, format, validate)
  i18n/                 User-facing strings and interpolation
tests/                  Automated tests and format fixtures
public/                 Favicon, robots.txt, .nojekyll
scripts/                Fixture generation helper
```

## Request scheduling and retries

Batches run through a bounded queue in `src/utils/queue.ts`. The limits below are configured in `src/utils/config.ts` and were verified against DeepSeek's OCR documentation for this release:

| Setting | Value | Basis |
| --- | --- | --- |
| Concurrent OCR requests | 6 | DeepSeek allows 15 recognitions in progress per account; staying lower leaves headroom for other clients using the same key. |
| Attempts per file | 3 (first try + 2 retries) | Caps cost and prevents endless retries. |
| Backoff | 500 ms base, 8 s cap, ±25% jitter | Exponential, bounded, and de-synchronised across files. |
| `Retry-After` | Honoured when present, capped at 30 s | DeepSeek does not document this header; the app uses it if a response includes it. |
| Retried statuses | 408, 429, and 5xx plus network errors | Matches the documented retryable failures. 400, 401, 402, 403, 413 and 422 fail immediately. |

A failed attempt releases its queue slot before waiting, so other files keep processing during backoff. Progress advances once per file when it reaches a final state, never per attempt, and results map to files by input order. Completed files appear as they settle; cancelling or clearing aborts in-flight requests, discards pending retries, and ignores late responses from the cancelled batch.

## Data and storage

Your API key is verified with a free `GET /models` call and stored in this browser's `localStorage`; it is sent only to DeepSeek, and is never part of the build or any server. Files are sent directly from your browser to DeepSeek for recognition; DeepSeek documents that OCR files are not stored in its Files API or passed to a chat model, but file content does leave your device. Avoid sensitive files and shared devices. Use **Remove** in key settings to erase the key. The production bundle has no runtime npm dependencies; build and test tooling is installed as dev dependencies only.

## Development

| Command           | Description                       |
| ----------------- | --------------------------------- |
| `npm run dev`     | Start the development server      |
| `npm run build`   | Type check and build into `dist/` |
| `npm run type`    | Run TypeScript type checks        |
| `npm run lint`    | Lint with oxlint                  |
| `npm run format`  | Format with oxfmt                 |
| `npm test`        | Run automated tests               |
| `npm run preview` | Preview the static build          |

## Deployment

`.github/workflows/pages.yml` installs dependencies, runs type checks, lint and tests, builds `dist/`, and deploys it with the standard GitHub Pages actions. `vite.config.ts` uses `base: './'` and keeps `public/` and `dist/` at the repository root while the entry document lives in `src/`. No repository secrets are required.

## Limitations

- No offline OCR: live extraction needs network access and a valid key. `?demo=1` is simulated only.
- Large files are read and encoded in browser memory before upload. Files near the 100 MiB limit can be slow or fail on memory-constrained devices.
- The interface targets current evergreen browsers; it relies on modern APIs such as container queries and `AbortController`.
- CORS on the OCR endpoint is implementation behavior, not a documented contract.
- The browser-stored key is XSS-sensitive; that is the trade-off for a server-free deployment.
- Live calls are billed by DeepSeek through your own key.
- DeepSeek may intermittently return empty text; the app reports it as a clear, non-retryable error.

Official docs: [OCR guide](https://api-docs.deepseek.com/guides/ocr) · [OCR API reference](https://api-docs.deepseek.com/api/ocr)

## License

MIT — see [LICENSE](LICENSE).
