# Prints each consumer's turn state from the store, read-only: idle (with how many test files
# its waiter waits for) or in-turn. Usage: python3 -I turn-state.py <repository>
import json, sqlite3, sys

db = sqlite3.connect(f"file:{sys.argv[1]}/.git/squeal/store.sqlite?mode=ro", uri=True, timeout=5)
for key, value in db.execute("select key, value from meta where key like 'turn%'"):
    try:
        slots = json.loads(value)
    except Exception:
        print(key, "unreadable")
        continue
    for consumer, state in (slots.items() if isinstance(slots, dict) else []):
        if isinstance(state, dict) and state.get("turn") == "idle":
            print(f"{consumer[:60]}: idle, waiting for {len(state.get('testFiles', []))} test files, revision {state.get('revision')}")
        else:
            print(f"{consumer[:60]}: {json.dumps(state)[:80]}")
