import json
from importlib import resources

def values():
    return json.loads(resources.files("app.data").joinpath("values.json").read_text())
