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
