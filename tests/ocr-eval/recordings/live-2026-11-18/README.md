# Recorded API evidence (2026-11-18)

These files preserve authorized DeepSeek OCR API responses used as reference evidence. They are not a fresh benchmark and contain no credentials.

| File | Runs | Fixture coverage | Repetitions |
|---|---:|---|---|
| `image_runs.json` | 28 | T01-T15, one run per supported purpose | 1 |
| `corpus_runs.json` | 104 | T16-T21 and T23-T29 | 4 per purpose |
| `native_image_runs.json` | 2 | T22 | 1 per purpose |

The T01-T15 recordings predate the 2026-11-18 regeneration of those image bytes. They remain text-level evidence for the same generator content; see the main suite README for the byte-provenance caveat.

## Source

The runs came from two authorized evaluations on 18 November 2026:

- The image fixture run covered T01-T15.
- The corpus run covered the adopted PDF, DOCX, and PPTX cases, plus the dense, rotated, blank, and corrupt images. Four redundant corpus cases and the standalone chart image were excluded from this suite.
- A separate two-run check covered T22's embedded chart path.

## Transform

The original result files contained request payloads, reconstructed raw text, cleaned text, text lengths, layout-token counts, and other derived values. The recordings here keep:

- `fixture_id`, `purpose`, `rep`
- HTTP `status`, `ok`, `elapsed_s`, `response_bytes`, `content_type`
- `page_count`, `pages` (`index`, `text`, `finish_reason`)
- `usage` and `error`

Everything derived from the response was dropped so the recording is a stable envelope rather than a duplicate of the parser's output. Text is otherwise unchanged, including fullwidth `｜` layout tokens and private-use DOCX bullets.

## Interpretation

Provider output varies. An empty 200 response, a `finish_reason=length` result, or a missing heading is recorded evidence, not proof of an app defect. The offline evaluator distinguishes these from deterministic parser failures such as leaked layout markup or an error being treated as success. See the fixture `known_gaps` in `ground_truth/ground_truth.json` and the evidence watchpoints printed by `tools/eval.ts`.
