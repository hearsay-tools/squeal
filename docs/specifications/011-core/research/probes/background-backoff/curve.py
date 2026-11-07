"""The load-slowdown curve (throwaway): a test file's slowdown at a host busy-vCPU count on this host, the 2-vCPU
fixed-effects result of ../load-slowdown/slowdown.py (day groups, all runs), as ../load-slowdown/exposure.py holds it."""
CURVE = [(1, 1.0), (3, 1.005), (5, 1.066), (7, 1.092), (9, 1.092), (11, 1.13), (13, 1.139), (15, 1.196), (17, 1.276),
         (19, 1.422), (21, 1.692), (23, 2.488)]


def S(b):
    if b <= CURVE[0][0]:
        return 1.0
    for (x0, y0), (x1, y1) in zip(CURVE, CURVE[1:]):
        if b <= x1:
            return y0 + (y1 - y0) * (b - x0) / (x1 - x0)
    return CURVE[-1][1]
