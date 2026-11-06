"""Convert a document with the installed LibreOffice using a private profile."""
import argparse
from cli_support import convert, emit, entry, input_file


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source'); parser.add_argument('output')
    args = parser.parse_args()
    source = input_file(args.source)
    if not source.lower().endswith(('.docx', '.xlsx', '.pptx')):
        raise ValueError('PDF conversion accepts DOCX, XLSX or PPTX')
    extension = source.rsplit('.', 1)[-1].lower()
    if extension == 'docx':
        from documents import inspect_docx
        inspect_docx(source)
    elif extension == 'xlsx':
        from spreadsheets import inspect_xlsx
        inspect_xlsx(source)
    else:
        from presentations import inspect_pptx
        inspect_pptx(source)
    emit(convert(source, args.output))


if __name__ == '__main__': entry(main)
