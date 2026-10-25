import collections
import sys

rows = [line.rstrip("\n").split("|") for line in open(sys.argv[1], encoding="utf-8")]
counts = collections.Counter()
for row in rows:
    if len(row) < 3:
        continue
    host, res, flags = row[0], row[1], row[2]
    cf = row[3] if len(row) > 3 else ""
    code = res.split()[0] if res else "?"
    challenge = (
        "challenge" in cf
        or "cf-mitigated" in cf
        or any(
            marker in flags
            for marker in (
                "just a moment",
                "cf-chl",
                "attention required",
                "error code: 1026",
                "challenge-platform",
                "cf-challenge",
            )
        )
    )
    if challenge:
        counts["challenge/block"] += 1
    elif code == "200":
        counts["200"] += 1
    elif code.startswith("ERR"):
        counts["ERR"] += 1
    else:
        counts[code] += 1
print(dict(counts), "total", len(rows))
