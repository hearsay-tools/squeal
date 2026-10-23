# One construct per function; the expected classic McCabe count is base 1 plus the construct.
def base(a): return a
def if_only(a):
    if a:
        return 1
    return 0
def if_else(a):
    if a:
        return 1
    else:
        return 0
def elif_(a):
    if a > 1:
        return 1
    elif a > 0:
        return 2
    return 0
def for_loop(xs):
    s = 0
    for x in xs:
        s += x
    return s
def for_else(xs):
    for x in xs:
        if x:
            break
    else:
        return 0
    return 1
def while_loop(n):
    while n > 0:
        n -= 1
    return n
def try_two_excepts():
    try:
        return int("x")
    except ValueError:
        return 0
    except TypeError:
        return 1
def try_finally():
    try:
        return 1
    finally:
        print("x")
def try_else():
    try:
        x = 1
    except ValueError:
        return 0
    else:
        return x
def with_stmt(p):
    with open(p) as f:
        return f.read()
def assert_stmt(a):
    assert a
    return a
def ternary(a):
    return 1 if a else 0
def and_op(a, b):
    return a and b
def three_ands(a, b, c):
    return a and b and c
def comprehension(xs):
    return [x for x in xs]
def comprehension_if(xs):
    return [x for x in xs if x]
def match_two(a):
    match a:
        case 1:
            return "a"
        case 2:
            return "b"
        case _:
            return "c"
def outer_with_inner(xs):
    def inner(x):
        if x > 0:
            return x
        return 0
    return [inner(x) for x in xs]
def lambda_ternary(xs):
    return list(map(lambda x: 1 if x else 0, xs))
def deco(f): return f
@deco
def decorated(a):
    if a:
        return 1
    return 0
class K:
    def method(self, a):
        if a:
            return 1
        return 0
    async def amethod(self, a):
        async for x in a:
            pass
        return 0
# 015-05: radon's edges, after the research's one construct per function.
def while_else(n):
    while n > 0:
        n -= 1
    else:
        return 0
    return 1
def try_star():
    try:
        pass
    except* ValueError:
        return 0
    except* TypeError:
        return 1
    else:
        return 2
def match_captures(a):
    match a:
        case x if x > 0:
            return 1
        case x if x < 0:
            return 2
        case _:
            return 0
def match_capture_last(a):
    match a:
        case 1:
            return 1
        case Color.RED:
            return 2
        case other:
            return other
def match_guard_only(a):
    match a:
        case [x] if x:
            return 1
        case {"k": v}:
            return v
def or_chain(a, b, c, d):
    return (a and b) or (c and not d)
def assert_operands(a, b):
    assert a and b, "both"
    return a
def nested_comprehension(rows):
    return [x for row in rows if row for x in row if x if x > 1]
def dict_and_set(xs):
    return {x: 1 for x in xs}, {x for x in xs if x}, any(x for x in xs)
def default_decision(a=1 if True else 2, *, b=None or 3) -> int:
    return a
@deco(lambda: 1 if True else 0)
def decorator_decision(a):
    return a
def lambda_default(xs, key=lambda x: x or 0):
    return sorted(xs, key=key)
async def async_with(p):
    async with p as f:
        if f:
            return 1
    return 0
def walrus(xs):
    if (n := len(xs)) > 1:
        return n
    return 0
def nested_class_in_function(a):
    class C:
        x = 1 if a else 2
        def m(self):
            if a:
                return 1
            return 0
    return C
class Outer:
    y = 1 if True else 2
    class Inner:
        def m(self, a):
            return a or 1
    def outer_method(self, a):
        def closure(b):
            return b and a
        return closure
    @property
    def prop(self):
        return self.y
    @prop.setter
    def prop(self, v):
        self.y = v or 0
