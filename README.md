# DeepSeek OCR Studio

**Version 0.1.0 · Public Beta**

A static, browser-only OCR workstation for the [official DeepSeek OCR API](https://api-docs.deepseek.com/guides/ocr). Upload images, PDFs, Word documents, or PowerPoint files, extract editable text in Standard or Rich layout mode, then edit, copy, or export the result. No application backend is required.

## Release status

Public Beta. The core workflow is feature-complete and covered by automated tests and manual release browser checks. The initial 0.1.0 release is suitable for evaluation and low-sensitivity personal use; live OCR accuracy, regulated data, and high-volume workloads remain outside the current validation scope.

**[Try the app online](https://idrismalik.github.io/deepseek-ocr/)** · [Open demo mode without a key](https://idrismalik.github.io/deepseek-ocr/?demo=1). Live OCR requires an internet connection and a DeepSeek API key with available balance.

## Getting started

Install Node.js 22.12 or later, then:

```sh
git clone https://github.com/IdrisMalik/deepseek-ocr.git
cd deepseek-ocr
npm install
npm run dev
```

Open http://localhost:5173. Click the key icon, enter your DeepSeek API key, and select **Check and save**. To explore the interface without a key, open http://localhost:5173/?demo=1; demo mode returns local sample text, sends nothing to DeepSeek, and does not save a key entered in demo mode.

To build the static site:

```sh
npm run build
```

The output is written to `dist/`. Relative asset paths keep it loadable from a static host or a GitHub Pages project path.

## Usage

1. Add files with **browse**, drag and drop, or paste from the clipboard. The workspace accepts up to 20 files, up to 100 MiB each.
2. Choose **Standard text** for plain text, or **Rich layout** for layout-aware page OCR that can preserve headings and tables. Standard is the safer default for long, dense documents.
3. Select **Extract text**. New or pending files are processed while completed results are kept; when every file is already done, the action becomes **Re-extract all**. Up to six requests run concurrently, and completed files appear as they settle.
4. Edit the recognized text, copy it, or download it as `.txt` or `.md`. **Revert** restores the last extracted text. Rotating a completed image clears its result so it can be extracted again in the new orientation. Identifiers printed in the source document remain part of the text and are included in exports.

Cancelling or clearing the workspace aborts in-flight requests and discards pending retries. Removing the API key during a batch also cancels that batch. Files and results stay in memory for the current page; only the API key is persisted.

## Features

- 11 input formats: PNG, JPEG, WebP, GIF, BMP, TIFF, PDF, DOC, DOCX, PPT, and PPTX. The app checks the declared type, size, and leading bytes before upload; full document parsing is delegated to DeepSeek.
- Standard text and Rich layout recognition, with layout tokens removed and simple HTML tables normalized to readable Markdown rows.
- A bounded, work-conserving queue with per-file retries, rate-limit handling, cancellation, and progress.
- Editable results with Revert, copy, and `.txt` / `.md` downloads.
- Responsive single-pane and dual-pane layouts, light and dark themes, keyboard navigation, visible focus indicators, and reduced-motion support.
- A production Content-Security-Policy, original-Blob uploads, and cached image preparation.

## Data and storage

The API key is verified with `GET https://api.deepseek.com/models`, then stored in this browser's `localStorage`. It is sent only to DeepSeek and is never part of the build or a server. The field is masked by default; the eye button reveals or hides it, and it returns to masked when settings close or reopen. Use **Remove** in key settings to erase the key; this also cancels a running batch.

Files are sent directly from the browser to DeepSeek for recognition, together with the original file name. DeepSeek documents that OCR files are not stored in the Files API and are not passed to a chat model, but file content does leave your device. Avoid sensitive files and shared devices. Demo mode sends nothing to DeepSeek and does not store a key entered in demo mode.

Results are not persisted. The production bundle has no runtime npm dependencies; build and test tooling is installed as dev dependencies only. See the [security policy](SECURITY.md) for the browser-storage trade-off and reporting process.

## Development

| Command                | Description                       |
| ---------------------- | --------------------------------- |
| `npm run dev`          | Start the development server      |
| `npm run build`        | Type check and build into `dist/` |
| `npm run type`         | Run TypeScript type checks        |
| `npm run lint`         | Lint with oxlint                  |
| `npm run format`       | Format source and tests           |
| `npm run format:check` | Check source and test formatting  |
| `npm test`             | Run automated tests               |
| `npm run test:browser` | Build and run browser smoke tests |
| `npm run test:ocr`     | Validate and run the OCR evaluation suite |
| `npm run preview`      | Preview the static build          |

### Testing

The Node test suite covers the request queue, retry policy, response parsing and invariants, file validation and upload preparation (including canvas rotation), text cleanup, export helpers, key visibility, and release metadata/config. Run it with `npm test`.

Browser smoke tests (`npm run test:browser`) drive the production build in a real Chromium: demo-mode intake, extraction, editing, rotation, result tabs, clearing, live-mode cancellation, and recovery from a fully failed batch. Live-mode cases intercept the OCR endpoint with Playwright route mocking, so nothing is sent to DeepSeek and no key or charges are required. In CI they run against the same `dist/` artifact that is deployed.

Remaining UI details — focus restoration across rebuilds, responsive layouts, and failure paths beyond the smoke flows — are checked in a browser during release validation.

### OCR evaluation suite

`tests/ocr-eval/` contains 29 fixtures (20 images and 9 documents), page-level ground truth, 134 authorized API recordings, offline parser checks and regression metrics, and a gated live runner. It is an evidence and regression suite for this app, not a production accuracy claim for arbitrary documents.

```sh
npm run test:ocr
```

`test:ocr` runs the structural validator and the offline evaluator; `test:ocr:validate` and `test:ocr:eval` run each part separately. See its [`README.md`](tests/ocr-eval/README.md) before running live checks; live runs use your API key and incur provider charges.

## Architecture

The application is a single-page TypeScript build with no backend and no runtime dependencies. Validation and image preparation run in the browser; only key verification and OCR requests go to DeepSeek.

1. Intake resolves the MIME type, checks size and leading bytes, and rejects unsupported or empty files.
2. Documents and unrotated images are sent as their original `Blob`, avoiding base64 and canvas copies. A rotated image is redrawn as PNG on a canvas. Prepared payloads are cached across retries.
3. A bounded queue sends one `multipart/form-data` request per file to `POST https://api.deepseek.com/v1/tools/ocr` with the selected `purpose`.
4. Responses are validated for page count, page indexes, duplicates, and ordering, parsed page by page, normalized from layout tokens and simple HTML tables into editable text, and shown for editing and export.

The queue runs at most six requests at once. DeepSeek allows 15 recognitions in progress per account, so six leaves headroom for other clients using the same key. Each file gets three attempts. A transient failure releases its queue slot before waiting, using exponential backoff from 500 ms to 8 s with ±25% jitter.

- **Retried automatically:** 408, 429, and 5xx responses except 504.
- **Not retried automatically:** 400, 401, 402, 403, 413, 422, 504, recognition timeouts, network failures, and client-side timeouts.
- **`Retry-After`:** honored on 429 and 503 when the browser exposes the header through CORS, capped at 30 seconds; otherwise exponential backoff applies.
- **Requests:** time out after 180 seconds.

Network failures and timeouts are excluded from automatic retries because DeepSeek may already be processing the file and bill it. The failed file card offers a manual **Retry** action.

```text
src/
  index.html            Static entry document
  main.ts               Entry point: styles and mountApp()
  app/                  Application shell, state, and global styles
  components/           File, result, settings, and base UI components
  i18n/                 User-facing strings and interpolation
  services/             OCR client, file intake, formats, and key storage
  utils/                Config, retry, queue, formatting, and validation helpers
tests/                  Unit and browser tests, OCR evaluation suite, fixtures
public/                 Favicon, robots.txt, and .nojekyll
```

## Deployment

`.github/workflows/pages.yml` runs formatting checks, type checks, linting, tests, the production build, browser smoke tests, and a production-dependency audit on pushes and pull requests. Deployment to GitHub Pages runs only for pushes to `main` or a manual dispatch. Actions are pinned to commit SHAs, and Dependabot keeps npm and Action updates visible.

`vite.config.ts` uses `base: './'`, keeps `public/` and `dist/` at the repository root while the entry document lives in `src/`, and injects the production CSP meta tag. No repository secrets are required.

For a fork, enable **Settings → Pages → Build and deployment → GitHub Actions** once.

## Troubleshooting

- **401 or 403:** verify the key and confirm it has OCR access.
- **402:** add balance to the DeepSeek account.
- **413:** choose a file at or below 100 MiB.
- **429 or 503:** the account or service is busy. The app backs off automatically; if it still fails, wait and use **Retry**.
- **504 or recognition timeout:** send a smaller file or split the document. These are not retried automatically.
- **Connection lost:** the provider may already have received the file. Check the account before using **Retry**.
- **No text found:** try a clearer image or a different format. Empty results are not retried.
- **Requests blocked or unreachable:** the OCR endpoint's CORS behavior is not a documented contract. Check the browser console and network panel.
- **Demo mode:** `?demo=1` sends nothing to DeepSeek and does not accept or save a key.

## Limitations

- Live OCR needs network access and a valid key; `?demo=1` returns simulated output only.
- The API accepts files up to 100 MiB and 1,000 pages. The app checks the file size but not the page count.
- Large files are held in browser memory while queued. Original-Blob uploads avoid an extra base64 copy, but memory still scales with the number and size of selected files.
- Rotating a very large image requires a browser canvas at its native dimensions; devices with small memory or canvas-size limits may fail on that operation.
- The interface targets current evergreen browsers and uses modern APIs such as container queries and `AbortController`.
- CORS on the OCR endpoint is implementation behavior, not a documented contract.
- The browser-stored key is XSS-sensitive; that is the trade-off for a server-free deployment. The production CSP reduces, but does not eliminate, that risk.
- Live calls are billed by DeepSeek through your own key. Cancelling stops the client request, but a recognition that DeepSeek has already received may finish and be billed.
- DeepSeek may return empty text; the app reports it as a non-retryable error.
- Rich layout output is recognized page by page. It can preserve headings, emphasis, and simple tables as editable Markdown, but it can also miss or reorder text on dense multi-column pages. Use Standard for long dense documents; Standard truncation offers a manual **Try Rich layout** retry.
- The OCR model may omit running headers, footers, or some display titles. In testing, a two-column report lost its top display title in both modes.
- Multi-page TIFF and animated GIF behavior is undocumented by the API. In testing, each returned one page/frame; split multi-frame files before upload if every page is required. The app shows a one-time notice when a TIFF or GIF is added.
- The included evaluation suite records provider behavior on synthetic fixtures. It is not a production OCR accuracy or multilingual benchmark for arbitrary documents or handwriting.
- The production bundle has no runtime npm dependencies and the production audit is clean; development-only advisories may remain in build tooling when no patched release exists (see the [security policy](SECURITY.md)).

Official documentation: [OCR guide](https://api-docs.deepseek.com/guides/ocr) · [OCR API reference](https://api-docs.deepseek.com/api/ocr)

## License

MIT — see [LICENSE](LICENSE).
