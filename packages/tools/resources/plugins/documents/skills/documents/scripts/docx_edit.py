"""Inspect DOCX and apply one explicit, create-only review operation."""
import argparse
from cli_support import dependencies, emit, entry, input_file, new_output, require_dependencies


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('dependencies')
    inspect = commands.add_parser('inspect'); inspect.add_argument('source')
    for name in ('replace', 'track', 'revisions', 'comment', 'remove-comment', 'note', 'bookmark', 'field', 'control', 'merge'):
        command = commands.add_parser(name)
        command.add_argument('source'); command.add_argument('output')
        if name in ('replace', 'track'):
            command.add_argument('old'); command.add_argument('replacement')
        if name in ('track', 'comment'):
            command.add_argument('--author', required=True)
        if name == 'revisions': command.add_argument('action', choices=['accept', 'reject'])
        if name in ('comment', 'note', 'bookmark'): command.add_argument('--paragraph', type=int, required=True)
        if name in ('comment', 'note', 'control'): command.add_argument('--text', required=True)
        if name == 'remove-comment': command.add_argument('--id', type=int, required=True)
        if name == 'note': command.add_argument('--type', choices=['footnote', 'endnote'], required=True)
        if name == 'bookmark': command.add_argument('--name', required=True)
        if name == 'field':
            command.add_argument('--type', choices=['toc', 'ref', 'caption'], required=True)
            command.add_argument('--target', default=''); command.add_argument('--text', default='')
        if name == 'control': command.add_argument('--tag', required=True)
        if name == 'merge': command.add_argument('append', nargs='+')
    args = parser.parse_args()
    if args.command == 'dependencies': emit(dependencies(['docx', 'lxml', 'PIL'], True)); return
    require_dependencies(['docx', 'lxml'])
    from documents import docx, inspect_docx
    source = input_file(args.source, '.docx')
    if args.command == 'inspect': emit(inspect_docx(source)); return
    request = {'source': source}
    if args.command in ('replace', 'track'):
        operation = {'kind': 'tracked_replace' if args.command == 'track' else 'replace_text',
                     'old': args.old, 'replacement': args.replacement}
        if args.command == 'track': operation['author'] = args.author
    elif args.command == 'revisions': operation = {'kind': 'revisions', 'action': args.action}
    elif args.command == 'comment': operation = {'kind': 'comment_add', 'paragraph': args.paragraph, 'text': args.text, 'author': args.author}
    elif args.command == 'remove-comment': operation = {'kind': 'comment_remove', 'id': args.id}
    elif args.command == 'note': operation = {'kind': 'note', 'paragraph': args.paragraph, 'text': args.text, 'noteType': args.type}
    elif args.command == 'bookmark': operation = {'kind': 'bookmark', 'paragraph': args.paragraph, 'name': args.name}
    elif args.command == 'field': operation = {'kind': 'field', 'fieldType': args.type, 'target': args.target, 'text': args.text}
    elif args.command == 'control': operation = {'kind': 'content_control', 'tag': args.tag, 'text': args.text}
    else:
        request['mergeSources'] = [input_file(path, '.docx') for path in args.append]
        operation = None
    if operation:
        if 'paragraph' in operation and operation['paragraph'] < 0: raise ValueError('Paragraph index must be nonnegative')
        request['operations'] = [operation]
    emit(new_output(args.output, '.docx', lambda output: docx(request, output)))


if __name__ == '__main__': entry(main)
