import {
  ChevronDown,
  ChevronLeft,
  Grid2X2,
  Heart,
  MoreHorizontal,
  Play,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import PlayScreen from "../components/PlayScreen";
import type { DifficultyKey, Level } from "../types";

const BACKDROP = "/covers/131.png";
const INTENSE_VOICE_ART = "/covers/131.png";
const MESMERIZER_ART = "/covers/531.png";
const MENU_MUSIC = "/menumusic/welcome-to-sonolus.mp3";

const levels: Level[] = [
  {
    id: 131,
    slug: "sekai-best-131-241-master",
    title: "The Intense Voice of Hatsune Miku",
    artist: "cosMo@BousouP, GAiA",
    project: "Project Sekai: Colorful Stage!",
    difficulty: "Master",
    label: "Next SEKAI",
    description: "初音ミクの激唱 The Intense Voice of Hatsune Miku 初音未来的激唱 The Intense Voice Of Hatsune Miku 初音mikuno激唱 mikuno TheIntenseVoiceofHatsuneMiku  TheIntenseVoiceOfHatsuneMiku",
    charts: { easy: 9, normal: 14, hard: 20, expert: 30, master: 34 },
    assets: { folder: "/levelinfo/The intense voice of hatsune miku", audio: "music/初音ミクの激唱-full-初音 ミク.mp3" },
    art: INTENSE_VOICE_ART,
    tone: "blue",
  },
  {
    id: 531,
    slug: "sekai-best-531-1088-master",
    title: "Mesmerizer",
    artist: "Satsuki feat. Hatsune Miku & Kasane Teto",
    project: "Project Sekai: Colorful Stage!",
    difficulty: "Master",
    label: "Next SEKAI",
    description: "メズマライザー Mesmerizer mezumaraizaa",
    charts: { easy: 8, normal: 13, hard: 20, expert: 26, master: 31 },
    assets: { folder: "/levelinfo/mesmerizer", audio: "music/531.mp3" },
    art: MESMERIZER_ART,
    tone: "sunset",
  },
  
];

const difficultyOptions = ["All", "Easy", "Normal", "Hard", "Expert", "Master"];
const difficultyOrder: DifficultyKey[] = ["easy", "normal", "hard", "expert", "master"];

function LevelCard({ level, onSelect }: { level: Level; onSelect: (level: Level) => void }) {
  const levelNumber = level.charts[level.difficulty.toLowerCase() as DifficultyKey] ?? level.id;
  return (
    <button className="level-card" onClick={() => onSelect(level)} aria-label={`Open ${level.title}`}>
      <div className={`cover cover-${level.tone}`}>
        <img src={level.art} alt="" />
        <span className="level-number">{levelNumber}</span>
        <span className="cover-label">{level.label}</span>
      </div>
      <div className="level-details">
        <div className="card-meta">
          <span className="song-slug">{level.slug}</span>
          <span className="project-name">{level.project}</span>
        </div>
        <h2>{level.title}</h2>
        <p className="artist">{level.artist}</p>
        <div className="card-bottom">
          <span className="difficulty-pill">{level.difficulty}</span>
          <span className="description">{level.description}</span>
          <Play size={13} strokeWidth={2.5} className="play-mark" aria-hidden="true" />
        </div>
      </div>
    </button>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [difficulty, setDifficulty] = useState("All");
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(null);
  const [playing, setPlaying] = useState<{ level: Level; difficulty: DifficultyKey } | null>(null);
  const [favorites, setFavorites] = useState<number[]>([]);
  const menuMusicRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);

  useEffect(() => {
    playingRef.current = Boolean(playing);
  }, [playing]);

  // Menü müziği: listede çalar, seviye oynanırken duraklar.
  // Tarayıcı otomatik oynatmayı engellediği için ilk tıklama/tuşta başlatılır.
  useEffect(() => {
    const audio = new Audio(encodeURI(MENU_MUSIC));
    audio.loop = true;
    audio.volume = 0.5;
    menuMusicRef.current = audio;

    const tryPlay = () => {
      if (playingRef.current || !audio.paused) return;
      void audio.play().catch(() => undefined);
    };

    tryPlay();
    window.addEventListener("pointerdown", tryPlay);
    window.addEventListener("keydown", tryPlay);

    return () => {
      window.removeEventListener("pointerdown", tryPlay);
      window.removeEventListener("keydown", tryPlay);
      audio.pause();
      audio.src = "";
      menuMusicRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = menuMusicRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play().catch(() => undefined);
  }, [playing]);

  const filteredLevels = useMemo(() => {
    const search = query.trim().toLowerCase();
    return levels.filter((level) => {
      const matchesQuery = !search || [level.title, level.artist, level.project, level.slug].join(" ").toLowerCase().includes(search);
      const matchesDifficulty = difficulty === "All" || level.difficulty === difficulty;
      return matchesQuery && matchesDifficulty;
    });
  }, [difficulty, query]);

  const toggleFavorite = (id: number) => {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  return (
    <main className="levels-app" style={{ "--backdrop": `url(${BACKDROP})` } as React.CSSProperties}>
      <div className="backdrop" aria-hidden="true" />
      <div className="backdrop-shade" aria-hidden="true" />

      <header className="topbar">
        <button className="icon-button home-button" aria-label="Sonopc — back to top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <img className="brand-mark" src="/logo.svg" alt="Sonopc" width={34} height={34} />
        </button>
        <h1>Project Sekai Levels</h1>
        <button className="icon-button back-button" aria-label="Go back" onClick={() => window.history.back()}>
          <ChevronLeft size={36} strokeWidth={3} />
        </button>
      </header>

      <section className="content-wrap">
        <div className="search-area">
          <div className="search-box">
            <Search size={27} strokeWidth={2.6} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Enter keywords..."
              aria-label="Search levels"
            />
            {query && <button className="clear-search" aria-label="Clear search" onClick={() => setQuery("")}><X size={23} /></button>}
          </div>
          <div className="filter-row">
            <button className={`filter-button ${showAdvanced ? "is-active" : ""}`} onClick={() => setShowAdvanced((value) => !value)}>
              <SlidersHorizontal size={23} strokeWidth={2.4} />
              <span>Advanced</span>
            </button>
            <button className={`filter-button more-button ${showMore ? "is-active" : ""}`} onClick={() => setShowMore((value) => !value)}>
              <MoreHorizontal size={24} strokeWidth={3} />
              <span>More</span>
            </button>
          </div>
          {showAdvanced && (
            <div className="advanced-panel">
              <span className="panel-label">Difficulty</span>
              <div className="difficulty-options">
                {difficultyOptions.map((option) => (
                  <button key={option} className={difficulty === option ? "selected" : ""} onClick={() => setDifficulty(option)}>{option}</button>
                ))}
              </div>
            </div>
          )}
          {showMore && (
            <div className="more-menu">
              <button onClick={() => setQuery("")}><Grid2X2 size={15} /> Reset view</button>
              <button onClick={() => setDifficulty("All")}><ChevronDown size={15} /> Sort: random</button>
            </div>
          )}
        </div>

        <div className="section-heading">
          <span>Random</span>
          <span className="result-count">{filteredLevels.length} songs</span>
        </div>

        <section className="level-list" aria-label="Random levels">
          {filteredLevels.map((level, index) => (
            <div className="card-stagger" style={{ "--delay": `${index * 70}ms` } as React.CSSProperties} key={level.id}>
              <LevelCard
                level={level}
                onSelect={(level) => {
                  setSelectedLevel(level);
                }}
              />
              <button className={`favorite-button ${favorites.includes(level.id) ? "is-favorite" : ""}`} aria-label={`Favorite ${level.title}`} onClick={() => toggleFavorite(level.id)}>
                <Heart size={17} fill={favorites.includes(level.id) ? "currentColor" : "none"} />
              </button>
            </div>
          ))}
          {filteredLevels.length === 0 && (
            <div className="empty-state">
              <Search size={28} />
              <strong>No levels found</strong>
              <span>Try a different keyword or difficulty.</span>
              <button onClick={() => { setQuery(""); setDifficulty("All"); }}>Clear filters</button>
            </div>
          )}
        </section>
      </section>

      {selectedLevel && (
        <div className="difficulty-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setSelectedLevel(null);
          }
        }}>
          <section className="difficulty-dialog" role="dialog" aria-modal="true" aria-labelledby="difficulty-dialog-title">
            <button className="dialog-close" aria-label="Close difficulty selection" onClick={() => setSelectedLevel(null)}>
              <X size={18} />
            </button>
            <img src={selectedLevel.art} alt="" />
            <div className="dialog-copy">
              <span>Selected level</span>
              <h2 id="difficulty-dialog-title">{selectedLevel.title}</h2>
              <p>{selectedLevel.assets ? "Choose a difficulty to play." : "Chart files for this song are not available yet."}</p>
            </div>
            <div className="difficulty-choices">
              {difficultyOrder.map((key) => {
                const value = selectedLevel.charts[key];
                if (value === undefined) return null;
                return (
                  <button
                    key={key}
                    className="difficulty-choice"
                    disabled={!selectedLevel.assets}
                    onClick={() => {
                      setPlaying({ level: selectedLevel, difficulty: key });
                      setSelectedLevel(null);
                    }}
                  >
                    <span>{key.toUpperCase()} · Lv.{value}</span>
                    <Play size={13} strokeWidth={2.5} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {playing && <PlayScreen level={playing.level} difficulty={playing.difficulty} onExit={() => setPlaying(null)} />}
    </main>
  );
}
