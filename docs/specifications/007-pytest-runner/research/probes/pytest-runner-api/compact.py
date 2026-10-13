"""Keep raw JSON evidence readable without expanding every scalar field."""
import json


def dumps(value, level=0):
    def nested(item):
        return isinstance(item, dict) or (isinstance(item, list) and any(nested(v) for v in item))
    children = list(value.values()) if isinstance(value, dict) else value
    if not isinstance(value, (dict, list)) or not any(nested(v) for v in children):
        return json.dumps(value)
    indent = '  ' * (level + 1)
    if isinstance(value, dict):
        parts = [json.dumps(k) + ': ' + dumps(v, level + 1) for k, v in value.items()]
        opening, closing = '{', '}'
    else:
        parts = [dumps(v, level + 1) for v in value]
        opening, closing = '[', ']'
    return opening + '\n' + ',\n'.join(indent + p for p in parts) + '\n' + '  ' * level + closing
