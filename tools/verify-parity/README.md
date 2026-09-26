# Chart parity check

Verifies Sonopc's chart parser against the community reference converter
([UntitledCharts/sonolus-level-converters](https://github.com/UntitledCharts/sonolus-level-converters))
by running **both** over every bundled chart and diffing the results.

```bash
npm run verify:parity
```

Exits non-zero on any mismatch, so it works as a CI gate.

| File           | Role                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ours.ts`      | Runs `src/game/susParser.ts` over `public/levelinfo/**/<difficulty>.txt` — the exact path the app loads at runtime |
| `reference.py` | Runs the reference converter's own `Score.combo_events()` over the same files                                      |
| `compare.mjs`  | Diffs the two JSON reports and prints a table                                                                      |
| `run.sh`       | Clones the reference repo + builds a venv into `.cache/` (first run needs network), then runs all three            |

`.cache/` is gitignored. Subsequent runs are offline.

## What is compared

- **combo total** — the number the game can actually score
- **per-kind counts** — `single` / `start` / `relay` / `continuation` / `end`
- **critical split per kind** — catches a whole class of bugs where the count is
  right but the note is the wrong kind of note (this is exactly how a slide end
  point that is critical _independently of the slide start_ was found)
- **playable notes** — singles and slides
- **guide notes** — channel-9 count, critical split, and total point count
  (guides are never scored, but they are rendered, so their shape must match)
- **duration** — chart length in seconds

## Semantics this pins down

The comparison is strict, so any divergence from the reference is a failure:

- `long_continuations` — each hold implicitly scores a combo event every
  half-beat (240 ticks) until it ends. This is the single largest source of
  combo; without it TIVoHM Hard reports 636 events instead of 963.
- **Slide step types** — type `3` is a _visible_ relay (adds combo), type `5`
  only reshapes the trace (adds nothing), and type `3` marked _step-ignore_
  becomes an _attach_ (adds combo, does not reshape).
- **`judgeType`** — hidden holds (channel `1` types `7`/`8`) are not judged, and
  friction slides (types `5`/`6`) are traced rather than tapped.
- **Per-point criticality** — a start/tick inherits the slide's criticality, but
  an end point is critical if _either_ the slide or the endpoint itself is.
