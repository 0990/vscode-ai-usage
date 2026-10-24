"""Build the Claude mascot and OpenAI knot native status-bar glyphs.

Only needed when changing the icon: python3 -m pip install fonttools
The generated WOFF and source SVGs are committed assets; normal npm builds need no Python.
"""
from pathlib import Path
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

glyphs = {'.notdef': TTGlyphPen(None).glyph()}
# Claude uses whole pixels at the status bar's native 16px icon size: 96 font
# units per pixel. Its hollow body, two eyes and two legs stay sharp at that size.
# Preserve the OpenAI mark's existing scale and placement.
transforms = {
    'claude': (96, 0, 0, -96, 0, 1344),
    'openai': (22 / 24 * 64, 0, 0, -22 / 24 * 64, 64, 20 * 64),
}
for name, transform in transforms.items():
    svg = ET.parse(MEDIA / f'{name}.svg').getroot()
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
        # Claude already uses nonzero winding, including the eyes inside its
        # hollow body. Convert OpenAI's even-odd cutouts to nonzero winding.
        target = TransformPen(Cu2QuPen(pen, max_err=0.5, reverse_direction=False), transform)
        desired_positive = index == outer
        if name == 'openai' and (areas[index] > 0) != desired_positive:
            target = ReverseContourPen(target)
        contour.replay(target)
    glyphs[name] = pen.glyph()

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

print('Built Claude mascot + OpenAI knot WOFF glyphs')
