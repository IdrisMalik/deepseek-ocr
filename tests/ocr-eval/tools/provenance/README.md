# Corpus provenance

These files document the frozen T16-T29 fixtures and preserve their generating code and original reference text from the 2026-11-18 corpus evaluation. They are not part of the offline evaluator.

- `generate_corpus.py` generated the PDF, DOCX, PPTX, and image cases with ReportLab, python-docx, python-pptx, Pillow, and Windows system fonts.
- `make_native_image.py` generated T22's embedded chart and DOCX.
- `corpus_ground_truth.json` is the original corpus reference text, retained so the T16-T29 ground truth can be traced to its source.

The `generate_corpus.py` output path points to the script directory for portability. The generator content is otherwise unchanged; the frozen fixtures remain the reference. `make_native_image.py` already writes beside itself. Absolute Windows font paths are retained because the generators depend on system fonts.

The suite's `ground_truth/ground_truth.json` is authoritative for evaluation. It corrects the original corpus omissions for T22, T23 headers/footers, and T24 title/footer, and records provider gaps separately from reference content.
