"""Paginate bounded, literal prose and tables with ReportLab Platypus."""
from xml.sax.saxutils import escape
from common import require


def build_flow(request, stream):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.platypus import BaseDocTemplate, Frame, LongTable, PageBreak, PageTemplate, Paragraph, TableStyle
    layout = request.get('layout', {})
    width, height = layout.get('width', 595), layout.get('height', 842)
    margins = layout.get('margins', {'top': 48, 'right': 42, 'bottom': 48, 'left': 42})
    usable_width = width - margins['left'] - margins['right']
    usable_height = height - margins['top'] - margins['bottom']
    require(usable_width >= 72 and usable_height >= 72, 'PDF margins leave less than 72 points of usable space')
    font = layout.get('font', 'STSong-Light')
    if font == 'STSong-Light':
        pdfmetrics.registerFont(UnicodeCIDFont(font))
    base_size, base_spacing = layout.get('fontSize', 11), layout.get('lineSpacing', 1.5)
    alignments = {'left': TA_LEFT, 'center': TA_CENTER, 'right': TA_RIGHT, 'justify': TA_JUSTIFY}

    def style(block, heading=False):
        size = block.get('fontSize', base_size + (8 - 2 * block.get('level', 1) if heading else 0))
        return ParagraphStyle('office-flow', fontName=font, fontSize=size,
                              leading=size * block.get('lineSpacing', base_spacing),
                              alignment=alignments[block.get('alignment', 'left')],
                              spaceBefore=8 if heading else 0,
                              spaceAfter=block.get('spaceAfter', 10),
                              wordWrap='CJK' if font == 'STSong-Light' else None,
                              keepWithNext=heading, allowWidows=0, allowOrphans=0)

    def paragraph(value, selected_style):
        return Paragraph(escape(value).replace('\n', '<br/>'), selected_style)

    story = []
    for block in request['flow']:
        kind = block['kind']
        if kind == 'page_break':
            story.append(PageBreak())
        elif kind in ('paragraph', 'heading'):
            story.append(paragraph(block['text'], style(block, kind == 'heading')))
        else:
            rows = block['rows']
            require(all(len(row) == len(rows[0]) for row in rows), 'PDF flow tables must be rectangular')
            columns = block.get('columnWidths', [usable_width / len(rows[0])] * len(rows[0]))
            require(len(columns) == len(rows[0]) and sum(columns) <= usable_width + 0.1, 'Table column widths exceed the page or do not match the table')
            headers = block.get('headerRows', 1)
            require(headers <= len(rows), 'Repeating table header count exceeds row count')
            selected_style = style(block)
            selected_style.spaceAfter = 0
            data = [[paragraph('' if value is None else str(value), selected_style) for value in row] for row in rows]
            table = LongTable(data, colWidths=columns, repeatRows=headers, splitByRow=1, splitInRow=1,
                              hAlign='LEFT', spaceAfter=block.get('spaceAfter', 12))
            commands = [('VALIGN', (0, 0), (-1, -1), 'TOP'),
                        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#D1D5DB')),
                        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]
            if headers:
                commands.append(('BACKGROUND', (0, 0), (-1, headers - 1), colors.HexColor('#EEF2F6')))
            table.setStyle(TableStyle(commands))
            story.append(table)
    require(any(block['kind'] != 'page_break' for block in request['flow']), 'PDF flow needs text or a table')

    def decorate(canvas, document):
        require(canvas.getPageNumber() <= 100, 'PDF flow exceeded the 100-page limit')
        canvas.saveState()
        canvas.setFont(font, 8)
        for key in ('header', 'footer'):
            value = layout.get(key, '')
            reserved = 36 if key == 'footer' and layout.get('pageNumbers') else 0
            require('\n' not in value and pdfmetrics.stringWidth(value, font, 8) <= usable_width - reserved, 'PDF header/footer exceeds its available width')
            y = height - margins['top'] / 2 if key == 'header' else max(8, margins['bottom'] / 2 - 4)
            canvas.drawString(margins['left'], y, value)
        if layout.get('pageNumbers'):
            canvas.drawRightString(width - margins['right'], max(8, margins['bottom'] / 2 - 4), str(document.page))
        canvas.restoreState()

    document = BaseDocTemplate(stream, pagesize=(width, height))
    frame = Frame(margins['left'], margins['bottom'], usable_width, usable_height,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    document.addPageTemplates(PageTemplate(id='office-flow', frames=[frame], onPage=decorate))
    document.build(story)
