#!/usr/bin/env python3
"""Regenerate the deterministic, synthetic OCR fixtures in ../images."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "images"
FONTS = ROOT / "assets" / "fonts"

REG = FONTS / "DejaVuSans.ttf"
BOLD = FONTS / "DejaVuSans-Bold.ttf"
DEV = FONTS / "NotoSansDevanagari-Regular.ttf"
CJK = FONTS / "NotoSansCJK-Regular.ttc"

for path in (REG, BOLD, DEV, CJK):
    if not path.is_file():
        raise SystemExit(f"Missing bundled font: {path}")


def font(size, bold=False, script="latin"):
    path = {"latin": BOLD if bold else REG, "dev": DEV, "cjk": CJK}[script]
    return ImageFont.truetype(str(path), size=size)


def canvas(width=1280, height=900, color="#FAF9F5"):
    return Image.new("RGB", (width, height), color)


def text(draw, xy, value, size=28, color="#202A35", bold=False, script="latin", anchor=None):
    draw.text(xy, value, font=font(size, bold, script), fill=color, anchor=anchor)


def line(draw, xy, fill="#D3D8DC", width=2):
    draw.line(xy, fill=fill, width=width)


def save_png(image, name):
    image.save(OUT / name, format="PNG", optimize=False)


def fixture_01_clean():
    im = canvas(1280, 900)
    d = ImageDraw.Draw(im)
    text(d, (82, 66), "FIELD NOTES 042", 23, "#286C78", True)
    line(d, (82, 112, 1198, 112), "#8EB8B5", 3)
    text(d, (82, 160), "Canal Sensor Calibration", 48, "#162A36", True)
    text(d, (84, 252), "Station: North Gate 7", 30)
    text(d, (84, 312), "Date: 18 November 2026", 30)
    text(d, (84, 372), "Reading: 14.25 cm", 30)
    text(d, (84, 432), "Status: within tolerance", 30)
    text(d, (84, 532), "NEXT STEPS", 22, "#286C78", True)
    text(d, (96, 584), "1. Check valve alignment.", 28)
    text(d, (96, 636), "2. Replace filter before 1,800 cycles.", 28)
    text(d, (96, 688), "3. Record the next reading at 16:30.", 28)
    line(d, (82, 780, 1198, 780), "#D3D8DC", 2)
    text(d, (84, 808), "Reference copy • Sheet 1", 18, "#64717A")
    save_png(im, "T01_clean_text.png")


def fixture_02_hierarchy():
    im = Image.new("RGB", (1400, 1000), "#F0F3F5")
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((70, 60, 1330, 940), radius=18, fill="#FFFFFF", outline="#B7C5CC", width=3)
    d.rectangle((70, 60, 1330, 180), fill="#173A4B")
    text(d, (110, 88), "NORTH QUAY   /   OPERATIONS", 24, "#F8FCFD", True)
    text(d, (110, 225), "SERVICE BULLETIN  18-B", 18, "#397E87", True)
    text(d, (110, 267), "Calibration window", 46, "#193847", True)
    text(d, (110, 338), "Planned work for the river-level sensor network", 24, "#53646C")
    d.rounded_rectangle((110, 410, 700, 580), radius=12, fill="#E9F4F2")
    text(d, (140, 436), "START", 17, "#286C78", True)
    text(d, (140, 472), "06:30 UTC", 34, "#193847", True)
    text(d, (140, 526), "18 Nov 2026", 20, "#53646C")
    d.rounded_rectangle((730, 410, 1290, 580), radius=12, fill="#FFF2DB")
    text(d, (760, 436), "EXPECTED DURATION", 17, "#A26012", True)
    text(d, (760, 472), "45 minutes", 34, "#193847", True)
    text(d, (760, 526), "Service may pause briefly", 20, "#53646C")
    text(d, (110, 635), "Affected stations", 27, "#193847", True)
    text(d, (110, 686), "North Gate 7   •   Canal Bend 2   •   East Lock 4", 22, "#293943")
    text(d, (110, 762), "Contact", 18, "#397E87", True)
    text(d, (110, 798), "Duty engineer: Mina Rao   /   Extension 204", 22, "#293943")
    text(d, (110, 882), "NOTICE: readings may be delayed during calibration.", 18, "#8D4E1C", True)
    im.save(OUT / "T02_hierarchical_page.jpg", format="JPEG", quality=95, subsampling=0)


def fixture_03_columns():
    im = canvas(1500, 1800, "#FFFEFB")
    d = ImageDraw.Draw(im)
    text(d, (100, 78), "WATERWORKS REVIEW", 21, "#286C78", True)
    text(d, (100, 122), "A two-part field report", 42, "#162A36", True)
    text(d, (100, 188), "Issue 06   /   Monitoring   /   18 November 2026", 19, "#65727B")
    line(d, (100, 238, 1400, 238), "#8EB8B5", 3)
    line(d, (745, 285, 745, 1645), "#CAD1D3", 2)
    text(d, (100, 290), "LEFT COLUMN", 20, "#286C78", True)
    text(d, (800, 290), "RIGHT COLUMN", 20, "#286C78", True)
    left = [
        "The upper canal remained steady through the",
        "morning inspection. At North Gate 7, the",
        "sensor recorded 14.25 cm at 09:10 UTC.",
        "",
        "A second reading, taken twelve minutes later,",
        "was 14.22 cm. The difference stayed inside",
        "the expected operating range.",
        "",
        "Field staff cleaned the optical window and",
        "checked the cable housing for moisture.",
    ]
    right = [
        "At Canal Bend 2, the team replaced the inlet",
        "filter and restarted the data logger.",
        "The first complete sample arrived at 10:42.",
        "",
        "East Lock 4 will remain on the manual schedule",
        "until the next scheduled calibration.",
        "The duty engineer will review the readings",
        "before the evening transfer.",
        "",
        "Next review: 18:00 UTC   /   Ref. WR-206",
    ]
    for idx, val in enumerate(left):
        text(d, (100, 350 + idx * 47), val, 24, "#263640")
    for idx, val in enumerate(right):
        text(d, (800, 350 + idx * 47), val, 24, "#263640")
    text(d, (100, 1700), "Internal test fixture • page one", 16, "#7A858A")
    im.save(OUT / "T03_two_columns.tiff", format="TIFF", compression="tiff_lzw")


def fixture_04_table():
    im = canvas(1400, 900, "#FFFFFF")
    d = ImageDraw.Draw(im)
    text(d, (90, 72), "PARTS RECEIPT  5031", 34, "#173A4B", True)
    text(d, (90, 132), "Warehouse 4  /  Batch C", 20, "#5E6C73")
    x0, y0 = 90, 230
    widths = [440, 250, 250, 270]
    row_h = 88
    headers = ["Item", "Code", "Quantity", "Unit price"]
    rows = [
        ["Valve seal", "VS-14", "12", "4.80"],
        ["Mesh filter", "MF-08", "6", "11.25"],
        ["Gauge clip", "GC-03", "20", "1.50"],
    ]
    xs = [x0]
    for w in widths:
        xs.append(xs[-1] + w)
    d.rectangle((x0, y0, xs[-1], y0 + row_h * 4), fill="#FFFFFF", outline="#425761", width=3)
    d.rectangle((x0, y0, xs[-1], y0 + row_h), fill="#E4EFF0")
    for x in xs[1:-1]:
        line(d, (x, y0, x, y0 + row_h * 4), "#718087", 2)
    for r in range(1, 4):
        line(d, (x0, y0 + row_h * r, xs[-1], y0 + row_h * r), "#718087", 2)
    for col, val in enumerate(headers):
        text(d, (xs[col] + 18, y0 + 25), val, 21, "#173A4B", True)
    for ridx, row in enumerate(rows, start=1):
        for col, val in enumerate(row):
            text(d, (xs[col] + 18, y0 + row_h * ridx + 25), val, 22, "#202A35")
    text(d, (90, 640), "Subtotal: 154.50", 25, "#173A4B", True)
    text(d, (90, 704), "Approved by: Lena Ortiz", 21, "#202A35")
    im.save(OUT / "T04_grid_table.bmp", format="BMP")


def fixture_05_chart():
    im = canvas(1400, 980, "#FBFCFE")
    d = ImageDraw.Draw(im)
    text(d, (90, 60), "WEEKLY PUMP OUTPUT", 36, "#173A4B", True)
    text(d, (92, 118), "Station North  /  litres per hour", 20, "#5E6C73")
    left, top, right, bottom = 170, 245, 1260, 790
    for val, y in [(0, bottom), (20, 680), (40, 570), (60, 460), (80, 350), (100, 245)]:
        line(d, (left, y, right, y), "#DFE5E8", 2)
        text(d, (left - 22, y), str(val), 17, "#56666E", anchor="rm")
    line(d, (left, top, left, bottom), "#50636C", 3)
    line(d, (left, bottom, right, bottom), "#50636C", 3)
    labels = [("MON", 72), ("TUE", 84), ("WED", 61), ("THU", 93), ("FRI", 77)]
    for idx, (day, val) in enumerate(labels):
        x = 270 + idx * 190
        y = bottom - val * 5.45
        d.rounded_rectangle((x, y, x + 94, bottom), radius=8, fill="#38A4A0")
        text(d, (x + 47, y - 36), str(val), 19, "#173A4B", True, anchor="mm")
        text(d, (x + 47, bottom + 34), day, 19, "#334852", True, anchor="mm")
    d.ellipse((1000, 132, 1022, 154), fill="#38A4A0")
    text(d, (1035, 130), "Measured output", 19, "#334852")
    text(d, (92, 880), "Peak: THU 93   /   Lowest: WED 61", 21, "#173A4B", True)
    im.save(OUT / "T05_bar_chart.webp", format="WEBP", quality=96, method=6)


def fixture_06_sign():
    im = Image.new("RGB", (1280, 860), "#263849")
    d = ImageDraw.Draw(im)
    # Deterministic geometric background; no photograph or third-party image.
    for y in range(0, 860, 20):
        c = 40 + int(22 * y / 860)
        d.rectangle((0, y, 1280, y + 20), fill=(c, c + 16, c + 30))
    for x in range(25, 1280, 130):
        d.rectangle((x, 110, x + 55, 550), fill="#344956")
        d.rectangle((x + 10, 150, x + 45, 250), fill="#5A7178")
    d.rectangle((0, 610, 1280, 860), fill="#1B2730")
    d.rounded_rectangle((230, 185, 1050, 600), radius=30, fill="#E7C979", outline="#FFF1BE", width=10)
    text(d, (640, 245), "MORNING", 52, "#263849", True, anchor="mm")
    text(d, (640, 315), "MARKET", 66, "#263849", True, anchor="mm")
    line(d, (330, 370, 950, 370), "#967B3F", 3)
    text(d, (640, 421), "OPEN 07:30", 32, "#263849", True, anchor="mm")
    text(d, (640, 515), "EXIT  →", 28, "#263849", True, anchor="mm")
    im.save(OUT / "T06_market_sign.gif", format="GIF", optimize=False)


def fixture_07_multilingual():
    im = canvas(1500, 980, "#FFFFFF")
    d = ImageDraw.Draw(im)
    text(d, (90, 70), "LANGUAGE CARD  07", 23, "#286C78", True)
    line(d, (90, 124, 1410, 124), "#8EB8B5", 3)
    text(d, (90, 175), "Cafe reopened at 9:15.", 38, "#202A35", True)
    text(d, (90, 305), "समय: 09:15", 42, "#202A35", script="dev")
    text(d, (90, 410), "जल संग्रह केंद्र", 38, "#202A35", script="dev")
    text(d, (90, 545), "会议地点：北门", 42, "#202A35", script="cjk")
    text(d, (90, 650), "入口开放 09:15", 36, "#202A35", script="cjk")
    text(d, (90, 815), "Synthetic multilingual sample; language coverage is exploratory.", 17, "#66737A")
    save_png(im, "T07_multilingual.png")


def fixture_08_small_print():
    im = Image.new("RGB", (1600, 1000), "#FFFFFF")
    d = ImageDraw.Draw(im)
    text(d, (100, 80), "PRODUCT LABEL", 28, "#1F2D34", True)
    d.rounded_rectangle((80, 165, 1520, 825), radius=14, outline="#4C5A60", width=3)
    text(d, (115, 210), "RIVER-SAFE FILTER CARTRIDGE", 31, "#1F2D34", True)
    text(d, (115, 282), "Model: RS-14    Batch: 61B    Net: 250 ml", 20, "#29383E")
    text(d, (115, 335), "Store dry. Keep the seal intact before installation.", 18, "#29383E")
    text(d, (115, 392), "Replace after 1,800 cycles or by 01 Mar 2027, whichever comes first.", 15, "#29383E")
    text(d, (115, 439), "Packed 18 Nov 2026  /  Lot office: North Quay  /  Code: NQ-61804", 13, "#29383E")
    text(d, (115, 510), "WARNING: depressurize the line before removing the housing.", 15, "#29383E", True)
    text(d, (115, 557), "Do not use if the outer carton is wet, torn, or missing its batch label.", 13, "#29383E")
    text(d, (115, 604), "Service contact: 0800 555 014  /  support@example.invalid", 13, "#29383E")
    text(d, (115, 758), "Fine print intentionally varies in size; no OCR minimum size is documented.", 13, "#66737A")
    im.save(OUT / "T08_small_print.jpg", format="JPEG", quality=98, subsampling=0)


def fixture_09_skewed():
    page = Image.new("RGB", (1160, 760), "#FFFFFF")
    d = ImageDraw.Draw(page)
    d.rectangle((45, 45, 1115, 715), outline="#95A1A6", width=3)
    text(d, (95, 100), "INSPECTION TAG", 24, "#286C78", True)
    text(d, (95, 180), "Bridge Pier 12", 44, "#202A35", True)
    text(d, (95, 276), "Inspector: Omar Sen", 29)
    text(d, (95, 340), "Date: 2026-11-18", 29)
    text(d, (95, 404), "Crack width: 0.8 mm", 29)
    text(d, (95, 468), "Action: recheck in 30 days", 29)
    text(d, (95, 610), "Tag ID: PI-12-086", 20, "#5E6C73")
    page = page.rotate(7, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="#E8EBEC")
    page.save(OUT / "T09_skewed_page.png", format="PNG", optimize=False)


def fixture_10_low_contrast():
    im = Image.new("RGB", (1280, 850), "#F8F8F6")
    d = ImageDraw.Draw(im)
    text(d, (90, 80), "FADED FIELD COPY", 25, "#939A9C", True)
    line(d, (90, 135, 1190, 135), "#E2E4E2", 2)
    text(d, (90, 190), "Pump room B • inspection log", 34, "#A5AAAB", True)
    text(d, (90, 285), "Pressure: 2.40 bar", 28, "#B0B4B5")
    text(d, (90, 350), "Valve status: closed", 28, "#B0B4B5")
    text(d, (90, 415), "Operator: Ira Das", 28, "#B0B4B5")
    text(d, (90, 480), "Next check: 13:45", 28, "#B0B4B5")
    text(d, (90, 700), "Contrast is deliberately reduced; performance is not guaranteed by the docs.", 17, "#CACDCC")
    im.save(OUT / "T10_low_contrast.tiff", format="TIFF", compression="tiff_lzw")


def fixture_11_diagram():
    im = canvas(1480, 850, "#FFFFFF")
    d = ImageDraw.Draw(im)
    text(d, (90, 64), "FILTER FLOW DIAGRAM", 34, "#173A4B", True)
    text(d, (90, 118), "Reference labels and relationships for figure-parsing prompts", 19, "#5E6C73")
    boxes = [(100, 310, 440, 535, "INPUT 06", "raw samples"), (520, 310, 860, 535, "FILTER 12", "remove debris"), (940, 310, 1340, 535, "OUTPUT 09", "clean stream")]
    for x1, y1, x2, y2, heading, sub in boxes:
        d.rounded_rectangle((x1, y1, x2, y2), radius=20, fill="#E8F3F2", outline="#387E80", width=4)
        text(d, ((x1+x2)//2, y1+70), heading, 28, "#173A4B", True, anchor="mm")
        text(d, ((x1+x2)//2, y1+137), sub, 20, "#394F58", anchor="mm")
    line(d, (442, 420, 510, 420), "#276B78", 7)
    d.polygon([(510, 420), (490, 407), (490, 433)], fill="#276B78")
    line(d, (862, 420, 930, 420), "#276B78", 7)
    d.polygon([(930, 420), (910, 407), (910, 433)], fill="#276B78")
    text(d, (105, 650), "The diagram shows a left-to-right process: input → filter → output.", 23, "#202A35")
    text(d, (105, 705), "The API image endpoint is documented for text recognition; figure interpretation is a local-model prompt example.", 17, "#66737A")
    save_png(im, "T11_flow_diagram.png")


def fixture_12_no_text_scene():
    im = Image.new("RGB", (1280, 800), "#B9DDF1")
    d = ImageDraw.Draw(im)
    d.ellipse((930, 65, 1080, 215), fill="#F1C75B")
    d.polygon([(0, 540), (210, 310), (420, 540)], fill="#6B8990")
    d.polygon([(280, 540), (590, 255), (900, 540)], fill="#607E86")
    d.polygon([(730, 540), (1035, 330), (1280, 540)], fill="#78969B")
    d.rectangle((0, 535, 1280, 800), fill="#77A36D")
    d.polygon([(430, 800), (590, 540), (735, 540), (925, 800)], fill="#5C9EBA")
    d.polygon([(560, 800), (645, 540), (690, 540), (790, 800)], fill="#B7DBE5")
    # Small stylized trees, with no text or labels.
    for x, y in [(190, 575), (1090, 590), (1150, 620), (335, 630)]:
        d.rectangle((x-7, y+45, x+7, y+100), fill="#725B43")
        d.ellipse((x-35, y-5, x+35, y+65), fill="#376B4D")
        d.ellipse((x-25, y-28, x+25, y+35), fill="#4D8059")
    im.save(OUT / "T12_textless_landscape.png", format="PNG", optimize=False)


def fixture_13_multipage_tiff():
    pages = []
    for title, rows in [
        ("PAGE ONE", ["Record: 7314", "Station: North Gate 7", "Reading: 14.25 cm"]),
        ("PAGE TWO", ["Record: 8826", "Station: East Lock 4", "Reading: 08.60 cm"]),
    ]:
        im = canvas(1000, 700, "#FFFFFF")
        d = ImageDraw.Draw(im)
        text(d, (75, 75), title, 38, "#173A4B", True)
        line(d, (75, 142, 925, 142), "#8EB8B5", 3)
        for idx, val in enumerate(rows):
            text(d, (75, 220 + idx * 75), val, 28)
        pages.append(im)
    pages[0].save(OUT / "T13_two_page_tiff.tiff", format="TIFF", save_all=True, append_images=pages[1:], compression="tiff_lzw")


def fixture_14_animated_gif():
    frames = []
    entries = [("FRAME ONE", "LAMP 14"), ("FRAME TWO", "PUMP 08"), ("FRAME THREE", "GATE 22")]
    for header, value in entries:
        im = Image.new("RGB", (900, 600), "#132E3C")
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((70, 70, 830, 530), radius=30, fill="#F6F2E8", outline="#B9D1D0", width=8)
        text(d, (450, 190), header, 31, "#286C78", True, anchor="mm")
        text(d, (450, 315), value, 48, "#173A4B", True, anchor="mm")
        frames.append(im.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))
    frames[0].save(OUT / "T14_animated_gif.gif", format="GIF", save_all=True, append_images=frames[1:], duration=[700, 700, 700], loop=0, optimize=False)


def fixture_15_mismatched_extension():
    im = canvas(1000, 620, "#FFFFFF")
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((90, 100, 910, 520), radius=28, fill="#E9F4F2", outline="#397E87", width=4)
    text(d, (500, 215), "FORMAT CHECK", 38, "#173A4B", True, anchor="mm")
    text(d, (500, 305), "Actual bytes: PNG", 29, "#202A35", anchor="mm")
    text(d, (500, 375), "Uploaded name: .jpg", 27, "#202A35", anchor="mm")
    text(d, (500, 455), "Token: SNIFF-615", 24, "#286C78", True, anchor="mm")
    # The extension intentionally disagrees with the PNG magic bytes.
    im.save(OUT / "T15_format_sniff.jpg", format="PNG", optimize=False)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    generated_prefixes = tuple(f"T{i:02d}_" for i in range(1, 16))
    for path in OUT.iterdir():
        if path.is_file() and path.name.startswith(generated_prefixes):
            path.unlink()
    fixture_01_clean()
    fixture_02_hierarchy()
    fixture_03_columns()
    fixture_04_table()
    fixture_05_chart()
    fixture_06_sign()
    fixture_07_multilingual()
    fixture_08_small_print()
    fixture_09_skewed()
    fixture_10_low_contrast()
    fixture_11_diagram()
    fixture_12_no_text_scene()
    fixture_13_multipage_tiff()
    fixture_14_animated_gif()
    fixture_15_mismatched_extension()
    print(f"Generated {len(list(OUT.iterdir()))} fixtures in {OUT}")


if __name__ == "__main__":
    main()
