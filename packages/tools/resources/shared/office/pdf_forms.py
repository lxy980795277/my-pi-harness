"""Validate choice exports and keep saved values separate from displayed option labels."""
from common import require


def choice_options(field):
    options = field.get('/Opt', [])
    require(0 < len(options) <= 500, 'Choice fields require a bounded option list')
    pairs = []
    for option in options:
        if isinstance(option, list):
            require(len(option) == 2, 'Choice option export/display pair is malformed')
            pairs.append((str(option[0]), str(option[1])))
        else:
            pairs.append((str(option), str(option)))
    require(len({entry[0] for entry in pairs}) == len(pairs), 'Choice exports must be unique')
    require(len({entry[1] for entry in pairs}) == len(pairs), 'Duplicate choice labels need a dedicated appearance workflow')
    return pairs


def validate_choice(field, value):
    require(isinstance(value, str) or (isinstance(value, list) and value and all(isinstance(item, str) for item in value)), 'Choice fields require a string or a nonempty string array')
    chosen = value if isinstance(value, list) else [value]
    require(len(set(chosen)) == len(chosen), 'Repeated choice values are not supported')
    flags = int(field.get('/Ff', 0))
    require(not isinstance(value, list) or (flags & (1 << 21) and not flags & (1 << 17)), 'Choice array requires a multi-select list field')
    exports = {entry[0] for entry in choice_options(field)}
    require(set(chosen).issubset(exports), 'Unknown choice export value')
    return value


def update_choices(writer, fields, values):
    from pypdf.generic import ArrayObject, NameObject, NumberObject, TextStringObject
    for name, value in values.items():
        if fields[name].get('/FT') != '/Ch':
            continue
        field = writer.get_fields()[name].indirect_reference.get_object()
        pairs = choice_options(field)
        chosen = value if isinstance(value, list) else [value]
        indices = sorted(index for index, entry in enumerate(pairs) if entry[0] in chosen)
        options = field['/Opt']
        field[NameObject('/Opt')] = ArrayObject(TextStringObject(label) for _, label in pairs)
        labels = [pairs[index][1] for index in indices]
        writer.update_page_form_field_values(None, {name: labels if isinstance(value, list) else labels[0]}, auto_regenerate=False)
        field[NameObject('/Opt')] = options
        field[NameObject('/V')] = ArrayObject(TextStringObject(item) for item in value) if isinstance(value, list) else TextStringObject(value)
        field[NameObject('/I')] = ArrayObject(NumberObject(index) for index in indices)
