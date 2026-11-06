"""Inspect PDFs or apply explicit page and AcroForm operations to new files."""
import argparse
import json
from cli_support import dependencies, emit, entry, input_file, new_output, require_dependencies


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('dependencies')
    inspect = commands.add_parser('inspect'); inspect.add_argument('source')
    select = commands.add_parser('select'); select.add_argument('source'); select.add_argument('output'); select.add_argument('pages', nargs='+', type=int)
    append = commands.add_parser('append'); append.add_argument('source'); append.add_argument('output'); append.add_argument('append', nargs='+')
    rotate = commands.add_parser('rotate'); rotate.add_argument('source'); rotate.add_argument('output'); rotate.add_argument('--page', required=True, type=int); rotate.add_argument('--degrees', required=True, type=int, choices=[90, 180, 270])
    form = commands.add_parser('form'); form.add_argument('source'); form.add_argument('output'); form.add_argument('--set', nargs=2, action='append', default=[], metavar=('FIELD', 'JSON_VALUE')); form.add_argument('--flatten', action='store_true'); form.add_argument('--repair', action='store_true')
    args = parser.parse_args()
    if args.command == 'dependencies': emit(dependencies(['pypdf', 'reportlab', 'pypdfium2', 'PIL', 'lxml'])); return
    require_dependencies(['pypdf', 'reportlab', 'lxml'])
    from pdfs import pdf, inspect_pdf
    source = input_file(args.source, '.pdf')
    if args.command == 'inspect': emit(inspect_pdf(source)); return
    request = {'source': source}
    if args.command == 'select':
        if not 1 <= len(args.pages) <= 100 or min(args.pages) < 1: raise ValueError('Select 1–100 positive page numbers')
        request['selectPages'] = args.pages
    elif args.command == 'append': request['appendSources'] = [input_file(path, '.pdf') for path in args.append]
    elif args.command == 'rotate':
        if args.page < 1: raise ValueError('Page number must be positive')
        request['rotations'] = [{'page': args.page, 'degrees': args.degrees}]
    else:
        fields = dict(args.set)
        if len(fields) != len(args.set): raise ValueError('Duplicate field name')
        values = {key: json.loads(value) for key, value in fields.items()}
        if any(not isinstance(value, (str, bool, list)) or (isinstance(value, list) and any(not isinstance(item, str) for item in value)) for value in values.values()):
            raise ValueError('Field values must be JSON strings, booleans or arrays of strings')
        request.update(fields=values, flatten=args.flatten, repairFields=args.repair)
    emit(new_output(args.output, '.pdf', lambda output: pdf(request, output)))


if __name__ == '__main__': entry(main)
