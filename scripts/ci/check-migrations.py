#!/usr/bin/env python3
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0
"""Guard the controller's SQL migrations.

sqlx applies migrations by their numeric prefix, so two files with one number (it has happened: two branches each took the
next free number) or a renumbered, already-applied file breaks upgrades. Checks that every file is `NNN_name.sql`, that numbers
are unique and strictly increasing, and that no number is skipped except the documented historical gap. With `--base REF` it
also refuses to change or delete a migration that already exists at REF (applied migrations are immutable).

Usage: scripts/ci/check-migrations.py [--base origin/main]
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DIR = ROOT / "controller" / "migrations"
NAME_RE = re.compile(r"^(\d{3})_[a-z0-9_]+\.sql$")
KNOWN_GAPS = {30}  # 030 was never used


def main():
    problems = []
    nums = {}
    for p in sorted(DIR.glob("*.sql")):
        m = NAME_RE.match(p.name)
        if not m:
            problems.append(f"{p.name}: name must look like 042_short_name.sql")
            continue
        n = int(m.group(1))
        if n in nums:
            problems.append(f"{p.name}: number {n:03d} is also used by {nums[n]}")
        nums[n] = p.name
    ordered = sorted(nums)
    for a, b in zip(ordered, ordered[1:]):
        missing = [x for x in range(a + 1, b) if x not in KNOWN_GAPS]
        if missing:
            problems.append(f"numbers skipped between {a:03d} and {b:03d}: {', '.join(f'{x:03d}' for x in missing)}")
    if "--base" in sys.argv:
        base = sys.argv[sys.argv.index("--base") + 1]
        out = subprocess.run(["git", "diff", "--name-status", f"{base}...HEAD", "--", "controller/migrations"], cwd=ROOT, capture_output=True, text=True)
        for line in out.stdout.splitlines():
            status, _, name = line.partition("\t")
            if status[:1] in ("M", "D", "R"):
                problems.append(f"{name}: an existing migration was {'modified' if status[:1] == 'M' else 'deleted or renamed'}; add a new migration instead")
    if problems:
        print("\n".join(problems))
        return 1
    print(f"migrations ok: {len(nums)} files, {ordered[0]:03d}..{ordered[-1]:03d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
