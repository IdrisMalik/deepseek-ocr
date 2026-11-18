from pathlib import Path
import json
import random

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    Preformatted,
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from docx import Document
from docx.shared import Pt
from pptx import Presentation
from pptx.util import Inches, Pt as PptPt

OUT = Path(__file__).resolve().parent
OUT.mkdir(parents=True, exist_ok=True)

FONT = r"C:\Windows\Fonts\arial.ttf"
FONT_BOLD = r"C:\Windows\Fonts\arialbd.ttf"
FONT_ITALIC = r"C:\Windows\Fonts\ariali.ttf"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"


def font(size, bold=False, italic=False, mono=False):
    path = FONT_MONO if mono else FONT_BOLD if bold else FONT_ITALIC if italic else FONT
    return ImageFont.truetype(path, size)


def multiline(draw, xy, lines, fnt, fill="black", spacing=1.35):
    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=fnt, fill=fill)
        y += int(fnt.size * spacing)


# ---------------------------------------------------------------- simple text
simple_lines = [
    "Quarterly Report",
    "Revenue increased by 12 percent.",
    "Operating costs remained stable.",
]
img = Image.new("RGB", (1400, 500), "white")
d = ImageDraw.Draw(img)
multiline(d, (70, 70), simple_lines, font(34), spacing=1.6)
img.save(OUT / "01_simple_text.png")

# simple PDF with the same text
c = canvas.Canvas(str(OUT / "02_simple_text.pdf"), pagesize=letter)
c.setFont("Helvetica-Bold", 28)
c.drawString(72, 700, simple_lines[0])
c.setFont("Helvetica", 18)
c.drawString(72, 650, simple_lines[1])
c.drawString(72, 620, simple_lines[2])
c.showPage()
c.save()

# ------------------------------------------------------------ two-column page
two_col = {
    "headline": "Market Review",
    "left": [
        "Revenue grew 12 percent in the third quarter.",
        "Demand was strongest in the north region.",
        "The retail segment added four new accounts.",
    ],
    "right": [
        "Costs rose 4 percent year over year.",
        "Headcount was unchanged at 120 people.",
        "The south region remained flat.",
    ],
    "table": [
        ["Region", "Q3", "Q4"],
        ["North", "120", "140"],
        ["South", "90", "110"],
    ],
    "footer": "Source: Internal report",
}
img = Image.new("RGB", (1600, 1100), "white")
d = ImageDraw.Draw(img)
d.text((80, 50), two_col["headline"], font=font(42, bold=True), fill="black")
d.line((80, 115, 1520, 115), fill="black", width=2)
multiline(d, (80, 160), two_col["left"], font(22), spacing=1.7)
multiline(d, (850, 160), two_col["right"], font(22), spacing=1.7)
# table
x0, y0 = 80, 760
col_w = [260, 180, 180]
row_h = 58
for r, row in enumerate(two_col["table"]):
    y = y0 + r * row_h
    x = x0
    for cidx, cell in enumerate(row):
        d.rectangle((x, y, x + col_w[cidx], y + row_h), outline="black", width=2)
        d.text((x + 12, y + 14), cell, font=font(22, bold=(r == 0)), fill="black")
        x += col_w[cidx]
d.text((80, 1030), two_col["footer"], font=font(18, italic=True), fill="black")
img.save(OUT / "03_two_column.png")

# two-column PDF
c = canvas.Canvas(str(OUT / "04_two_column.pdf"), pagesize=letter)
c.setFont("Helvetica-Bold", 24)
c.drawString(60, 760, two_col["headline"])
c.line(60, 745, 535, 745)
c.setFont("Helvetica", 11)
y = 715
for line in two_col["left"]:
    c.drawString(60, y, line)
    y -= 20
y = 715
for line in two_col["right"]:
    c.drawString(320, y, line)
    y -= 20
table_data = [["Region", "Q3", "Q4"], ["North", "120", "140"], ["South", "90", "110"]]
t = Table(table_data, colWidths=[1.4 * inch, 0.9 * inch, 0.9 * inch])
t.setStyle(
    TableStyle(
        [
            ("GRID", (0, 0), (-1, -1), 1, colors.black),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 11),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]
    )
)
w, h = t.wrapOn(c, 400, 200)
t.drawOn(c, 60, 500)
c.setFont("Helvetica-Oblique", 9)
c.drawString(60, 460, two_col["footer"])
c.showPage()
c.save()

