# DeepSeek OCR Studio

**Version 0.1.0**

A static, browser-only OCR workstation for the [official DeepSeek OCR API](https://api-docs.deepseek.com/guides/ocr). Upload images, PDFs, Word documents, or PowerPoint files, extract editable text in Standard or Rich layout mode, then edit, copy, or export the result. No application backend is required.

You can [try the app online](https://idrismalik.github.io/deepseek-ocr/) or [open the demo without an API key](https://idrismalik.github.io/deepseek-ocr/?demo=1). Live OCR requires an internet connection and a DeepSeek API key with available balance.

## Getting started

Install Node.js 22.12 or later, then:

```sh
git clone https://github.com/IdrisMalik/deepseek-ocr.git
cd deepseek-ocr
npm install
npm run dev
```

Open http://localhost:5173. Click the key icon, enter your DeepSeek API key, and select **Verify and save**. To explore the interface without a key, open http://localhost:5173/?demo=1; demo mode returns local sample text and makes no API calls.

To build the static site:

```sh
npm run build
```

The output is written to `dist/`. Relative asset paths keep it loadable from a static host or a GitHub Pages project path.

## Usage

1. Add files with **browse**, drag and drop, or paste from the clipboard. The workspace accepts up to 20 files, up to 100 MiB each.
2. Choose **Standard text** for plain text, or **Rich layout** to recognize every page with layout-aware output.
3. Select **Extract text**. Up to six requests run concurrently, and completed files appear as they settle.
4. Edit the recognized text, copy it, or download it as `.txt` or `.md`. **Revert** restores the last extracted text.

Cancelling or clearing the workspace aborts in-flight requests and discards pending retries. Files and results stay in memory for the current page; only the API key is persisted.

## Features

- 11 input formats: PNG, JPEG, WebP, GIF, BMP, TIFF, PDF, DOC, DOCX, PPT, and PPTX. The app checks the declared type, size, and leading bytes before upload.
- Standard text and Rich layout recognition, with layout-control tokens removed from editable output.
- A bounded, work-conserving queue with per-file retries, rate-limit handling, cancellation, and progress.
- Editable results with Revert, copy, and `.txt` / `.md` downloads.
- Responsive single-pane and dual-pane layouts, light and dark themes, keyboard controls, and reduced-motion support.

## Data and storage

The API key is verified with `GET https://api.deepseek.com/models`, then stored in this browser's `localStorage`. It is sent only to DeepSeek and is never part of the build or a server. Use **Remove** in key settings to erase it.

Files are sent directly from the browser to DeepSeek for recognition. DeepSeek documents that OCR files are not stored in the Files API and are not passed to a chat model, but file content does leave your device. Avoid sensitive files and shared devices.

Results are not persisted. The production bundle has no runtime npm dependencies; build and test tooling is installed as dev dependencies only.

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

## Architecture

The application is a single-page TypeScript build with no backend and no runtime dependencies. Validation and image preparation run in the browser; only key verification and OCR requests go to DeepSeek.

1. Intake resolves the MIME type, checks size and leading bytes, and rejects unsupported or empty files.
2. Raster images can be rotated, then are exported as PNG at up to 4096 px on the longest side. PDF, Word, PowerPoint, and TIFF files are forwarded unchanged because DeepSeek detects the format from content.
3. A bounded queue sends one `multipart/form-data` request per file to `POST https://api.deepseek.com/v1/tools/ocr` with the selected `purpose`.
4. Results are parsed page by page, layout-control tokens are removed, and text is shown for editing and export.

The queue runs at most six requests at once. DeepSeek allows 15 recognitions in progress per account, so six leaves headroom for other clients using the same key. Each file gets three attempts. A transient failure releases its queue slot before waiting, using exponential backoff from 500 ms to 8 s with ±25% jitter; `Retry-After` is honored up to 30 s. 408, 429, and 5xx responses plus network errors are retried; 400, 401, 402, 403, 413, and 422 fail immediately. Requests time out after 180 seconds.

```text
src/
  index.html            Static entry document
  main.ts               Entry point: styles and mountApp()
  app/                  Application shell, state, and global styles
  components/           File, result, and base UI components
  i18n/                 User-facing strings and interpolation
  services/             OCR client, file intake, formats, and key storage
  utils/                Config, retry, queue, formatting, and validation helpers
tests/                  Automated tests and format fixtures
public/                 Favicon, robots.txt, and .nojekyll
```

## Deployment

`.github/workflows/pages.yml` runs on every push to `main`: it installs dependencies, checks types, lints, tests, builds `dist/`, and deploys with GitHub Pages. Actions are pinned to commit SHAs for reproducible deployments. `vite.config.ts` uses `base: './'` and keeps `public/` and `dist/` at the repository root while the entry document lives in `src/`. No repository secrets are required.

For a fork, enable **Settings → Pages → Build and deployment → GitHub Actions** once.

## Limitations

- Live OCR needs network access and a valid key; `?demo=1` returns simulated output only.
- The API accepts files up to 100 MiB and 1,000 pages. The app checks the file size but not the page count.
- Large files are read and encoded in browser memory. Files near the 100 MiB limit can be slow or fail on memory-constrained devices.
- The interface targets current evergreen browsers and uses modern APIs such as container queries and `AbortController`.
- CORS on the OCR endpoint is implementation behavior, not a documented contract.
- The browser-stored key is XSS-sensitive; that is the trade-off for a server-free deployment.
- Live calls are billed by DeepSeek through your own key. Cancelling stops the client request, but a recognition that DeepSeek has already received may finish and be billed.
- DeepSeek may return empty text; the app reports it as a non-retryable error.
- Rich layout output is recognized page by page, but layout-control tokens are removed from the editable text and visual formatting is not reconstructed.

Official documentation: [OCR guide](https://api-docs.deepseek.com/guides/ocr) · [OCR API reference](https://api-docs.deepseek.com/api/ocr)

## License

MIT — see [LICENSE](LICENSE).
