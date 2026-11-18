#!/usr/bin/env python3
"""Validate the OCR evaluation suite: files, references, recordings, and hashes."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

from PIL import Image, UnidentifiedImageError

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover - dependency guard
    PdfReader = None

ROOT = Path(__file__).resolve().parents[1]
RECORDINGS = ROOT / "recordings" / "live-2026-11-18"
EXPECTED_RECORDING_COUNTS = {
    "image_runs.json": 28,
    "corpus_runs.json": 104,
    "native_image_runs.json": 2,
}
EXPECTATION_CLASSES = {"text", "layout", "empty", "observe", "error"}
SUPPORTED_PURPOSES = {"text_recognition", "rich_layout_recognition"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


def require_pdf_reader() -> None:
    if PdfReader is None:
        fail("pypdf is required: python -m pip install 'pypdf>=5'")


def read_recordings() -> tuple[dict[str, int], list[dict]]:
    counts = {}
    runs = []
    if not RECORDINGS.is_dir():
        fail("recordings/live-2026-11-18 is missing")
    for path in sorted(RECORDINGS.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("runs"), list):
            fail(f"{path.name}: expected an object with a runs array")
        if data.get("run_count") != len(data["runs"]):
            fail(f"{path.name}: run_count does not match runs")
        counts[path.name] = len(data["runs"])
        expected = EXPECTED_RECORDING_COUNTS.get(path.name)
        if expected is not None and len(data["runs"]) != expected:
            fail(f"{path.name}: expected {expected} runs, found {len(data['runs'])}")
        runs.extend(data["runs"])
    if not counts:
        fail("no recording files found")
    return counts, runs


def validate_recordings(recordings: list[dict], manifest_by_id: dict[str, dict]) -> None:
    seen = set()
    for index, run in enumerate(recordings):
        label = f"recording {index}"
        for key in ("fixture_id", "purpose", "rep", "status", "ok", "elapsed_s", "page_count", "pages", "usage", "error"):
            if key not in run:
                fail(f"{label}: missing {key}")
        fid = run["fixture_id"]
        if fid not in manifest_by_id:
            fail(f"{label}: unknown fixture {fid}")
        if run["purpose"] not in SUPPORTED_PURPOSES:
            fail(f"{label}: unsupported purpose {run['purpose']}")
        if run["purpose"] not in manifest_by_id[fid]["api_purposes"].split("|"):
            fail(f"{label}: purpose {run['purpose']} not listed for {fid}")
        key = (fid, run["purpose"], run["rep"])
        if key in seen:
            fail(f"{label}: duplicate run {key}")
        seen.add(key)
        if not isinstance(run["pages"], list):
            fail(f"{label}: pages is not a list")
        if run["page_count"] is not None and run["page_count"] != len(run["pages"]):
            fail(f"{label}: page_count does not match pages")
        for page_index, page in enumerate(run["pages"]):
            if page.get("index") != page_index:
                fail(f"{label}: page index {page.get('index')} at position {page_index}")
            if not isinstance(page.get("text"), str):
                fail(f"{label}: page text is not a string")
        if run["error"] is not None and run["ok"]:
            fail(f"{label}: ok=true with an error payload")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-hashes", action="store_true", help="skip SHA256SUMS.txt validation")
    parser.add_argument("--write-report", action="store_true", help="write static verification.json")
    args = parser.parse_args()

    with (ROOT / "manifest.csv").open(encoding="utf-8", newline="") as f:
        manifest = list(csv.DictReader(f))
    gt_path = ROOT / "ground_truth" / "ground_truth.json"
    ground_truth_doc = json.loads(gt_path.read_text(encoding="utf-8"))
    if ground_truth_doc.get("schema_version") != "2.0":
        fail("ground-truth schema_version must be 2.0")
    ground_truth = ground_truth_doc["fixtures"]

    ids = [row["id"] for row in manifest]
    paths = [row["path"] for row in manifest]
    if len(ids) != len(set(ids)):
        fail("manifest IDs are not unique")
    if len(paths) != len(set(paths)):
        fail("manifest paths are not unique")
    if set(ids) != set(ground_truth):
        fail("manifest IDs and ground-truth fixture IDs differ")
    if set(ids) != {f"T{i:02d}" for i in range(1, len(ids) + 1)}:
        fail("fixture IDs must be contiguous from T01")

    manifest_by_id = {row["id"]: row for row in manifest}
    formats = {}
    frames_by_fixture = {}
    dimensions = {}
    pages_by_fixture = {}
    image_count = 0
    document_count = 0

    for row in manifest:
        fid = row["id"]
        path = ROOT / row["path"]
        if not path.is_file():
            fail(f"{fid}: missing file {row['path']}")
        gt_entry = ground_truth[fid]
        if gt_entry.get("path") != row["path"]:
            fail(f"{fid}: ground-truth path mismatch")
        if gt_entry.get("file") != path.name:
            fail(f"{fid}: ground-truth filename mismatch")
        if gt_entry.get("kind") != row["kind"]:
            fail(f"{fid}: ground-truth kind mismatch")
        if gt_entry.get("expectation") != row["expectation"]:
            fail(f"{fid}: ground-truth expectation mismatch")
        if row["expectation"] not in EXPECTATION_CLASSES:
            fail(f"{fid}: unknown expectation {row['expectation']}")
        if not row["test_objective"].strip() or not row["evaluation_criteria"].strip():
            fail(f"{fid}: test objective and evaluation criteria are required")

        pages = gt_entry.get("pages")
        if not isinstance(pages, list) or not all(
            isinstance(page, list) and all(isinstance(line, str) for line in page) for page in pages
        ):
            fail(f"{fid}: ground-truth pages must be a list of string lists")
        for key in ("rows", "order", "ids", "optional_lines"):
            value = gt_entry.get(key)
            if value is not None:
                if key in {"rows"} and not all(isinstance(row, list) for row in value):
                    fail(f"{fid}: {key} must be a list of lists")
                elif key != "rows" and not all(isinstance(item, str) for item in value):
                    fail(f"{fid}: {key} must be a list of strings")

        if row["kind"] == "image":
            image_count += 1
            if fid == "T29":
                if row["format_from_bytes"] != "Invalid":
                    fail("T29 must be marked Invalid")
                try:
                    with Image.open(path) as im:
                        im.verify()
                except (UnidentifiedImageError, OSError):
                    pass
                else:
                    fail("T29 should not decode as a valid image")
                formats[fid] = "INVALID"
                frames_by_fixture[fid] = 0
                dimensions[fid] = None
                if pages != []:
                    fail("T29 ground truth must have no pages")
                if not gt_entry.get("expected_error"):
                    fail("T29 must define expected_error")
                continue
            if not row["dimensions_px"] or not row["frames"]:
                fail(f"{fid}: image rows need dimensions and frame count")

            try:
                with Image.open(path) as im:
                    im.verify()
                with Image.open(path) as im:
                    fmt = im.format
                    size = im.size
                    frames = getattr(im, "n_frames", 1)
                    for index in range(frames):
                        im.seek(index)
                        im.load()
            except (UnidentifiedImageError, OSError) as exc:
                fail(f"{fid}: image did not decode: {exc}")
            expected_format = "PNG" if fid == "T15" else row["format_from_bytes"].upper()
            if fmt != expected_format:
                fail(f"{fid}: decoded format {fmt} != expected {expected_format}")
            if fid == "T15" and path.suffix.lower() != ".jpg":
                fail("T15 must keep the misleading .jpg filename")
            if frames != int(row["frames"]):
                fail(f"{fid}: {frames} frames != manifest {row['frames']}")
            if not row["dimensions_px"].endswith("per frame"):
                match = re.fullmatch(r"(\d+)x(\d+)", row["dimensions_px"])
                if not match or tuple(map(int, match.groups())) != tuple(size):
                    fail(f"{fid}: dimensions {size} != manifest {row['dimensions_px']}")
            if fid in {"T13", "T14"}:
                source_frames = gt_entry.get("frames")
                if not isinstance(source_frames, list) or len(source_frames) != frames:
                    fail(f"{fid}: ground-truth frames do not match the image frame count")
                if len(pages) != 1:
                    fail(f"{fid}: observed page ground truth should contain the first frame only")
            elif len(pages) == 0:
                fail(f"{fid}: nonblank image needs at least one ground-truth page")
            formats[fid] = fmt
            frames_by_fixture[fid] = frames
            dimensions[fid] = list(size)
        elif row["kind"] == "document":
            document_count += 1
            if not row["pages"]:
                fail(f"{fid}: document rows need a page count")
            suffix = path.suffix.lower()
            if suffix == ".pdf":
                require_pdf_reader()
                if not path.read_bytes().startswith(b"%PDF-"):
                    fail(f"{fid}: missing PDF signature")
                page_count = len(PdfReader(str(path)).pages)
                if page_count != int(row["pages"]):
                    fail(f"{fid}: PDF has {page_count} pages != manifest {row['pages']}")
            elif suffix in {".docx", ".pptx"}:
                if not path.read_bytes().startswith(b"PK\x03\x04"):
                    fail(f"{fid}: missing ZIP signature")
                with zipfile.ZipFile(path) as archive:
                    names = set(archive.namelist())
                if "[Content_Types].xml" not in names:
                    fail(f"{fid}: missing [Content_Types].xml")
                required = "word/document.xml" if suffix == ".docx" else "ppt/presentation.xml"
                if required not in names:
                    fail(f"{fid}: missing {required}")
                page_count = 1
                if int(row["pages"]) != 1:
                    fail(f"{fid}: native Office fixture should be one logical page")
            else:
                fail(f"{fid}: unsupported document extension {suffix}")
            if len(pages) != page_count:
                fail(f"{fid}: ground truth has {len(pages)} pages != document {page_count}")
            if gt_entry.get("expectation") == "error":
                fail(f"{fid}: documents are not error fixtures")
            formats[fid] = suffix.lstrip(".").upper()
            frames_by_fixture[fid] = None
            dimensions[fid] = None
            pages_by_fixture[fid] = page_count
        else:
            fail(f"{fid}: unknown kind {row['kind']}")

    for fid in ("T12", "T28"):
        if ground_truth[fid]["expectation"] != "empty":
            fail(f"{fid}: blank fixtures must use the empty expectation")
        if ground_truth[fid].get("visible_text") is not False:
            fail(f"{fid}: blank fixtures must set visible_text=false")
    if ground_truth["T29"]["expectation"] != "error":
        fail("T29 must use the error expectation")

    recording_counts, recordings = read_recordings()
    validate_recordings(recordings, manifest_by_id)
    recorded_fixtures = {run["fixture_id"] for run in recordings}
    missing_recordings = sorted(set(ids) - recorded_fixtures)
    if missing_recordings:
        fail(f"fixtures without recordings: {missing_recordings}")

    with (ROOT / "coverage.csv").open(encoding="utf-8", newline="") as f:
        coverage = list(csv.DictReader(f))
    if not coverage:
        fail("coverage map is empty")
    source_ids = [row["source_id"] for row in coverage]
    if len(source_ids) != len(set(source_ids)):
        fail("coverage source IDs are not unique")
    known_ids = set(ids)
    referenced = set()
    for row in coverage:
        tokens = set(re.findall(r"T\d{2}", row["test_cases"]))
        referenced.update(tokens)
        for token in tokens:
            if token not in known_ids:
                fail(f"coverage row {row['source_id']} references unknown fixture {token}")
    if known_ids - referenced:
        fail(f"fixtures missing from coverage map: {sorted(known_ids - referenced)}")

    hash_path = ROOT / "SHA256SUMS.txt"
    hash_status = "skipped"
    if not args.skip_hashes:
        if not hash_path.exists():
            fail("SHA256SUMS.txt is missing; use --skip-hashes only before creating it")
        expected = {}
        for line in hash_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            digest, rel = line.split("  ", 1)
            expected[rel] = digest
        report_path = ROOT / "verification.json"
        excluded = {hash_path, report_path}
        actual_paths = sorted(
            p.relative_to(ROOT).as_posix()
            for p in ROOT.rglob("*")
            if p.is_file()
            and p not in excluded
            and not p.relative_to(ROOT).as_posix().startswith("reports/")
            and not p.relative_to(ROOT).as_posix().startswith("recordings/runs/")
        )
        if set(expected) != set(actual_paths):
            missing = sorted(set(actual_paths) - set(expected))
            extra = sorted(set(expected) - set(actual_paths))
            fail(f"checksum inventory mismatch; missing={missing[:5]} extra={extra[:5]}")
        for rel, digest in expected.items():
            if sha256(ROOT / rel) != digest:
                fail(f"SHA-256 mismatch: {rel}")
        hash_status = "passed"

    report = {
        "snapshot_date": "2026-11-18",
        "fixture_count": len(manifest),
        "image_count": image_count,
        "document_count": document_count,
        "ground_truth_fixture_count": len(ground_truth),
        "ground_truth_schema": "2.0",
        "coverage_rows": len(coverage),
        "recording_files": recording_counts,
        "recording_run_count": len(recordings),
        "fixtures_with_recordings": len(recorded_fixtures),
        "fixtures_without_recordings": missing_recordings,
        "all_images_decoded": True,
        "documents_valid": True,
        "formats_by_fixture": formats,
        "frames_by_fixture": frames_by_fixture,
        "dimensions_by_fixture": dimensions,
        "document_page_counts": pages_by_fixture,
        "manifest_and_ground_truth_ids_match": True,
        "coverage_references_resolve": True,
        "sha256_validation": hash_status,
        "checksum_exclusions": [
            "SHA256SUMS.txt",
            "verification.json",
            "reports/",
            "recordings/runs/",
        ],
        "regeneration_reproducible": (
            "T01-T15 are byte-reproducible from tools/generate_fixtures.py with the bundled fonts "
            "on the verified Windows/Python 3.13/Pillow 13.0.0 environment (Pillow is pinned in "
            "requirements.txt). T16-T29 are frozen artifacts generated with an environment-dependent "
            "ReportLab/Pillow/Office toolchain and Windows system fonts; they are pinned by SHA-256 "
            "and their generators are preserved under tools/provenance/."
        ),
        "recording_provenance_note": (
            "T01-T15 recordings were captured before the 2026-11-18 regeneration of those images. "
            "They retain text-level evidence for the same generator content, but byte identity with "
            "the current images is not guaranteed. T16-T29 recordings match the packaged bytes."
        ),
        "reference_data_review": (
            "Ground truth was reviewed against the deterministic fixture generators and the recorded "
            "API output. Known provider gaps are recorded per fixture instead of being treated as app defects. "
            "Approximate pixel regions were removed because the API documents no box-precision contract."
        ),
        "api_or_model_inference_run": False,
    }
    if args.write_report:
        (ROOT / "verification.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
