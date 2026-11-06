"""CLI dependency reports and create-only output publication; no tool dispatch."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

MAX_FILE = 33554432


def dependencies(modules, conversion=False):
    missing = [name for name in modules if importlib.util.find_spec(name) is None]
    binary = shutil.which('soffice') or shutil.which('libreoffice')
    if not binary and Path('/Applications/LibreOffice.app/Contents/MacOS/soffice').is_file():
        binary = '/Applications/LibreOffice.app/Contents/MacOS/soffice'
    return {'python': sys.executable, 'missingModules': missing,
            'converter': binary, 'ready': not missing and (not conversion or binary is not None),
            'installation': 'Install only through an explicitly authorized command; this check downloads nothing.'}


def require_dependencies(modules):
    missing = dependencies(modules)['missingModules']
    if missing:
        raise ValueError('Missing Python modules: ' + ', '.join(missing) + '; install requirements explicitly')


def input_file(value, extension=None):
    path = Path(value).absolute()
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise ValueError('Input symlinks are unsupported')
    if not path.is_file() or path.stat().st_nlink != 1 or path.stat().st_size > MAX_FILE:
        raise ValueError('Input must be a regular, single-link file of at most 32 MiB')
    if extension and path.suffix.lower() != extension:
        raise ValueError('Input extension must be ' + extension)
    return str(path)


def new_output(value, extension, producer):
    target = Path(value).absolute()
    if target.suffix.lower() != extension:
        raise ValueError('Output extension must be ' + extension)
    if target.exists() or target.is_symlink():
        raise ValueError('Output already exists; select a new file')
    if any(part.is_symlink() for part in target.parents):
        raise ValueError('Output directory symlinks are unsupported')
    parent_before = target.parent.stat()
    with tempfile.TemporaryDirectory(prefix='.document-', dir=target.parent) as temporary:
        generated = Path(temporary) / ('result' + extension)
        report = producer(str(generated))
        if not generated.is_file() or generated.stat().st_size == 0 or generated.stat().st_size > MAX_FILE:
            raise ValueError('Output is empty or exceeds 32 MiB')
        parent_after = target.parent.stat()
        if (parent_before.st_dev, parent_before.st_ino) != (parent_after.st_dev, parent_after.st_ino):
            raise ValueError('Output parent changed during generation')
        os.link(generated, target)
    return report


def convert(source, output, extension='.pdf', validate=None):
    report = dependencies([], conversion=True)
    binary = report['converter']
    if binary is None:
        raise ValueError('LibreOffice is unavailable; conversion/recalculation was not performed')
    def produce(destination):
        folder = Path(destination).parent
        profile = (folder / 'lo-profile').as_uri()
        result = subprocess.run([binary, '-env:UserInstallation=' + profile, '--headless',
            '--convert-to', extension.lstrip('.'), '--outdir', str(folder), source],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=90, check=False)
        expected = folder / (Path(source).stem + extension)
        if result.returncode != 0 or not expected.is_file():
            raise ValueError('LibreOffice conversion failed; no output published')
        if expected != Path(destination):
            expected.replace(destination)
        checked = validate(destination) if validate else {}
        return dict(checked, converter=binary, conversion='Completed with installed LibreOffice')
    return new_output(output, extension, produce)


def emit(report):
    encoded = json.dumps(report, ensure_ascii=False, default=str)
    if len(encoded.encode('utf-8')) > 1000000:
        raise ValueError('Inspection report exceeds 1 MiB; inspect a narrower document')
    print(encoded)


def entry(main):
    try:
        if os.name == 'posix':
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
            resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE, MAX_FILE))
            resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
        main()
    except (ValueError, OSError, ImportError, subprocess.SubprocessError) as error:
        print(str(error)[:2000], file=sys.stderr)
        raise SystemExit(2)
