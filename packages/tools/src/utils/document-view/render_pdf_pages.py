"""Render up to four PDF pages as bounded PNG data; accepts bytes or a file."""
import argparse
import base64
import io
import json
import sys
from pdf_safety import safe_pdf


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--source')
    source.add_argument('--stdin-bytes', type=int)
    parser.add_argument('--pages', nargs='+', type=int, required=True)
    parser.add_argument('--max-pixels', type=int, default=1600)
    args = parser.parse_args()
    if not 1 <= len(args.pages) <= 4 or len(set(args.pages)) != len(args.pages):
        raise ValueError('Select one to four distinct pages')
    if not 320 <= args.max_pixels <= 2000:
        raise ValueError('Maximum image edge must be 320–2000 pixels')
    if args.stdin_bytes is not None:
        if not 1 <= args.stdin_bytes <= 33554432:
            raise ValueError('PDF input exceeds 32 MiB')
        data = sys.stdin.buffer.read(args.stdin_bytes)
        if len(data) != args.stdin_bytes:
            raise ValueError('PDF input ended before its declared byte count')
    else:
        with open(args.source, 'rb') as stream:
            data = stream.read(33554433)
        if len(data) > 33554432:
            raise ValueError('PDF input exceeds 32 MiB')
    safe_pdf(io.BytesIO(data))
    import pypdfium2 as pdfium
    document = pdfium.PdfDocument(data)
    images = []
    try:
        for number in args.pages:
            if not 1 <= number <= len(document):
                raise ValueError('Page number is outside the PDF')
            page = document[number - 1]
            try:
                edge = max(page.get_width(), page.get_height())
                if edge <= 0: raise ValueError('PDF page dimensions are invalid')
                bitmap = page.render(scale=min(2, args.max_pixels / edge))
                try:
                    image = bitmap.to_pil()
                    buffer = io.BytesIO()
                    image.save(buffer, format='PNG')
                    encoded = buffer.getvalue()
                    if len(encoded) > 4000000:
                        raise ValueError('Rendered PNG exceeds 4 MB')
                    images.append({'page': number, 'data': base64.b64encode(encoded).decode('ascii'), 'mimeType': 'image/png'})
                finally:
                    bitmap.close()
            finally:
                page.close()
    finally:
        document.close()
    sys.stdout.write(json.dumps({'images': images}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, ImportError) as error:
        print(str(error)[:1000], file=sys.stderr)
        raise SystemExit(2)
