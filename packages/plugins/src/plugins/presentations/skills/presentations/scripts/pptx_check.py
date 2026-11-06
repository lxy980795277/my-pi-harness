"""Inspect presentation bounds and verify retained template parts and dimensions."""
import argparse
from cli_support import dependencies, emit, entry, input_file, require_dependencies


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['dependencies', 'inspect'])
    parser.add_argument('source', nargs='?'); parser.add_argument('--template')
    args = parser.parse_args()
    if args.command == 'dependencies': emit(dependencies(['pptx', 'lxml'], True)); return
    if not args.source: parser.error('inspect requires a source')
    require_dependencies(['pptx', 'lxml'])
    from common import read_package
    from presentations import inspect_pptx
    source = input_file(args.source, '.pptx')
    result = inspect_pptx(source)
    if args.template:
        template = input_file(args.template, '.pptx')
        expected = inspect_pptx(template)
        if (expected['widthEmu'], expected['heightEmu']) != (result['widthEmu'], result['heightEmu']):
            raise ValueError('Template slide dimensions changed')
        if not set(read_package(template)).issubset(read_package(source)):
            raise ValueError('Template package parts were removed')
        result['validation'].append('Template package part names and dimensions retained')
    emit(result)


if __name__ == '__main__': entry(main)
