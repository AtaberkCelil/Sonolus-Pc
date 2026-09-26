"""Reference combo event breakdown for every bundled chart.

    SLC_REPO=/path/to/sonolus-level-converters python tools/verify-parity/reference.py > reference.json

Uses the community reference converter's own `Score.combo_events()`, so the
comparison in `compare.mjs` is against the canonical implementation rather than
a re-derivation of it. Requires that repo's checkout plus the `base36` package
(`run.sh` sets both up automatically).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO = os.environ.get("SLC_REPO")
if not REPO:
    sys.exit("SLC_REPO is not set (point it at a sonolus-level-converters checkout)")
sys.path.insert(0, REPO)

from sonolus_converters.sus.loader import loads  # noqa: E402
from sonolus_converters.notes.guide import Guide  # noqa: E402
from sonolus_converters.notes.single import Single  # noqa: E402
from sonolus_converters.notes.slide import Slide  # noqa: E402

DIFFICULTIES = ("easy", "normal", "hard", "expert", "master")
LEVELS = Path(__file__).resolve().parents[2] / "public" / "levelinfo"

# Reference category -> Sonopc `ComboEventKind`.
CATEGORY_TO_KIND = {
    "taps": "single",
    "flicks": "single",
    "long_starts": "start",
    "long_relays": "relay",
    "long_continuations": "continuation",
    "long_ends": "end",
    "long_flick_ends": "end",
}

rows = []
for song in sorted(p for p in LEVELS.iterdir() if (p / "info.txt").exists()):
    for difficulty in DIFFICULTIES:
        file = song / difficulty / f"{difficulty}.txt"
        if not file.exists():
            continue

        score = loads(file.read_text(encoding="utf-8-sig"))

        by_kind = {"single": 0, "start": 0, "relay": 0, "continuation": 0, "end": 0}
        by_kind_critical = dict(by_kind)
        for category, critical, _beat in score.combo_events():
            kind = CATEGORY_TO_KIND[category]
            by_kind[kind] += 1
            if critical:
                by_kind_critical[kind] += 1

        # Guide notes are channel-9 visuals: they never count as combo, but the
        # reference models them as `Guide` notes, so their shape is comparable.
        # `score.notes` also holds BPM/timescale/volume objects, so only the
        # playable note types are compared here.
        guides = [note for note in score.notes if isinstance(note, Guide)]

        rows.append(
            {
                "id": f"{song.name}/{difficulty}",
                "total": sum(by_kind.values()),
                "byKind": by_kind,
                "byKindCritical": by_kind_critical,
                "singles": sum(1 for note in score.notes if isinstance(note, Single)),
                "slides": sum(1 for note in score.notes if isinstance(note, Slide)),
                "guides": len(guides),
                "guidesCritical": sum(1 for note in guides if note.color == "yellow"),
                "guidePoints": sum(len(note.midpoints) for note in guides),
                "duration": round(score.duration, 3),
            }
        )

rows.sort(key=lambda row: row["id"])
print(json.dumps(rows, indent=2))
