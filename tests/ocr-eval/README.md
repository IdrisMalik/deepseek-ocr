# OCR evaluation suite

**Fixture snapshot:** 2026-11-18. The suite contains 29 frozen fixtures (20 images and 9 documents), page-level ground truth, 134 authorized API recordings, an offline evaluator, and a validator. It evaluates both `text_recognition` (Standard) and `rich_layout_recognition` (Rich layout) through the same response parser used by DeepSeek OCR Studio.

## What this suite answers

- Does the app recover the text that is actually present, in a usable order?
- Does Rich layout preserve headings, tables, emphasis, and page structure without leaking `ref`/`box` markup into editable text?
- Do document workflows (PDF, DOCX, PPTX, multi-page, native Office) preserve text and page envelopes?
- Does the app handle empty results, provider error envelopes, and `finish_reason=length` deterministically, even when the provider is variable?
- Which observed gaps are provider behavior, and which would be app defects?

It does **not** claim production OCR accuracy. The fixtures are synthetic or purpose-built, and the recordings are evidence from authorized evaluation sessions, not a human-labeled real-world benchmark.

## Contents

```text
images/                      20 image fixtures (T01-T15, T19, T26-T29)
documents/                   9 document fixtures (T16-T18, T20-T25)
ground_truth/ground_truth.json
                             Page-level references, expectation classes, and known gaps
recordings/live-2026-11-18/  134 authorized response recordings
recordings/runs/             New live runs (created on demand; ignored by Git)
reports/offline_baseline.json
                             Parser and metric baseline for repeatable offline comparison
tools/eval.ts                Offline invariants, metrics, baseline, and gated live runner
tools/validate.py            Structural, reference, recording, and checksum validation
tools/generate_fixtures.py   Byte-reproducible generator for T01-T15
tools/provenance/            Generators for the frozen T16-T29 corpus and original corpus GT
manifest.csv                 Per-fixture purpose, category, expectation, and criteria
coverage.csv                 API, app-workflow, model, and documentation-gap coverage
```

T01-T15 are byte-reproducible on the verified Windows/Python 3.13/Pillow 13.0.0 environment from the bundled fonts; the version is pinned in `requirements.txt`. Running `tools/generate_fixtures.py` replaces only T01-T15 and leaves the frozen T16-T29 files untouched. T16-T29 are frozen: their generators depend on ReportLab, Office libraries, Pillow, and Windows system fonts, and T29 is deliberately corrupt, so the exact bytes rather than the generators are pinned by SHA-256.

Five redundant corpus cases were excluded from the adopted suite: `01_simple_text.png` duplicates T01/T16, `03_two_column.png` duplicates T03/T17, `10_rotated_12deg.png` duplicates T09, `12_low_contrast.png` duplicates T10, and the standalone `18_chart.png` is already embedded in T22. The original corpus ground truth remains under `tools/provenance/`.

`manifest.csv` uses `frames` for encoded image frames and `pages` for document pages; a blank value means not applicable. `coverage.csv` maps `API-*`, `APP-*`, `MODEL-*`, and `GAP-*` rows to fixture coverage and recorded outcomes.

## Quick start: offline

From the repository root:

```sh
npm run test:ocr
```

That runs the structural validator and then the offline evaluator. Run either part alone with:

```sh
npm run test:ocr:validate
npm run test:ocr:eval
```

The offline suite runs on demand; CI covers static checks, unit tests, the production build, and
browser smoke tests. Run the OCR suite before a release that changes parsing, fixtures, or
reference data.

Requirements:

- Python 3.10 or later, verified with Python 3.13 and the versions pinned in `requirements.txt`,
  available as `python`.
- Node.js 22.12 or later with the repository's `tsx` dev dependency installed.

Install the Python checks with:

```sh
python -m pip install -r tests/ocr-eval/requirements.txt
```

Run suite-relative commands, including the checksum regeneration snippet below, from
`tests/ocr-eval/`.

The offline evaluator reads the frozen recordings, rebuilds each API response envelope, calls the app's real `parseOcrResponse` and `cleanOcrText`, and checks:

1. No layout tokens, role labels, coordinate boxes, or HTML table markup survive cleaning.
2. Page counts, indexes, and page text are structurally valid.
3. Blank fixtures clean to empty under Rich layout.
4. The corrupt fixture is surfaced as a provider error, never as empty success.
5. Every non-error response either parses or raises the expected `empty_result` error.
6. All recorded metrics still match `reports/offline_baseline.json`.

Items 1-5 are deterministic parser checks; item 6 is a regression gate. Accuracy metrics are informational because provider output varies between runs.

Use `--update-baseline` only after reviewing a deliberate parser or reference change:

```sh
npm run test:ocr:eval -- --update-baseline
```

## Live runs (paid and gated)

Live evaluation sends real requests and bills the account. It requires **both** flags:

