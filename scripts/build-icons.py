"""Build the Claude OLED and OpenAI knot native status-bar glyphs.

Only needed when changing the icon: python -m pip install fonttools
The generated WOFF and SVG are committed assets; normal npm builds need no Python.
"""
from pathlib import Path
import json
import xml.etree.ElementTree as ET
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.svgLib.path import parse_path

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / 'media'
MEDIA.mkdir(exist_ok=True)

bitmaps = json.loads((MEDIA / 'provider-bitmaps.json').read_text(encoding='utf-8'))
glyphs = {'.notdef': TTGlyphPen(None).glyph()}
for name, bitmap in bitmaps.items():
    width, height, data = bitmap['width'], bitmap['height'], bitmap['data']
    stride = (width + 7) // 8
    pixels = {(x, y) for y in range(height) for x in range(width)
              if data[y * stride + x // 8] & (1 << (x % 8))}
    # Remove the OLED's empty margins, fit within a 22px square, and center.
    min_x, max_x = min(x for x, y in pixels), max(x for x, y in pixels) + 1
    min_y, max_y = min(y for x, y in pixels), max(y for x, y in pixels) + 1
    scale = 22 / max(max_x - min_x, max_y - min_y)
    offset_x = (24 - (max_x - min_x) * scale) / 2
    offset_y = (24 - (max_y - min_y) * scale) / 2
    pen, paths = TTGlyphPen(None), []
    for y in range(min_y, max_y):
        x = min_x
        while x < max_x:
            if (x, y) not in pixels:
                x += 1
                continue
            end = x + 1
            while (end, y) in pixels:
                end += 1
            left, right = offset_x + (x - min_x) * scale, offset_x + (end - min_x) * scale
            top, bottom = offset_y + (y - min_y) * scale, offset_y + (y + 1 - min_y) * scale
            points = [(left, top), (right, top), (right, bottom), (left, bottom)]
            vertices = [(round(px * 64), round((21 - py) * 64)) for px, py in points]
            pen.moveTo(vertices[0])
            for vertex in vertices[1:]:
                pen.lineTo(vertex)
            pen.closePath()
            paths.append(f'M{left:g} {top:g}H{right:g}V{bottom:g}H{left:g}Z')
            x = end
    glyphs[name] = pen.glyph()
    color = '#d47555'
    (MEDIA / f'{name}.svg').write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        f'<path fill="{color}" d="' + ' '.join(paths) + '"/></svg>\n', encoding='utf-8')

# Keep the OpenAI mark as smooth vector contours rather than a low-resolution bitmap.
svg = ET.parse(MEDIA / 'openai.svg').getroot()
recording = RecordingPen()
for path in svg.iter('{http://www.w3.org/2000/svg}path'):
    parse_path(path.attrib['d'], recording)
contours, contour = [], RecordingPen()
for operation, args in recording.value:
    getattr(contour, operation)(*args)
    if operation in ('closePath', 'endPath'):
        contours.append(contour)
        contour = RecordingPen()

areas = []
for contour in contours:
    area = AreaPen(None)
    contour.replay(area)
    areas.append(area.value)
outer = max(range(len(areas)), key=lambda index: abs(areas[index]))
pen = TTGlyphPen(None)
for index, contour in enumerate(contours):
    # SVG uses even-odd fill. Orient the outer contour and its seven cutouts
    # oppositely for TrueType's nonzero winding rule, accounting for the y flip.
    target = TransformPen(Cu2QuPen(pen, max_err=0.5, reverse_direction=False),
                          (22 / 24 * 64, 0, 0, -22 / 24 * 64, 64, 20 * 64))
    desired_positive = index == outer
    if (areas[index] > 0) != desired_positive:
        target = ReverseContourPen(target)
    contour.replay(target)
glyphs['openai'] = pen.glyph()

font = FontBuilder(1536, isTTF=True)
font.setupGlyphOrder(list(glyphs))
font.setupCharacterMap({0xE001: 'claude', 0xE002: 'openai'})
font.setupGlyf(glyphs)
font.setupHorizontalMetrics({name: (1536, 0) for name in glyphs})
font.setupHorizontalHeader(ascent=1344, descent=-192)
font.setupNameTable({'familyName': 'AI Usage Icons', 'styleName': 'Regular',
                     'uniqueFontIdentifier': 'AIUsageIcons-Regular',
                     'fullName': 'AI Usage Icons', 'psName': 'AIUsageIcons-Regular'})
font.setupOS2(sTypoAscender=1344, sTypoDescender=-192, usWinAscent=1344, usWinDescent=192)
font.setupPost()
font.setupMaxp()
font.font.flavor = 'woff'
font.save(MEDIA / 'ai-usage-icons.woff')

print('Built Claude OLED + OpenAI knot WOFF glyphs')