# ---------------------------------------------------------- mixed formatting
mixed = {
    "title": "Project Atlas",
    "intro": "This report summarizes the current release status and the remaining risks.",
    "bold": "The migration is complete.",
    "italic": "No customer data was lost.",
    "bullets": [
        "Queue latency is below 200 ms.",
        "Retry rate is 0.4 percent.",
        "Two low-priority defects remain open.",
    ],
    "table": [
        ["Metric", "Target", "Actual"],
        ["Availability", "99.9%", "99.95%"],
        ["Error rate", "< 1%", "0.4%"],
    ],
    "code": "status = check_health()\nassert status == 'ok'",
    "footer": "Confidential - internal use only",
}
img = Image.new("RGB", (1500, 1200), "white")
d = ImageDraw.Draw(img)
d.text((70, 50), mixed["title"], font=font(46, bold=True), fill="black")
d.text((70, 125), mixed["intro"], font=font(22), fill="black")
d.text((70, 190), mixed["bold"], font=font(22, bold=True), fill="black")
d.text((70, 235), mixed["italic"], font=font(22, italic=True), fill="black")
y = 300
for b in mixed["bullets"]:
    d.text((80, y), "- " + b, font=font(22), fill="black")
    y += 40
x0, y0 = 70, 480
col_w = [220, 180, 180]
row_h = 55
for r, row in enumerate(mixed["table"]):
    y = y0 + r * row_h
    x = x0
    for cidx, cell in enumerate(row):
        d.rectangle((x, y, x + col_w[cidx], y + row_h), outline="black", width=2)
        d.text((x + 10, y + 13), cell, font=font(20, bold=(r == 0)), fill="black")
        x += col_w[cidx]
d.rectangle((70, 700, 900, 830), outline="black", width=2)
multiline(d, (90, 720), mixed["code"].split("\n"), font(20, mono=True), spacing=1.5)
d.text((70, 1100), mixed["footer"], font=font(18, italic=True), fill="black")
img.save(OUT / "05_mixed_formatting.png")

# mixed formatting PDF via Platypus
styles = getSampleStyleSheet()
body = ParagraphStyle("body", parent=styles["BodyText"], fontName="Helvetica", fontSize=10.5, leading=14)
story = [
    Paragraph(mixed["title"], styles["Title"]),
    Spacer(1, 10),
    Paragraph(mixed["intro"], body),
    Paragraph(f"<b>{mixed['bold']}</b>", body),
    Paragraph(f"<i>{mixed['italic']}</i>", body),
    Spacer(1, 6),
]
for b in mixed["bullets"]:
    story.append(Paragraph(f"&bull; {b}", body))
story.append(Spacer(1, 10))
t = Table(mixed["table"], colWidths=[2.0 * inch, 1.2 * inch, 1.2 * inch])
t.setStyle(
    TableStyle(
        [
            ("GRID", (0, 0), (-1, -1), 0.8, colors.black),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
        ]
    )
)
story.append(t)
story.append(Spacer(1, 14))
story.append(Preformatted(mixed["code"], styles["Code"]))
story.append(Spacer(1, 12))
story.append(Paragraph(f"<i>{mixed['footer']}</i>", body))
doc = SimpleDocTemplate(str(OUT / "06_mixed_formatting.pdf"), pagesize=A4, topMargin=48, bottomMargin=48)
doc.build(story)

# ------------------------------------------------------------- native DOCX
docx = Document()
docx.add_heading("Project Atlas", level=1)
docx.add_paragraph("This report summarizes the current release status and the remaining risks.")
p = docx.add_paragraph()
p.add_run("The migration is complete. ").bold = True
r = p.add_run("No customer data was lost.")
r.italic = True
docx.add_paragraph("Queue latency is below 200 ms.", style="List Bullet")
docx.add_paragraph("Retry rate is 0.4 percent.", style="List Bullet")
docx.add_paragraph("Two low-priority defects remain open.", style="List Bullet")
table = docx.add_table(rows=3, cols=3)
for i, row in enumerate(mixed["table"]):
    for j, value in enumerate(row):
        table.cell(i, j).text = value
docx.add_paragraph("Confidential - internal use only")
docx.save(OUT / "07_native_text.docx")