```sh
export DEEPSEEK_API_KEY='...'
npm run test:ocr:eval -- --live --confirm-paid
```

On PowerShell, set the key with `$env:DEEPSEEK_API_KEY='...'`.

Limit the run while investigating:

```sh
npm run test:ocr:eval -- --live --confirm-paid \
  --fixtures T16,T17,T18 --purposes text_recognition --reps 1
```

Options: `--fixtures`, `--purposes`, `--reps`, `--timeout`, `--out`. The runner prints the planned request count and approximate source pages before sending. It stops on 401/402 and writes a partial recording. For a full repetition matrix, add `--reps 4`; the runner reports the total before sending.

Live output goes to `recordings/runs/run-<timestamp>.json`. Live metrics are compared with the offline baseline as informational deltas. A live run does not automatically change the baseline; run the offline command afterwards and update only if the change is understood.

Two fixtures need special handling, which the live runner implements:

- **T15**: PNG bytes under a `.jpg` name and `image/jpeg` media type, to test content-based format detection. The app's intake rejects this mismatch; it is an API-level fixture.
- **T29**: corrupt PNG bytes. The provider returns HTTP 200 with an error payload. The app must surface an error. The app's intake also rejects this fixture.

Do not put an API key in the suite or in saved recordings.

## Ground truth

`schema_version` is `2.0`. Each fixture has:

- `path`, `file`, `kind` (`image` or `document`), and `expectation`.
- `pages`: a list of pages, each a list of reference lines. Comparison normalizes Unicode, strips layout/markup for scoring, ignores private-use glyphs, and collapses whitespace. Punctuation and digits remain significant.
- Optional `rows` (table rows), `order` (reading-order probes), `ids` (identifier sequences), `optional_lines` (visible but unscored lines), `frames` (source container frames), `visible_text`, `known_gaps`, and `notes`.
- `expected_error` for the corrupt fixture.

Expectation classes:

| Class | Meaning |
|---|---|
| `text` | Recover visible text in reading order; accuracy metrics are informational. |
| `layout` | Recover text plus structure (headings, columns, tables, emphasis); exact Markdown/HTML is not required. |
| `empty` | No visible text; cleaned output should be empty. Recorded hallucinations are provider behavior. |
| `observe` | Provider behavior is undocumented (frame handling, format sniffing); record without a pass/fail threshold. |
| `error` | A provider error envelope is expected; the client must not report success. |

Approximate pixel regions are intentionally omitted. The API documents normalized `0-1000` box
coordinates but no segmentation-precision contract, so storing approximate boxes would imply a
false reference standard.

## Recorded evidence

`recordings/live-2026-11-18/` contains 134 runs from authorized API calls on 2026-11-18:

| File | Runs | Coverage |
|---|---:|---|
| `image_runs.json` | 28 | T01-T15; one run per supported purpose |
| `corpus_runs.json` | 104 | T16-T21 and T23-T29; four repetitions per purpose |
| `native_image_runs.json` | 2 | T22; one run per purpose |

Derived fields such as `payload`, `clean_text`, and token counts were stripped. Pages, envelope metadata, usage, latency, and errors were retained. The original corpus generators and ground truth are in `tools/provenance/` for traceability.

**Generation note:** T01-T15 were regenerated during the 2026-11-18 suite rework with the pinned Pillow 13.0.0. The recordings for those fixtures were captured before that regeneration, from the same generator and reference content but a different Pillow/FreeType build that is not reproducible in the current environment. Text-level evidence remains comparable; byte identity between the current images and the bytes originally uploaded is not guaranteed. Re-record T01-T15 with authorization if byte-exact provenance is required.

Representative recorded behavior:

- **T03** lost the `WATERWORKS REVIEW` display title in both modes.
- **T17 Rich** returned empty text in one of four runs.
- **T20** emitted private-use `U+F0B7` bullets; the app parser normalizes them.
- **T21** returned empty text in one of four runs in each mode.
- **T22** omitted the embedded chart labels/values and the table body; Rich emitted `chart` and `chart_caption` roles.
- **T23** returned three pages but omitted running headers and footers.
- **T25** Rich returned 163 of 240 identifiers; Standard returned 240 of 240.
- **T26** Standard returned `finish_reason=length` in three of four runs and omitted the identifiers; Rich returned all 135.
- **T28** Standard hallucinated `## 1` in all four runs; Rich returned an image role that cleaned to empty.
- **T29** returned HTTP 200 with `code: invalid_request_error` and no pages.

The current baseline aggregates, over scorable non-empty recorded runs:

| Mode | Runs | Quality runs | Recall | Precision | Sequence | Line coverage | ID recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| Standard | 67 | 58 | 0.930 | 1.000 | 0.925 | 0.924 | 0.625 |
| Rich | 67 | 56 | 0.966 | 0.996 | 0.959 | 0.960 | 0.840 |

