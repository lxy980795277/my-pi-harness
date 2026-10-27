"""One stdin JSON request, one bounded result; never accepts executable user code."""
import importlib.util
import json
import os
import shutil
import subprocess
import sys

# These limits apply to owned conversion descendants as well; the host also owns a wall deadline.
if os.name == 'posix':
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
    resource.setrlimit(resource.RLIMIT_FSIZE, (33554432, 33554432))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))

MODULES = {
    'office_docx': ['docx'], 'office_pdf': ['pypdf', 'reportlab'],
    'office_xlsx': ['openpyxl'], 'office_pptx': ['pptx'],
    'pdf_read_pages': ['pypdf', 'pypdfium2', 'PIL'], 'office_render': [],
}


def detect(tool, request):
    modules = MODULES.get(tool, [])
    if tool == 'office_docx' and request.get('images'):
        modules = modules + ['PIL']
    if tool == 'office_inspect':
        modules = {'docx': ['docx'], 'pdf': ['pypdf'], 'xlsx': ['openpyxl'], 'pptx': ['pptx']}[request['format']]
    missing = [module for module in modules if importlib.util.find_spec(module) is None]
    if missing:
        return {'ok': False, 'code': 'OFFICE_DEPENDENCY_MISSING', 'message': 'Missing Python modules: ' + ', '.join(missing) + '. Install the project office requirements explicitly; no software was downloaded.'}
    return None


def render(request, output):
    from common import require
    binary = shutil.which('soffice') or shutil.which('libreoffice')
    if not binary and os.path.isfile('/Applications/LibreOffice.app/Contents/MacOS/soffice'):
        binary = '/Applications/LibreOffice.app/Contents/MacOS/soffice'
    require(binary, 'OFFICE_DEPENDENCY_MISSING: LibreOffice is not installed; visual conversion was not performed')
    destination = os.path.dirname(output)
    profile = os.path.join(destination, 'lo-profile')
    result = subprocess.run([binary, '-env:UserInstallation=file://' + profile, '--headless', '--convert-to', 'pdf', '--outdir', destination, request['source']], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=50, check=False)
    require(result.returncode == 0, 'Office rendering failed')
    generated = os.path.join(destination, os.path.splitext(os.path.basename(request['source']))[0] + '.pdf')
    require(os.path.isfile(generated), 'Office renderer produced no PDF')
    if generated != output:
        os.replace(generated, output)
    from pdfs import inspect_pdf
    report = inspect_pdf(output)
    report['validation'].append('Converted with the installed LibreOffice')
    report['notVerified'] = ['Inspect selected rendered pages with pdf_read_pages before asserting visual quality']
    return report


def main():
    from common import require
    raw = sys.stdin.buffer.read(500001)
    require(len(raw) <= 500000, 'Office request exceeds limit')
    request = json.loads(raw)
    tool = request.pop('tool')
    output = request.pop('output', None)
    missing = detect(tool, request)
    if missing:
        return missing
    if tool == 'office_inspect':
        from documents import inspect_docx
        from pdfs import inspect_pdf
        from spreadsheets import inspect_xlsx
        from presentations import inspect_pptx
        report = {'docx': inspect_docx, 'pdf': inspect_pdf, 'xlsx': inspect_xlsx, 'pptx': inspect_pptx}[request['format']](request['source'])
    elif tool == 'pdf_read_pages':
        from pdfs import render_pages
        report = render_pages(request)
    elif tool == 'office_render':
        report = render(request, output)
    else:
        from documents import docx
        from pdfs import pdf
        from spreadsheets import xlsx
        from presentations import pptx
        report = {'office_docx': docx, 'office_pdf': pdf, 'office_xlsx': xlsx, 'office_pptx': pptx}[tool](request, output)
    return {'ok': True, 'report': report}


try:
    result = main()
except ModuleNotFoundError:
    result = {'ok': False, 'code': 'OFFICE_DEPENDENCY_MISSING', 'message': 'An Office Python dependency is missing; install project requirements explicitly.'}
except Exception as error:
    # The host exposes this bounded validation message, never traceback or user paths.
    message = str(error)
    code = 'OFFICE_OPERATION_FAILED'
    if message.startswith('OFFICE_DEPENDENCY_MISSING:'):
        code = 'OFFICE_DEPENDENCY_MISSING'
    result = {'ok': False, 'code': code, 'message': message[:1000]}
encoded = json.dumps(result, ensure_ascii=False, default=str)
if len(encoded.encode('utf-8')) > 24000000:
    encoded = json.dumps({'ok': False, 'code': 'OFFICE_OUTPUT_LIMIT', 'message': 'Office result exceeded its output limit'})
sys.stdout.write(encoded)
sys.stdout.flush()