# ------------------------------------------------------------- native PPTX
prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[5])
slide.shapes.title.text = "Project Atlas"
body_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.6), Inches(8.0), Inches(3.2))
tf = body_box.text_frame
tf.text = "Release status"
for line in [
    "The migration is complete.",
    "No customer data was lost.",
    "Queue latency is below 200 ms.",
    "Retry rate is 0.4 percent.",
]:
    p = tf.add_paragraph()
    p.text = line
    p.level = 1
table = slide.shapes.add_table(3, 3, Inches(0.8), Inches(5.0), Inches(8.0), Inches(1.2)).table
for i, row in enumerate(mixed["table"]):
    for j, value in enumerate(row):
        table.cell(i, j).text = value
prs.save(OUT / "08_native_text.pptx")

# --------------------------------------------------------- dense small text
dense_lines = []
for i in range(1, 136):
    dense_lines.append(f"L{i:03d} alpha bravo charlie delta echo foxtrot")
img = Image.new("RGB", (1800, 1400), "white")
d = ImageDraw.Draw(img)
f = font(12)
col_w = 560
for idx, line in enumerate(dense_lines):
    col = idx // 45
    row = idx % 45
    d.text((40 + col * 600, 30 + row * 29), line, font=f, fill="black")
img.save(OUT / "09_dense_small_text.png")

# ------------------------------------------------------------- rotated text
rot_base = Image.new("RGB", (1400, 700), "white")
d = ImageDraw.Draw(rot_base)
multiline(d, (80, 160), simple_lines, font(34), spacing=1.6)
rot_base.rotate(12, expand=True, fillcolor="white").save(OUT / "10_rotated_12deg.png")
rot_base.rotate(90, expand=True, fillcolor="white").save(OUT / "11_rotated_90deg.png")

# ------------------------------------------------------------ low contrast
img = Image.new("RGB", (1400, 600), "white")
d = ImageDraw.Draw(img)
multiline(d, (70, 180), simple_lines, font(28), fill=(190, 190, 190), spacing=1.6)
img.save(OUT / "12_low_contrast.png")

# ---------------------------------------------------------------- blank
img = Image.new("RGB", (1200, 800), "white")
d = ImageDraw.Draw(img)
d.rectangle((20, 20, 1180, 780), outline=(220, 220, 220), width=2)
img.save(OUT / "13_blank.png")

# ------------------------------------------------------------- multi-page
c = canvas.Canvas(str(OUT / "14_multipage.pdf"), pagesize=letter)
pages = [
    ("Chapter One", ["The first chapter introduces the project.", "It defines the scope and the main risks."]),
    ("Chapter Two", ["The second chapter describes the migration.", "It lists the validation steps and results."]),
    ("Chapter Three", ["The third chapter covers operations.", "It closes with the next review date."]),
]
for i, (title, paras) in enumerate(pages, start=1):
    c.setFont("Helvetica-Bold", 10)
    c.drawString(72, 760, "ACME Quarterly Review")
    c.setFont("Helvetica", 9)
    c.drawRightString(540, 760, f"Page {i} of 3")
    c.setFont("Helvetica-Bold", 22)
    c.drawString(72, 700, title)
    c.setFont("Helvetica", 12)
    y = 660
    for para in paras:
        c.drawString(72, y, para)
        y -= 24
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(72, 60, "Internal document - do not distribute")
    c.showPage()
c.save()

# ---------------------------------------------------------- merged-cell table
c = canvas.Canvas(str(OUT / "15_merged_table.pdf"), pagesize=A4)
c.setFont("Helvetica-Bold", 16)
c.drawString(50, 790, "Regional Sales Summary")
data = [
    ["Region", "Quarterly Sales", "", "Total"],
    ["", "Q3", "Q4", ""],
    ["North", "120", "140", "260"],
    ["South", "90", "110", "200"],
]
t = Table(data, colWidths=[1.2 * inch, 1.0 * inch, 1.0 * inch, 0.9 * inch])
t.setStyle(
    TableStyle(
        [
            ("GRID", (0, 0), (-1, -1), 1, colors.black),
            ("SPAN", (0, 0), (0, 1)),
            ("SPAN", (1, 0), (2, 0)),
            ("SPAN", (3, 0), (3, 1)),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 11),
            ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ]
    )
)
w, h = t.wrapOn(c, 400, 200)
t.drawOn(c, 50, 650)
c.setFont("Helvetica", 9)
c.drawString(50, 620, "All figures in thousands of USD.")
c.showPage()
c.save()

