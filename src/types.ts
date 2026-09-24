export type DifficultyKey = "easy" | "normal" | "hard" | "expert" | "master";

export type Level = {
  /** Internal unique id (song id). */
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
  /** Difficulty chart values (Lv.) shown on the card and in the difficulty picker. */
  charts: Partial<Record<DifficultyKey, number>>;
  /** Playable chart/audio location under /levelinfo (omit while the files are missing). */
  assets?: { folder: string; audio: string };
};
