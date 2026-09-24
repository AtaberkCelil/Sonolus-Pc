import {
  ChevronDown,
  ChevronLeft,
  Grid2X2,
  Heart,
  Home as HomeIcon,
  MoreHorizontal,
  Play,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

const BACKDROP = "/manus-storage/levels-backdrop_55a36019.jpg";
const GUNJO_ART = "/covers/131.png";
const POSITIVE_ART = "/manus-storage/positive-dance_6be25f3b.jpg";

type Level = {
  id: number;
  slug: string;
  title: string;
  artist: string;
  project: string;
  difficulty: string;
  label: string;
  description: string;
  art: string;
  tone: "blue" | "sunset" | "violet";
};

const levels: Level[] = [
  {
    id: 29,
    slug: "sekai-best-141-1653-append",
    title: "Gunjo Sanka",
    artist: "バーチャル・シンガー & 25時、ナイトコードで。",
    project: "Project Sekai: Colorful Stage!",
    difficulty: "Append",
    label: "Next SEKAI",
    description: "コネクトライブver.",
    art: GUNJO_ART,
    tone: "blue",
  },
  {
    id: 31,
    slug: "sekai-best-122-573-master",
    title: "Positive☆Dance Time",
    artist: "Kagamine Rin & Kiritani Haruka & Azusawa Kohane & Otori Emu & Asahina Mafuyu",
    project: "Project Sekai: Colorful Stage!",
    difficulty: "Master",
    label: "Next SEKAI",
    description: "April Fool's ver.",
    art: POSITIVE_ART,
    tone: "sunset",
  },
  {
    id: 34,
    slug: "sekai-archive-064-expert",
    title: "World Is Mine",
    artist: "Hatsune Miku",
    project: "Project Sekai: Colorful Stage!",
    difficulty: "Expert",
    label: "Classic",
    description: "Original song ver.",
    art: GUNJO_ART,
    tone: "violet",
  },
  {
    id: 38,
    slug: "sekai-event-091-hard",
    title: "Showtime Ruler",
    artist: "Wonderlands×Showtime",
    project: "Project Sekai: Colorful Stage!",
    difficulty: "Hard",
    label: "Event",
    description: "Full combo challenge.",
    art: POSITIVE_ART,
    tone: "blue",
  },
];

const difficultyOptions = ["All", "Append", "Master", "Expert", "Hard"];

function LevelCard({ level, onSelect }: { level: Level; onSelect: (level: Level) => void }) {
  return (
    <button className="level-card" onClick={() => onSelect(level)} aria-label={`Open ${level.title}`}>
      <div className={`cover cover-${level.tone}`}>
        <img src={level.art} alt="" />
        <span className="level-number">{level.id}</span>
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
  const [selected, setSelected] = useState<Level | null>(null);
  const [favorites, setFavorites] = useState<number[]>([]);

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
        <button className="icon-button home-button" aria-label="Home" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <HomeIcon size={28} strokeWidth={3} fill="currentColor" />
        </button>
        <h1>Levels</h1>
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
              <LevelCard level={level} onSelect={setSelected} />
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

      {selected && (
        <div className="preview-toast" role="status">
          <img src={selected.art} alt="" />
          <div><span>Selected level</span><strong>{selected.title}</strong></div>
          <button aria-label="Close preview" onClick={() => setSelected(null)}><X size={18} /></button>
        </div>
      )}
    </main>
  );
}