# ------------------------------------------------------------- long dense PDF
c = canvas.Canvas(str(OUT / "16_long_dense.pdf"), pagesize=A4)
c.setFont("Helvetica", 6.5)
long_lines = [f"L{i:03d} the quick brown fox jumps over the lazy dog {i * 7}" for i in range(1, 241)]
for idx, line in enumerate(long_lines):
    col = idx // 80
    row = idx % 80
    c.drawString(28 + col * 182, 800 - row * 9.4, line)
c.showPage()
c.save()

# ------------------------------------------------------------- corrupt image
(OUT / "17_corrupt.png").write_bytes(b"\x89PNG\r\n\x1a\n" + bytes(range(32)) + b"not a real png")

# ------------------------------------------------------------ ground truth
ground = {
    "01_simple_text.png": {"text": "\n".join(simple_lines), "kind": "simple"},
    "02_simple_text.pdf": {"text": "\n".join(simple_lines), "kind": "simple"},
    "03_two_column.png": {
        "text": "\n".join(
            [two_col["headline"]]
            + two_col["left"]
            + two_col["right"]
            + [" ".join(r) for r in two_col["table"]]
            + [two_col["footer"]]
        ),
        "kind": "two_column",
        "order": [two_col["headline"]] + two_col["left"] + two_col["right"] + [two_col["footer"]],
        "rows": two_col["table"],
    },
    "04_two_column.pdf": {
        "text": "\n".join(
            [two_col["headline"]]
            + two_col["left"]
            + two_col["right"]
            + [" ".join(r) for r in two_col["table"]]
            + [two_col["footer"]]
        ),
        "kind": "two_column",
        "order": [two_col["headline"]] + two_col["left"] + two_col["right"] + [two_col["footer"]],
        "rows": two_col["table"],
    },
    "05_mixed_formatting.png": {"text": "\n".join([mixed["title"], mixed["intro"], mixed["bold"], mixed["italic"]] + mixed["bullets"] + [" ".join(r) for r in mixed["table"]] + mixed["code"].split("\n") + [mixed["footer"]]), "kind": "mixed"},
    "06_mixed_formatting.pdf": {"text": "\n".join([mixed["title"], mixed["intro"], mixed["bold"], mixed["italic"]] + mixed["bullets"] + [" ".join(r) for r in mixed["table"]] + mixed["code"].split("\n") + [mixed["footer"]]), "kind": "mixed"},
    "07_native_text.docx": {"text": "\n".join([mixed["title"], mixed["intro"], mixed["bold"], mixed["italic"]] + mixed["bullets"] + [" ".join(r) for r in mixed["table"]] + [mixed["footer"]]), "kind": "native"},
    "08_native_text.pptx": {"text": "\n".join([mixed["title"], "Release status"] + [mixed["bold"], mixed["italic"]] + mixed["bullets"][:2] + [" ".join(r) for r in mixed["table"]]), "kind": "native"},
    "09_dense_small_text.png": {"text": "\n".join(dense_lines), "kind": "dense", "ids": [f"L{i:03d}" for i in range(1, 136)]},
    "10_rotated_12deg.png": {"text": "\n".join(simple_lines), "kind": "rotated"},
    "11_rotated_90deg.png": {"text": "\n".join(simple_lines), "kind": "rotated"},
    "12_low_contrast.png": {"text": "\n".join(simple_lines), "kind": "low_contrast"},
    "13_blank.png": {"text": "", "kind": "blank"},
    "14_multipage.pdf": {"text": "\n".join(sum(([title] + paras for title, paras in pages), [])), "kind": "multipage", "pages": [title for title, _ in pages]},
    "15_merged_table.pdf": {"text": "Region Quarterly Sales Q3 Q4 Total North 120 140 260 South 90 110 200", "kind": "table", "rows": [["North", "120", "140", "260"], ["South", "90", "110", "200"]]},
    "16_long_dense.pdf": {"text": "\n".join(long_lines), "kind": "long_dense", "ids": [f"L{i:03d}" for i in range(1, 241)]},
}
(OUT / "ground_truth.json").write_text(
    json.dumps(ground, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n"
)

print(f"Wrote corpus to {OUT}")
for p in sorted(OUT.iterdir()):
    print(p.name, p.stat().st_size)
