"""PDF creation, bounded page operations, safe form edits and actual page rendering."""
import base64
import io
from common import require


def safe_pdf(path):
    from pypdf import PdfReader
    reader = PdfReader(path, strict=True)
    require(not reader.is_encrypted, 'Encrypted PDF is not supported')
    require(0 < len(reader.pages) <= 100, 'PDF page count is outside the supported limit')
    root = reader.trailer['/Root']
    require('/OpenAction' not in root and '/AA' not in root, 'Active PDF actions are not supported')
    names = root.get('/Names', {})
    if hasattr(names, 'get_object'):
        names = names.get_object()
    require('/JavaScript' not in names and '/EmbeddedFiles' not in names, 'PDF scripts and embedded files are not supported')
    form = root.get('/AcroForm')
    if form:
        form = form.get_object()
        require('/XFA' not in form and not form.get('/SigFlags'), 'XFA or signature PDF is not supported')
    fields = reader.get_fields() or {}
    require(len(fields) <= 1000, 'PDF has too many fields')
    require(not any(field.get('/FT') == '/Sig' for field in fields.values()), 'Signed/signature fields are not supported')
    for page in reader.pages:
        require('/AA' not in page, 'Active page actions are not supported')
        for reference in page.get('/Annots', []):
            annotation = reference.get_object()
            require('/AA' not in annotation and '/A' not in annotation, 'Annotation actions are not supported')
    return reader


def field_view(reader):
    result = []
    for name, field in (reader.get_fields() or {}).items():
        value = field.get('/V')
        result.append({'name': str(name), 'type': str(field.get('/FT', '')), 'value': str(value) if value is not None else None, 'flags': int(field.get('/Ff', 0))})
    return result


def inspect_pdf(path):
    reader = safe_pdf(path)
    text = '\n'.join((page.extract_text() or '')[:10000] for page in reader.pages)[:100000]
    return {'format': 'pdf', 'pages': len(reader.pages), 'text': text, 'fields': field_view(reader),
            'validation': ['PDF reopened with strict parsing', 'Page limit and active content restrictions checked'],
            'notVerified': ['Visual page inspection; use pdf_read_pages', 'OCR is not performed']}


def pdf_font():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    return 'STSong-Light'


def draw_text(canvas, text, x, y, width, font_size=12):
    canvas.setFont(pdf_font(), font_size)
    columns = max(1, int(width / font_size))
    for line in text.splitlines():
        while line:
            canvas.drawString(x, y, line[:columns])
            y -= font_size * 1.4
            line = line[columns:]
    return y


def validate_fields(reader, fields):
    known = reader.get_fields() or {}
    require(set(fields).issubset(known), 'Unknown PDF field name')
    values = {}
    for name, value in fields.items():
        field = known[name]
        kind = field.get('/FT')
        flags = int(field.get('/Ff', 0))
        require(not flags & 1, 'Read-only field cannot be changed')
        if kind == '/Tx':
            require(isinstance(value, str), 'Text field requires a string')
            require(not flags & (1 << 13), 'Password fields are unsupported')
            maximum = field.get('/MaxLen')
            require(maximum is None or len(value) <= int(maximum), 'Field value exceeds MaxLen')
            values[name] = value
        elif kind == '/Btn':
            require(not flags & ((1 << 15) | (1 << 16)), 'Radio/push buttons are unsupported')
            require(isinstance(value, bool), 'Checkbox requires a boolean')
            appearances = field.get('/_States_', [])
            if not appearances:
                for page in reader.pages:
                    for reference in page.get('/Annots', []):
                        node = reference.get_object()
                        if str(node.get('/T', '')) == name:
                            normal = node.get('/AP', {}).get('/N', {})
                            if hasattr(normal, 'get_object'):
                                normal = normal.get_object()
                            appearances = list(normal)
            enabled = [str(item) for item in appearances if str(item) != '/Off']
            require(len(enabled) == 1, 'Checkbox appearance has no unambiguous enabled state')
            values[name] = enabled[0] if value else '/Off'
        else:
            raise ValueError('Only text and simple checkbox fields are supported')
    return values


