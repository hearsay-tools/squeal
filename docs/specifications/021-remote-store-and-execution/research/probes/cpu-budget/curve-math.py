"""Throwaway (row 021-06): arithmetic on the 011 load-slowdown curve. (1) Host throughput B/S(B). (2) For a fixed other
load b0, background's own throughput g/S(b0+g): is there a g past which adding background cores lowers background's own
work rate? (3) The same curve moved to other machines by scaling busy counts (inferred shapes, stated in the findings).
Usage: python3 -I curve-math.py"""
CURVE = [(1, 1.0), (3, 1.005), (5, 1.066), (7, 1.092), (9, 1.092), (11, 1.13), (13, 1.139), (15, 1.196), (17, 1.276),
         (19, 1.422), (21, 1.692), (23, 2.488)]


def S(b):
    if b <= CURVE[0][0]:
        return 1.0
    for (x0, y0), (x1, y1) in zip(CURVE, CURVE[1:]):
        if b <= x1:
            return y0 + (y1 - y0) * (b - x0) / (x1 - x0)
    return CURVE[-1][1]


print("busy  S(B)  B/S(B)   (host throughput in isolated cores)")
for b in range(2, 25, 2):
    print(f"{b:4d}  {S(b):.3f}  {b / S(b):5.1f}")
print("\nother load b0: background cores g that maximise g/S(b0+g) (background's own work rate), and that rate")
for b0 in range(4, 22, 2):
    best = max((g / 10 for g in range(1, int((24 - b0) * 10) + 1)), key=lambda g: g / S(b0 + g))
    gmax = 24 - b0
    print(f"b0={b0:2d}: best g={best:4.1f} rate={best / S(b0 + best):.2f}; at g={gmax:4.1f} rate={gmax / S(24):.2f}; "
          f"host total work at best {(b0 + best) / S(b0 + best):.1f} vs at 24 {24 / S(24):.1f}")
