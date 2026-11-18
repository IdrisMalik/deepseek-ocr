from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Inches

OUT = Path(__file__).resolve().parent
img = Image.new("RGB", (900, 360), "white")
d = ImageDraw.Draw(img)
f = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 26)
b = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 30)
d.text((30, 30), "Revenue by Quarter", font=b, fill="black")
for i, (label, value) in enumerate([("Q1", 120), ("Q2", 150), ("Q3", 180)]):
    x = 80 + i * 230
    d.rectangle((x, 320 - value, x + 130, 320), fill=(70, 110, 180))
    d.text((x + 35, 325), label, font=f, fill="black")
    d.text((x + 25, 280 - value), str(value), font=f, fill="black")
img.save(OUT / "18_chart.png")

doc = Document()
doc.add_heading("Atlas Dashboard", level=1)
doc.add_paragraph("The chart summarizes revenue for the first three quarters.")
doc.add_picture(str(OUT / "18_chart.png"), width=Inches(5.5))
table = doc.add_table(rows=2, cols=3)
for i, row in enumerate([["Quarter", "Revenue", "Change"], ["Q3", "180", "+20%"]]):
    for j, value in enumerate(row):
        table.cell(i, j).text = value
doc.add_paragraph("Prepared by the finance team.")
doc.save(OUT / "18_native_with_image.docx")
print("wrote", OUT / "18_native_with_image.docx")