def pdf(request, output):
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import DictionaryObject, NameObject
    from reportlab.pdfgen import canvas
    source = request.get('source')
    require(not source or not request.get('pages'), 'Editing a PDF uses explicit page operations; creation pages cannot silently replace a source')
    if not source:
        require(request.get('pages'), 'PDF creation needs at least one page')
        generated = io.BytesIO()
        drawing = canvas.Canvas(generated)
        for page in request['pages']:
            width, height = page.get('width', 595), page.get('height', 842)
            drawing.setPageSize((width, height))
            final_y = draw_text(drawing, page['text'], 36, height - 48, width - 72)
            require(final_y >= 24, 'PDF text exceeds the page; split the text into more pages')
            for table in page.get('tables', []):
                from reportlab.platypus import Table, TableStyle
                rows = table['rows']
                require(rows and rows[0] and all(len(row) == len(rows[0]) for row in rows), 'PDF table must be rectangular')
                values = [['' if cell is None else str(cell) for cell in row] for row in rows]
                result = Table(values, colWidths=[(width - 72) / len(rows[0])] * len(rows[0]))
                result.setStyle(TableStyle([('FONTNAME',(0,0),(-1,-1),pdf_font()),('FONTSIZE',(0,0),(-1,-1),10),('GRID',(0,0),(-1,-1),0.5,(0.7,0.7,0.7)),('BOTTOMPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6)]))
                _, table_height = result.wrap(width - 72, final_y - 24)
                require(table_height <= final_y - 24, 'PDF table exceeds page bounds; split the table into more pages')
                final_y -= table_height
                result.drawOn(drawing, 36, final_y)
                final_y -= 12
            drawing.showPage()
        drawing.save()
        reader = PdfReader(io.BytesIO(generated.getvalue()), strict=True)
    else:
        reader = safe_pdf(source)
    if request.get('repairFields'):
        original_form = reader.trailer['/Root'].get('/AcroForm')
        require(not original_form or not original_form.get_object().get('/Fields'), 'Repair is limited to a missing/empty field tree')
    writer = PdfWriter()
    writer.append(reader)
    if request.get('repairFields'):
        widgets = [reference.get_object() for page in writer.pages for reference in page.get('/Annots', []) if reference.get_object().get('/Subtype') == '/Widget']
        require(widgets and len(widgets) <= 1000, 'No supported widgets to repair')
        require(all(node.get('/T') and node.get('/FT') in ('/Tx', '/Btn') and '/Parent' not in node for node in widgets), 'Only simple unparented named widgets can be repaired')
        names = [str(node['/T']) for node in widgets]
        require(len(names) == len(set(names)), 'Duplicate widget names cannot be repaired safely')
        form = writer.root_object.get('/AcroForm')
        if form:
            form = form.get_object()
        else:
            form = DictionaryObject()
            writer.root_object[NameObject('/AcroForm')] = form
        writer.reattach_fields()
        if '/DR' not in form:
            fonts = DictionaryObject()
            for node in widgets:
                appearance = node.get('/AP', {}).get('/N')
                if appearance and hasattr(appearance, 'get_object'):
                    appearance = appearance.get_object()
                    resources = appearance.get('/Resources', {})
                    if hasattr(resources, 'get_object'):
                        resources = resources.get_object()
                    for key, font in resources.get('/Font', {}).items():
                        require(key not in fonts or fonts[key] == font, 'Conflicting widget font resources')
                        fonts[NameObject(key)] = font
            require(fonts, 'Repair cannot reconstruct missing font resources safely')
            form[NameObject('/DR')] = DictionaryObject({NameObject('/Font'): fonts})
    fields = request.get('fields', {})
    flattened = request.get('flatten', False)
    if fields or flattened:
        # Read the repaired tree through a serialized reader before validating input values.
        intermediate = io.BytesIO()
        writer.write(intermediate)
        field_reader = PdfReader(io.BytesIO(intermediate.getvalue()), strict=True)
        values = validate_fields(field_reader, fields)
        if flattened:
            known = field_reader.get_fields() or {}
            require(known and all(field.get('/FT') == '/Tx' for field in known.values()), 'Flattening is limited to simple text fields')
            require(set(fields) == set(known), 'Flattening requires explicit values for every field')
        for page in writer.pages:
            writer.update_page_form_field_values(page, values, auto_regenerate=False, flatten=flattened)
        if flattened:
            for page in writer.pages:
                for reference in page.get('/Annots', []):
                    node = reference.get_object()
                    if node.get('/Subtype') == '/Widget':
                        require('/AP' in node and '/N' in node['/AP'], 'Cannot flatten a field without a normal appearance')
            writer.remove_annotations(subtypes='/Widget')
            writer.root_object.pop('/AcroForm', None)
    if 'selectPages' in request:
        require(not fields and not flattened and not request.get('repairFields'), 'Combine form editing and page selection in separate files')
        numbers = request['selectPages']
        require(all(number <= len(writer.pages) for number in numbers), 'Selected page is outside the document')
        selected = PdfWriter()
        for number in numbers:
            selected.add_page(writer.pages[number - 1])
        writer = selected
    for path in request.get('appendSources', []):
        other = safe_pdf(path)
        require(not other.get_fields(), 'Appending form PDFs requires a dedicated field-name merge workflow')
        writer.append(other)
    require(len(writer.pages) <= 100, 'Output page count exceeds limit')
    for rotation in request.get('rotations', []):
        require(rotation['page'] <= len(writer.pages), 'Rotation page is outside the document')
        writer.pages[rotation['page'] - 1].rotate(rotation['degrees'])
    for overlay in request.get('overlays', []):
        require(overlay['page'] <= len(writer.pages), 'Overlay page is outside the document')
        page = writer.pages[overlay['page'] - 1]
        width, height = float(page.mediabox.width), float(page.mediabox.height)
        require(overlay['x'] + overlay['width'] <= width and overlay['y'] + overlay['height'] <= height, 'Overlay exceeds page bounds')
        require(page.rotation == 0, 'Apply overlays before rotating a page')
        buffer = io.BytesIO()
        drawing = canvas.Canvas(buffer, pagesize=(width, height))
        if overlay.get('cover'):
            drawing.setFillColorRGB(1, 1, 1)
            drawing.rect(overlay['x'], overlay['y'], overlay['width'], overlay['height'], fill=1, stroke=0)
        if overlay.get('text'):
            drawing.setFillColorRGB(0, 0, 0)
            bottom = draw_text(drawing, overlay['text'], overlay['x'], overlay['y'] + overlay['height'] - 14, overlay['width'])
            require(bottom >= overlay['y'], 'Overlay text exceeds its rectangle')
        drawing.save()
        page.merge_page(PdfReader(io.BytesIO(buffer.getvalue())).pages[0])
    with open(output, 'wb') as stream:
        writer.write(stream)
    result = inspect_pdf(output)
    if fields and not flattened:
        saved = {item['name']: item['value'] for item in result['fields']}
        for name, value in values.items():
            require(saved.get(name) == str(value), 'Saved field value did not match the request')
        result['validation'].append('Saved form field values match the request')
    if flattened:
        require(not result['fields'], 'Flattening left interactive fields')
        result['validation'].append('Text fields flattened using appearances; interactive widgets removed')
    if request.get('overlays'):
        result['notVerified'].append('Visual overlay is NOT secure redaction; underlying content can remain recoverable')
    return result


def render_pages(request):
    import pypdfium2 as pdfium
    safe_pdf(request['source'])
    document = pdfium.PdfDocument(request['source'])
    images = []
    try:
        for number in request['pages']:
            require(1 <= number <= len(document), 'Page is outside the PDF')
            page = document[number - 1]
            try:
                maximum = request.get('maxPixels', 1600)
                scale = min(2, maximum / max(page.get_width(), page.get_height()))
                bitmap = page.render(scale=scale)
                try:
                    image = bitmap.to_pil()
                    buffer = io.BytesIO()
                    image.save(buffer, format='PNG')
                    data = buffer.getvalue()
                    require(len(data) <= 4000000, 'Rendered page image exceeds limit')
                    images.append({'page': number, 'data': base64.b64encode(data).decode('ascii'), 'mimeType': 'image/png'})
                finally:
                    bitmap.close()
            finally:
                page.close()
    finally:
        document.close()
    return {'format': 'pdf', 'images': images, 'validation': ['Selected pages rendered with PDFium'], 'notVerified': ['OCR is not performed']}
