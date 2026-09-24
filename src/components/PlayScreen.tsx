import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Play as PlayIcon, RotateCcw } from "lucide-react";
import { GameEngine } from "../game/gameEngine";
import { parseSUS } from "../game/susParser";
import type { DifficultyKey, Level } from "../types";

type PlayResult = { score: number; accuracy: number; maxCombo: number; totalNotes: number };

type Props = {
  level: Level;
  difficulty: DifficultyKey;
  onExit: () => void;
};

export default function PlayScreen({ level, difficulty, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "playing" | "finished" | "error">("loading");
  const [error, setError] = useState("");
  const [autoPlay, setAutoPlay] = useState(true);
  const [noteSpeed, setNoteSpeed] = useState(() => {
    const stored = Number(window.localStorage.getItem("sonopc.noteSpeed"));
    return Number.isFinite(stored) && stored >= 0.25 && stored <= 4 ? stored : 1;
  });
  const [result, setResult] = useState<PlayResult | null>(null);

  const levelNumber = level.charts[difficulty] ?? 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GameEngine(canvas);
    engine.setNoteSpeed(noteSpeed);
    engineRef.current = engine;
    engine.onFinish = (value) => {
      setResult(value);
      setPhase("finished");
    };
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setAutoPlay(autoPlay);
  }, [autoPlay]);

  useEffect(() => {
    engineRef.current?.setNoteSpeed(noteSpeed);
  }, [noteSpeed]);

  const loadChart = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !level.assets) return false;
    setPhase("loading");
    setResult(null);
    try {
      const chartUrl = `${level.assets.folder}/${difficulty}/${difficulty}.txt`;
      const response = await fetch(encodeURI(chartUrl));
      if (!response.ok) throw new Error(`HTTP ${response.status} (${chartUrl})`);
      const chart = parseSUS(await response.text());
      if (chart.notes.length === 0) throw new Error(`No notes found in ${chartUrl}`);
      await engine.loadLevel(chart, `${level.assets.folder}/${level.assets.audio}`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("error");
      return false;
    }
  }, [difficulty, level]);

  useEffect(() => {
    let cancelled = false;
    void loadChart().then((ok) => {
      if (!cancelled && ok) setPhase("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [loadChart]);

  const startGame = () => {
    engineRef.current?.start();
    setPhase("playing");
  };

  const playAgain = async () => {
    if (await loadChart()) startGame();
  };

  return (
    <div className="play-screen">
      <canvas ref={canvasRef} />

      <div id="hud" className="play-hud">
        <div id="scoreDisplay">SCORE: 0000000</div>
        <div id="accDisplay">100.00%</div>
      </div>
      <div id="comboContainer" className="play-combo">
        <div id="comboNum" className="play-combo-num">0</div>
        <div className="play-combo-label">COMBO</div>
        <div id="judgmentText" className="judgment-text" />
      </div>

      <button className="play-exit" onClick={onExit} aria-label="Quit level">
        <ChevronLeft size={22} />
      </button>

      <div id="menu" className="play-menu">
        <section className="play-card">
          <img className="play-jacket" src={level.art} alt="" />
          <span className="play-kicker">Now playing</span>
          <h2>{level.title}</h2>
          <p className="play-meta">
            {difficulty.toUpperCase()} · Lv.{levelNumber} · {level.artist}
          </p>

          {phase === "loading" && <p className="play-status">Loading chart…</p>}
          {phase === "error" && <p className="play-status play-error">Could not load the chart: {error}</p>}

          {phase === "finished" && result && (
            <div className="play-result">
              <div><span>Score</span><strong>{String(result.score).padStart(7, "0")}</strong></div>
              <div><span>Accuracy</span><strong>{result.accuracy.toFixed(2)}%</strong></div>
              <div><span>Max combo</span><strong>{result.maxCombo}</strong></div>
              <div><span>Notes</span><strong>{result.totalNotes}</strong></div>
            </div>
          )}

          {phase !== "error" && (
            <>
              <label className="play-autoplay">
                <input type="checkbox" checked={autoPlay} onChange={(event) => setAutoPlay(event.target.checked)} />
                Auto play
              </label>
              <label className="play-speed">
                <span>
                  Note speed <b>{noteSpeed.toFixed(2)}x</b>
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  value={noteSpeed}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setNoteSpeed(value);
                    window.localStorage.setItem("sonopc.noteSpeed", String(value));
                  }}
                />
              </label>
            </>
          )}

          {phase === "ready" && (
            <button className="play-start" onClick={startGame}>
              <PlayIcon size={16} strokeWidth={2.5} /> Start
            </button>
          )}
          {phase === "finished" && (
            <button className="play-start" onClick={() => void playAgain()}>
              <RotateCcw size={15} strokeWidth={2.5} /> Play again
            </button>
          )}
          {(phase === "error" || phase === "finished") && (
            <button className="play-secondary" onClick={onExit}>Back to levels</button>
          )}

          <p className="play-controls">Keys A S D F G H · J K L · ; ' — or tap the lanes</p>
        </section>
      </div>
    </div>
  );
}
