"""Inspect native workbook data, formulas, caches and chart references."""
import argparse
from cli_support import dependencies, emit, entry, input_file, require_dependencies, convert


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('dependencies')
    inspect = commands.add_parser('inspect'); inspect.add_argument('source')
    recalc = commands.add_parser('recalculate'); recalc.add_argument('source'); recalc.add_argument('output')
    args = parser.parse_args()
    if args.command == 'dependencies': emit(dependencies(['openpyxl', 'lxml'], True)); return
    require_dependencies(['openpyxl', 'lxml'])
    from spreadsheets import inspect_xlsx
    source = input_file(args.source, '.xlsx')
    before = inspect_xlsx(source)
    if args.command == 'inspect': emit(before); return
    expected = {(item['sheet'], item['cell']) for item in before['formulas']}
    def validate(path):
        result = inspect_xlsx(path)
        if result['errorCells']: raise ValueError('Recalculated output contains error cells')
        actual = {(item['sheet'], item['cell']) for item in result['formulas']}
        if expected != actual: raise ValueError('Recalculation changed formula cell locations')
        if any(item['cachedValue'] is None for item in result['formulaCaches']):
            raise ValueError('Recalculation left formula caches absent')
        result['validation'].append('Installed LibreOffice recalculated the workbook; output caches and errors inspected')
        result['notVerified'] = ['Spreadsheet rendering requires page inspection', 'Cached values still require domain checks against expected results']
        return result
    emit(convert(source, args.output, '.xlsx', validate))


if __name__ == '__main__': entry(main)
