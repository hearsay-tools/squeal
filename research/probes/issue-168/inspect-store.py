#!/usr/bin/env python3
"""Read only the throwaway fixture's code attribution evidence."""
import pathlib, sqlite3, sys
path = pathlib.Path(sys.argv[1]) / '.git/squeal/code.sqlite'
with sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True) as db:
    for sql in ["select key,value from meta where key like 'pulled:%'",
                'select measure,outcome,value,changed_at,edited_revision,edited_at from states order by measure']:
        print(sql)
        for row in db.execute(sql):
            print(row)
