"""Generate representative test fixture files for every supported OCR format.

Requires: Pillow, python-docx, python-pptx, reportlab, compoundfiles.
Run: python scripts/generate-fixtures.py
"""
from pathlib import Path
import io
import struct
import zipfile

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from pptx import Presentation
from reportlab.pdfgen import canvas as pdfcanvas

OUT = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures'
OUT.mkdir(parents=True, exist_ok=True)

TEXT = 'DeepSeek OCR format test'

try:
    FONT = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 52)
except Exception:
    FONT = ImageFont.load_default()


def raster(fmt: str, name: str):
    img = Image.new('RGB', (1400, 380), 'white')
    d = ImageDraw.Draw(img)
    d.text((50, 60), TEXT, fill='black', font=FONT)
    d.text((50, 190), 'Formats: PNG JPEG WebP GIF BMP TIFF', fill='black', font=FONT)
    path = OUT / name
    save_kwargs = {}
    if fmt == 'JPEG':
        img = img.convert('RGB')
    img.save(path, format=fmt, **save_kwargs)
    print('wrote', path.name, path.stat().st_size)


def make_pdf():
    path = OUT / 'sample.pdf'
    c = pdfcanvas.Canvas(str(path))
    c.setFont('Helvetica', 18)
    c.drawString(60, 720, TEXT)
    c.drawString(60, 690, 'This is a PDF document for OCR testing.')
    c.showPage()
    c.save()
    print('wrote', path.name, path.stat().st_size)


def make_docx():
    path = OUT / 'sample.docx'
    doc = Document()
    doc.add_heading('DeepSeek OCR', level=1)
    doc.add_paragraph(TEXT)
    doc.add_paragraph('This is a Word document for OCR testing.')
    doc.save(str(path))
    print('wrote', path.name, path.stat().st_size)


def make_pptx():
    path = OUT / 'sample.pptx'
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = TEXT
    slide.placeholders[1].text = 'PowerPoint OCR test slide'
    prs.save(str(path))
    print('wrote', path.name, path.stat().st_size)


def make_ole2(path: Path, stream_name: str, payload: bytes):
    """Build a minimal CFB/OLE2 v3 compound file with one >=4 KiB stream.

    Legacy DOC/PPT are OLE2 containers; this produces a structurally valid
    container with the expected stream name for backend validation tests.
    """
    FREE = 0xFFFFFFFF
    ENDOFCHAIN = 0xFFFFFFFE
    FATSECT = 0xFFFFFFFD

    # Pad the stream to >= 4096 bytes so it lives in a regular sector (no MiniFAT).
    if len(payload) < 4096:
        payload = payload + b'\x00' * (4096 - len(payload))

    def utf16name(name: str) -> bytes:
        return (name + '\x00').encode('utf-16-le')

    # Directory entries (128 bytes each)
    def dir_entry(name: str, etype: int, start: int, size: int, color: int = 1,
                  left=FREE, right=FREE, child=FREE) -> bytes:
        nm = utf16name(name)
        entry = bytearray(128)
        entry[:len(nm)] = nm
        entry[64:66] = struct.pack('<H', len(nm))
        entry[66] = etype
        entry[67] = color
        entry[68:72] = struct.pack('<I', left)
        entry[72:76] = struct.pack('<I', right)
        entry[76:80] = struct.pack('<I', child)
        entry[116:120] = struct.pack('<I', start)
        entry[120:128] = struct.pack('<Q', size)
        return bytes(entry)

    root = dir_entry('Root Entry', 5, ENDOFCHAIN, 0, child=1)
    stream = dir_entry(stream_name, 2, 2, len(payload))
    directory = (root + stream + dir_entry('', 0, FREE, 0) + dir_entry('', 0, FREE, 0))
    directory += b'\x00' * (512 - len(directory))

    # FAT: sector 0 = FAT itself, 1 = directory, 2 = stream data
    fat_entries = [FATSECT, ENDOFCHAIN, ENDOFCHAIN] + [FREE] * (128 - 3)
    fat = b''.join(struct.pack('<I', e) for e in fat_entries)

    # Header
    header = bytearray(512)
    header[0:8] = bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
    struct.pack_into('<H', header, 24, 0x003E)  # minor
    struct.pack_into('<H', header, 26, 0x0003)  # major
    struct.pack_into('<H', header, 28, 0xFFFE)  # little endian
    struct.pack_into('<H', header, 30, 9)       # sector shift -> 512
    struct.pack_into('<H', header, 32, 6)       # mini sector shift -> 64
    struct.pack_into('<I', header, 40, 0)       # dir sectors (v3 = 0)
    struct.pack_into('<I', header, 44, 1)       # FAT sectors
    struct.pack_into('<I', header, 48, 1)       # first directory sector
    struct.pack_into('<I', header, 56, 4096)    # mini stream cutoff
    struct.pack_into('<I', header, 60, ENDOFCHAIN)  # first mini FAT
    struct.pack_into('<I', header, 64, 0)       # mini FAT count
    struct.pack_into('<I', header, 68, ENDOFCHAIN)  # first DIFAT
    struct.pack_into('<I', header, 72, 0)       # DIFAT count
    difat = [0] + [ENDOFCHAIN] * 108
    for i, val in enumerate(difat):
        struct.pack_into('<I', header, 76 + i * 4, val)

    stream_padded = payload + b'\x00' * (512 - (len(payload) % 512))
    path.write_bytes(bytes(header) + fat + directory + stream_padded)


def make_doc():
    """Create a genuine legacy Word 97-2003 (.doc) file using Aspose."""
    import aspose.words as aw
    path = OUT / 'sample.doc'
    doc = aw.Document()
    builder = aw.DocumentBuilder(doc)
    builder.paragraph_format.style_name = 'Heading 1'
    builder.writeln('DeepSeek OCR')
    builder.paragraph_format.style_name = 'Normal'
    builder.writeln(TEXT)
    builder.writeln('This is a legacy Word document for OCR testing.')
    doc.save(str(path))
    print('wrote', path.name, path.stat().st_size)


def make_ppt():
    """Create a genuine legacy PowerPoint 97-2003 (.ppt) file using Aspose."""
    import aspose.slides as sl
    path = OUT / 'sample.ppt'
    with sl.Presentation() as prs:
        slide = prs.slides.add_empty_slide(prs.layout_slides[5])
        title = slide.shapes.add_auto_shape(sl.ShapeType.RECTANGLE, 100, 100, 600, 100)
        title.text_frame.text = TEXT
        body = slide.shapes.add_auto_shape(sl.ShapeType.RECTANGLE, 100, 220, 600, 120)
        body.text_frame.text = 'Legacy PowerPoint OCR test slide'
        prs.save(str(path), sl.export.SaveFormat.PPT)
    print('wrote', path.name, path.stat().st_size)


def make_malformed():
    (OUT / 'malformed.bin').write_bytes(b'not a real document at all')
    (OUT / 'fake.pdf').write_bytes(b'plain text pretending to be a pdf')
    (OUT / 'wrong-ext.png').write_bytes(b'%PDF-1.4 not really a png')
    print('wrote malformed fixtures')


if __name__ == '__main__':
    raster('PNG', 'sample.png')
    raster('JPEG', 'sample.jpg')
    raster('WEBP', 'sample.webp')
    raster('GIF', 'sample.gif')
    raster('BMP', 'sample.bmp')
    raster('TIFF', 'sample.tiff')
    make_pdf()
    make_docx()
    make_pptx()
    make_doc()
    make_ppt()
    make_malformed()