These numbers are a regression reference for this fixture set. They are not an accuracy claim for arbitrary documents.

## Metrics

The evaluator reports, per run and fixture:

- **Token recall / precision**: multiset overlap with reference tokens. Tokenization is Unicode-aware: CJK characters are scored individually, while other scripts use letters, combining marks, and numbers, so Devanagari and CJK content is not ignored.
- **Sequence ratio**: token LCS ratio, sensitive to reordering.
- **Line token coverage / contiguous rate**: how much of each reference line appears, and whether it appears as a contiguous token run.
- **Order score**: pairwise order agreement for fixtures with explicit order probes.
- **Row fidelity**: whether each reference table row's tokens exist in the output.
- **ID recall / order ratio**: identifiers such as `L001`, plus a longest-increasing-subsequence order check for dense pages.
- **Duplicate line ratio**, markup flags, page lengths, finish reasons, latency, and usage.
- **Optional-line coverage**: visible lines that are documented but intentionally excluded from primary recall (running headers/footers, embedded chart labels).

Parser invariants are separate from accuracy. A provider may omit text; that is recorded and reported. A parser that leaks markup or turns an error into success is a deterministic app defect.

## Validation and integrity

`tools/validate.py` checks:

- Manifest IDs, paths, kinds, expectations, and ground-truth references.
- Image decoding, formats, dimensions, frame counts, and the intentional corrupt/T15 cases.
- PDF signatures and page counts; DOCX/PPTX ZIP structure and required entries.
- Ground-truth page shapes and fixture-specific extras.
- Recording counts, fixture IDs, purposes, page envelopes, and duplicate runs.
- Coverage references and fixture coverage.
- SHA-256 for every packaged file except `SHA256SUMS.txt`, `verification.json`, `reports/`, and `recordings/runs/`.

Regenerate hashes after any intentional suite change. The checksum snippet below uses a POSIX
shell here-document; on Windows, run it in Git Bash or WSL.

```sh
python - <<'PY'
from pathlib import Path
import hashlib
root = Path('.')
exclude = {'SHA256SUMS.txt', 'verification.json'}
files = sorted(
    p for p in root.rglob('*')
    if p.is_file() and p.name not in exclude
    and not p.as_posix().startswith('reports/')
    and not p.as_posix().startswith('recordings/runs/')
)
lines = []
for p in files:
    h = hashlib.sha256(p.read_bytes()).hexdigest()
    lines.append(f'{h}  {p.as_posix()}')
(root / 'SHA256SUMS.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')
PY
python tools/validate.py --write-report
```

## Limitations

- The fixtures are synthetic or generated documents. They are not human-labeled scans, photographs, handwriting, receipts, or regulated records.
- T01-T15 and T22 have fewer repetitions than T16-T21 and T23-T29. The suite reports runs, not statistical confidence intervals.
- T16-T29 are not byte-reproducible; their generators depend on environment-specific ReportLab/Pillow/Office tooling and Windows fonts. The pinned bytes, not the generators, are the reference.
- Multi-frame TIFF and animated GIF handling is undocumented; the recordings observed one page for each. `observe` fixtures do not imply a contract.
- The suite does not exercise the 100 MiB limit, 1,000-page limit, upload timing, concurrency, password-protected files, or billing behavior.
- The API's backend model version is undocumented, so provider changes can move accuracy without any app change. Use `--live` before drawing conclusions from a single session.
- T15 and T29 are API-level fixtures; the app's intake rejects them before upload. They test the API boundary, not the app upload path.
- Rotation and upload preparation are covered by unit tests. The Playwright suite covers rotation
  invalidation, focus restoration after DOM rebuilds, responsive layout variants, partial-batch
  recovery, result preservation, and the Rich-layout retry. Real-provider timing, non-mocked CORS
  behavior, and visual design review remain manual release checks.

## Optional local-model checks

`MODEL_SPECS.md`, `model_modes.csv`, and `model_prompt_matrix.csv` preserve optional checks for the open-source DeepSeek-OCR and DeepSeek-OCR-2 models. They are separate from the hosted API, use official prompt examples, and are not part of the offline baseline.

## Official references

1. [OCR API guide](https://api-docs.deepseek.com/guides/ocr/)
2. [OCR API reference](https://api-docs.deepseek.com/api/ocr/)
3. [Official DeepSeek-OCR repository](https://github.com/deepseek-ai/DeepSeek-OCR)
4. [Official DeepSeek-OCR model card](https://huggingface.co/deepseek-ai/DeepSeek-OCR)
5. [Official DeepSeek-OCR-2 repository](https://github.com/deepseek-ai/DeepSeek-OCR-2)
6. [Official DeepSeek-OCR-2 model card](https://huggingface.co/deepseek-ai/DeepSeek-OCR-2)

The API guide and reference were consulted on 2026-11-18. Repositories and model cards can change; recheck them before interpreting future runs.
