"""Reject encrypted and active PDFs before document inspection or page rendering."""

def require(condition, message):
    if not condition:
        raise ValueError(message)


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
