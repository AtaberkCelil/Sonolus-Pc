<p align="center">
  <img src="public/logo.jpg" width="220" alt="Sonopc logo" />
</p>

<h1 align="center">Sonopc</h1>
<p align="center"><strong>Play Project SEKAI rhythm charts right in your browser.</strong></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-00f0ff?style=flat-square" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square" alt="React 19" />
  <img src="https://img.shields.io/badge/Vite-7-646cff?style=flat-square" alt="Vite 7" />
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178c6?style=flat-square" alt="TypeScript" />
</p>

---

## ✨ Features

- **Real chart data** — charts are parsed with the exact semantics of the community reference
  converter ([sonolus-level-converters](https://github.com/UntitledCharts/sonolus-level-converters)), validated note-for-note
  against it on all 10 included charts.
- **All note types** — taps, criticals, **directional flicks** (`↑ ← →`), traces, damage notes, and slides
  that actually glide across lanes with visible ticks and end-flicks.
- **Lane-accurate** — fixes the classic off-by-one lane mapping (notes were shifted and the rightmost lane dropped).
- **Combo parity** — slide starts, visible ticks and slide ends all count as combo events, just like the game.
- **In-app player** — start screen, live score/accuracy/combo HUD, results with max combo, replay.
- **Autoplay** — sit back and watch the chart play itself.
- **Note speed slider** — 0.5x–2.5x visual fall rate (saved to your browser; judgment is unaffected).
- **Menu music** — loops on the level list and pauses while you play.
- **Difficulty picker** — every chart with its real difficulty level (`MASTER · Lv.34`, …).

### 🎵 Included songs
| Song | Difficulties |
|---|---|
| The Intense Voice of Hatsune Miku | Easy · Normal · Hard · Expert · Master |
| Mesmerizer | Easy · Normal · Hard · Expert · Master |

## 🎮 Controls

| Input | Action |
|---|---|
| `A S D F G H J K L ; ' \` | Hit lanes 1–12 |
| Click / tap a lane | Hit that lane |
| **Auto play** toggle | Let the game play the chart |
| **Note speed** slider | 0.5x–2.5x fall speed |
| `←` button (top-left of the player) | Quit back to the level list |

## 🚀 Getting started

```bash
git clone https://github.com/AtaberkCelil/Sonolus-Pc.git
cd Sonolus-Pc
pnpm install        # or: npm install
pnpm dev            # dev server → http://localhost:3000
```

Other scripts:

```bash
pnpm check          # TypeScript type-check
pnpm build          # production build → dist/
pnpm preview        # serve the production build
pnpm start          # serve the build with the bundled Node server
```

> **Keep chart/audio assets in `public/`.** The `dist/` folder is disposable build output and is wiped on every build.

## 🗂 Project structure

```
src/
├── game/
│   ├── susParser.ts      # Ched/SUS chart parser (official channel semantics)
│   └── gameEngine.ts     # canvas renderer + hit judgment + scoring
├── components/
│   └── PlayScreen.tsx    # in-app player UI
├── pages/
│   └── Home.tsx          # level list + difficulty modal + menu music
├── types.ts              # shared Level / note types
└── index.css             # all styling
public/
├── logo.jpg              # app logo (original artwork)
├── covers/               # jacket art
├── levelinfo/            # chart files (SUS) + audio
└── menumusic/            # level-list music
menu/                     # original standalone PC player (legacy)
```

## 🧠 How the chart pipeline works

1. **`susParser.ts`** reads the Ched/SUS text format exactly like the game data:
   - `1x` channels → taps / criticals / traces / damage
   - `5x` channels → air directions (`1` up, `3` left, `4` right) and slide easing
   - `3x` channels → slide streams (start / visible ticks / hidden steps / end), deduped like the game
   - drops marker-only notes, fever lanes, padding lanes, and tap-on-slide overlaps
2. **`gameEngine.ts`** turns that into a playable chart: fall speed, judgments
   (`PERFECT / GREAT / GOOD / MISS`), combo, score, accuracy, slide-tick combo events.
3. **`PlayScreen.tsx`** fetches the chart, wires the HUD, and handles start → play → results.

## ⚠️ Known limitations

- Slide ticks/end are judged as combo events once the slide head is hit — true hold/release detection is not implemented yet.
- Charts come from the public `sekai.best` conversions; a few sections contain fewer notes than the in-game charts.
- Guide channels (`9x`) are parsed but not rendered.

## 🙏 Credits & licensing

- **Project SEKAI: Colorful Stage!** is ©SEGA / Colorful Palette. Songs, jackets and chart data belong to them.
  This project is an unofficial, non-commercial fan recreation — no affiliation or endorsement.
- Chart files: [sekai.best asset storage](https://storage.sekai.best/sekai-jp-assets/music/music_score/)
  (Ched 2.7 SUS exports).
- Parser semantics reference: [UntitledCharts/sonolus-level-converters](https://github.com/UntitledCharts/sonolus-level-converters).
- Logo: original design for this project.

## 📄 License

[MIT](LICENSE) © 2026 AtaberkCelil
