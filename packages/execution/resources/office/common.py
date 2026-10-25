"""Bounded OOXML inspection shared by the fixed office operations."""
import copy
import io
import posixpath
import zipfile
from lxml import etree as ET

MAX_FILE = 33554432
MAX_UNPACKED = 67108864
NS = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
    'ct': 'http://schemas.openxmlformats.org/package/2006/content-types',
}
for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def tag(prefix, local):
    return '{' + NS[prefix] + '}' + local


def xml(data):
    require(len(data) <= 8388608, 'XML part exceeds limit')
    upper = data.upper()
    require(b'<!DOCTYPE' not in upper and b'<!ENTITY' not in upper, 'DTD/entities are not supported')
    return ET.fromstring(data, ET.XMLParser(resolve_entities=False, load_dtd=False, no_network=True, huge_tree=False))


def read_package(path, allow_chart_workbooks=True):
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        require(len(infos) <= 5000, 'Package has too many parts')
        require(sum(item.file_size for item in infos) <= MAX_UNPACKED, 'Expanded package exceeds limit')
        names = [item.filename for item in infos]
        require(len(names) == len(set(names)), 'Duplicate package part')
        require(all(not name.startswith('/') and '..' not in name.split('/') and '\\' not in name for name in names), 'Unsafe package path')
        require(not any('vbaProject' in name or 'activeX' in name for name in names), 'Macros/embedded active objects are not supported')
        parts = {name: archive.read(name) for name in names}
    for name, data in parts.items():
        if '/embeddings/' in name:
            require(allow_chart_workbooks and name.startswith('ppt/embeddings/') and name.endswith('.xlsx'), 'Only native chart workbook embeddings are supported')
            embedded = read_package(io.BytesIO(data), False)
            require(not any(item.startswith('xl/externalLinks/') for item in embedded), 'Chart workbook has an external link')
    audit_package(parts)
    return parts


def audit_package(parts):
    for name, data in parts.items():
        if name.endswith('.xml') or name.endswith('.rels'):
            tree = xml(data)
            if not name.endswith('.rels'):
                continue
            folder = posixpath.dirname(posixpath.dirname(name))
            for item in tree:
                target = item.get('Target', '')
                if item.get('TargetMode') == 'External':
                    require(item.get('Type', '').endswith('/hyperlink'), 'External package relationships are not supported')
                    require(target.startswith(('https://', 'http://', 'mailto:')), 'Unsafe external hyperlink')
                    continue
                resolved = posixpath.normpath(posixpath.join(folder, target))
                if target.startswith('/'):
                    resolved = target.lstrip('/')
                require(resolved in parts, 'Broken package relationship: ' + name)
    return ['ZIP/XML parsed within limits', 'Internal package relationship targets exist', 'No macros or embedded active objects']


def write_package(parts, output):
    audit_package(parts)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)


def set_xml(parts, name, node):
    parts[name] = ET.tostring(node, encoding='utf-8', xml_declaration=True)


def ensure_part(parts, name, root_name, content_type, relationship_type):
    if name in parts:
        return xml(parts[name])
    types = xml(parts['[Content_Types].xml'])
    ET.SubElement(types, tag('ct', 'Override'), {'PartName': '/' + name, 'ContentType': content_type})
    set_xml(parts, '[Content_Types].xml', types)
    rel_name = 'word/_rels/document.xml.rels'
    rels = xml(parts[rel_name])
    existing = {item.get('Id') for item in rels}
    number = 1
    while 'rIdOffice' + str(number) in existing:
        number += 1
    ET.SubElement(rels, tag('rel', 'Relationship'), {'Id': 'rIdOffice' + str(number), 'Type': NS['r'] + '/' + relationship_type, 'Target': posixpath.basename(name)})
    set_xml(parts, rel_name, rels)
    return ET.Element(tag('w', root_name))


def paragraph_text(paragraph):
    return ''.join(node.text or '' for node in paragraph.iter(tag('w', 't')))


def plain_paragraph(text):
    paragraph = ET.Element(tag('w', 'p'))
    run = ET.SubElement(paragraph, tag('w', 'r'))
    ET.SubElement(run, tag('w', 't')).text = text
    return paragraph


def clone(node):
    return copy.deepcopy(node)
