export type NoteType = "tap" | "critical" | "trace" | "flick" | "damage" | "hold" | "slide";
export type FlickDirection = "up" | "left" | "right";

export interface Note {
  id: string;
  /** Vuruş zamanı (saniye) */
  time: number;
  /** 0 tabanlı şerit indeksi */
  lane: number;
  /** Şerit cinsinden genişlik (1 = tam şerit) */
  width: number;
  type: NoteType;
  /** Flick yönü (air kanalı): yukarı / sol / sağ */
  direction?: FlickDirection;
  /** hold / slide notaları için bitiş zamanı (saniye) */
  endTime?: number;
  /** hold / slide notaları için bitiş şeridi */
  endLane?: number;
  /** Slide ucundaki flick yönü */
  endDirection?: FlickDirection;
  /** Kritik trace işareti (tip 6) */
  critical?: boolean;
  /** Slide üstündeki görünür tikler (saniye) */
  ticks?: number[];
}

export interface BPMChange {
  tick: number;
  bpm: number;
  time: number;
}

export interface ParsedChart {
  title: string;
  artist: string;
  designer: string;
  /** #WAVE alanı (bu pakette boş bırakılmış) */
  wave: string;
  /** #WAVEOFFSET (saniye) */
  audioOffset: number;
  bpm: number;
  ticksPerBeat: number;
  notes: Note[];
  bpmChanges: BPMChange[];
  /** Son notanın bitiş zamanı (saniye) */
  duration: number;
}

/** Oyun alanındaki şerit sayısı (Ched / ProSeka 12 şerit). */
export const LANE_COUNT = 12;

/** Sekan ham şerit indeksleri 2..13 aralığındadır (15 = fever, 0/1/14 dolgu). */
const MIN_RAW_LANE = 2;
const MAX_RAW_LANE = 13;
const FEVER_RAW_LANE = 15;
/** Token'ın ikinci karakteri genişliktir; 2 birim = 1 tam şerit. */
const HALF_LANE_UNITS = 2;

interface HeaderLine {
  header: string;
  data: string;
}

interface RawNote {
  tick: number;
  rawLane: number;
  width: number;
  type: number;
}

function int36(text: string): number {
  return parseInt(text, 36);
}

function splitTokens(data: string): string[] {
  const tokens: string[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) tokens.push(data.substr(i, 2));
  return tokens;
}

/** Ölçü/BPM değerlerinde ondalık nokta korunur; nota verisinde sadece alfanümerik kalır. */
function sanitize(data: string): string {
  return data.replace(/[^0-9A-Za-z.]/g, "");
}

function laneOf(rawLane: number): number {
  return rawLane - MIN_RAW_LANE;
}

function widthOf(rawWidth: number): number {
  return Math.max(0.5, Math.min(rawWidth / HALF_LANE_UNITS, LANE_COUNT));
}

/**
 * Ched (SUS) formatındaki metni çözümler.
 * Referans: UntitledCharts/sonolus-level-converters sus/loader.py
 *
 * Kanal yapısı (başlık = 3 haneli ölçü + kanal):
 *   #mmmCC: <veri>  -> CC = 02 ölçü uzunluğu, 08 BPM değişimi
 *   #BPMxx: <bpm>   -> BPM tanımı
 *   #mmmtl: <veri>  -> t = 1 kisa notalar, t = 5 air/yön işaretleri (l = şerit)
 *   #mmmtli: <veri> -> t = 3 slide akışları, t = 9 guide (i = akış kimliği)
 */
export function parseSUS(content: string): ParsedChart {
  let title = "";
  let artist = "";
  let designer = "";
  let wave = "";
  let audioOffset = 0;
  let ticksPerBeat = 480;

  const bpmDefinitions = new Map<string, number>();
  const barLengths = new Map<number, number>();
  const headerLines: HeaderLine[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("#")) continue;

    const dataLine = /^#([0-9A-Za-z]{5,6}):\s*(.*)$/.exec(line);
    if (dataLine) {
      headerLines.push({ header: dataLine[1], data: sanitize(dataLine[2]) });
      continue;
    }

    const meta = /^#([A-Za-z]+)\s+(.*)$/.exec(line);
    if (!meta) continue;
    const key = meta[1].toUpperCase();
    const value = meta[2].trim().replace(/^"(.*)"$/, "$1");

    if (key === "TITLE") title = value;
    else if (key === "ARTIST") artist = value;
    else if (key === "DESIGNER") designer = value;
    else if (key === "WAVE") wave = value;
    else if (key === "WAVEOFFSET") audioOffset = parseFloat(value) || 0;
    else if (key === "REQUEST") {
      const m = /ticks_per_beat\s+(\d+)/.exec(value);
      if (m) ticksPerBeat = parseInt(m[1], 10);
    }
  }

  for (const line of headerLines) {
    if (/^BPM[0-9A-Za-z]{2}$/.test(line.header)) {
      const bpm = parseFloat(line.data);
      if (!Number.isNaN(bpm) && bpm > 0) bpmDefinitions.set(line.header.slice(3), bpm);
    } else if (/^[0-9]{3}02$/.test(line.header)) {
      const beats = parseFloat(line.data);
      if (!Number.isNaN(beats) && beats > 0) barLengths.set(parseInt(line.header.slice(0, 3), 10), beats);
    }
  }

  // Ölçü -> tick dönüşümü (referansla aynı hesap)
  const barEntries = [...barLengths.entries()].sort((a, b) => a[0] - b[0]);
  if (barEntries.length === 0) barEntries.push([0, 4]);
  const bars: Array<{ measure: number; tpm: number; ticks: number }> = [
    { measure: barEntries[0][0], tpm: Math.trunc(barEntries[0][1] * ticksPerBeat), ticks: 0 },
  ];
  for (let i = 1; i < barEntries.length; i++) {
    const tpm = Math.trunc(barEntries[i][1] * ticksPerBeat);
    const span = Math.trunc((barEntries[i][0] - barEntries[i - 1][0]) * barEntries[i - 1][1] * ticksPerBeat);
    bars.push({ measure: barEntries[i][0], tpm, ticks: span });
  }

  const toTick = (measure: number, index: number, total: number): number => {
    if (total <= 0) total = 1;
    let bIndex = 0;
    let acc = 0;
    for (let i = 0; i < bars.length; i++) {
      if (bars[i].measure > measure) break;
      bIndex = i;
      acc += bars[i].ticks;
    }
    return acc + (measure - bars[bIndex].measure) * bars[bIndex].tpm + Math.floor((index * bars[bIndex].tpm) / total);
  };

  // BPM değişiklikleri (#00008 + #BPMxx tanımları)
  const bpmRefs: Array<{ measure: number; index: number; count: number; cell: string }> = [];
  for (const line of headerLines) {
    if (!/^[0-9]{3}08$/.test(line.header)) continue;
    const measure = parseInt(line.header.slice(0, 3), 10);
    const cells = splitTokens(line.data);
    cells.forEach((cell, index) => {
      if (cell === "00") return;
      bpmRefs.push({ measure, index, count: cells.length, cell });
    });
  }

  const rawChanges = bpmRefs
    .map((ref) => ({ tick: toTick(ref.measure, ref.index, ref.count), bpm: bpmDefinitions.get(ref.cell) ?? 120 }))
    .filter((c) => !Number.isNaN(c.bpm) && c.bpm > 0)
    .sort((a, b) => a.tick - b.tick);

  const bpmChanges: BPMChange[] = [];
  if (rawChanges.length === 0) {
    bpmChanges.push({ tick: 0, bpm: bpmDefinitions.values().next().value ?? 120, time: 0 });
  } else {
    let prevTick = 0;
    let prevBpm = rawChanges[0].bpm;
    let time = 0;
    if (rawChanges[0].tick > 0) bpmChanges.push({ tick: 0, bpm: prevBpm, time: 0 });
    for (const change of rawChanges) {
      time += ((change.tick - prevTick) / ticksPerBeat) * (60 / prevBpm);
      bpmChanges.push({ tick: change.tick, bpm: change.bpm, time });
      prevTick = change.tick;
      prevBpm = change.bpm;
    }
    if (bpmChanges.length === 0) bpmChanges.push({ tick: 0, bpm: prevBpm, time: 0 });
  }

  const tickToSeconds = (tick: number): number => {
    let i = bpmChanges.length - 1;
    while (i > 0 && bpmChanges[i].tick > tick) i--;
    const c = bpmChanges[i];
    return c.time + ((tick - c.tick) / ticksPerBeat) * (60 / c.bpm);
  };

  // Kanal ayrıştırma: 1x kisa notalar, 5x air/yön, 3li slide akışları (9li guide gerekmediği için atlanır)
  const taps: RawNote[] = [];
  const airs: RawNote[] = [];
  const slideStreams = new Map<string, RawNote[]>();

  for (const line of headerLines) {
    const h = line.header;
    const measure = parseInt(h.slice(0, 3), 10);
    if (Number.isNaN(measure)) continue;
    const cells = splitTokens(line.data);

    if (h.length === 5 && h[3] === "1") {
      const rawLane = int36(h[4]);
      cells.forEach((cell, index) => {
        if (cell === "00") return;
        taps.push({ tick: toTick(measure, index, cells.length), rawLane, width: int36(cell[1]), type: int36(cell[0]) });
      });
    } else if (h.length === 5 && h[3] === "5") {
      const rawLane = int36(h[4]);
      cells.forEach((cell, index) => {
        if (cell === "00") return;
        airs.push({ tick: toTick(measure, index, cells.length), rawLane, width: int36(cell[1]), type: int36(cell[0]) });
      });
    } else if (h.length === 6 && h[3] === "3") {
      const rawLane = int36(h[4]);
      const id = h[5];
      let stream = slideStreams.get(id);
      if (!stream) {
        stream = [];
        slideStreams.set(id, stream);
      }
      cells.forEach((cell, index) => {
        if (cell === "00") return;
        stream!.push({ tick: toTick(measure, index, cells.length), rawLane, width: int36(cell[1]), type: int36(cell[0]) });
      });
    }
  }

  // Air kanalı: 1=yukari, 3=sol, 4=sağ flick yönü (2/5/6 = slide easing, yoksayılır)
  const flickMap = new Map<string, FlickDirection>();
  for (const air of airs) {
    const key = `${air.tick}-${air.rawLane}`;
    if (air.type === 1) flickMap.set(key, "up");
    else if (air.type === 3) flickMap.set(key, "left");
    else if (air.type === 4) flickMap.set(key, "right");
  }

  // Slide akışları: sıra ile başla, tip 2 (END) de bitir; bitmemiş akışlar atılır
  const keptSlides: RawNote[][] = [];
  const slideSeen = new Set<string>();
  for (const stream of slideStreams.values()) {
    const sorted = [...stream].sort((a, b) => a.tick - b.tick);
    let current: RawNote[] = [];
    let startNew = true;
    const groups: RawNote[][] = [];
    for (const note of sorted) {
      if (startNew) {
        current = [];
        startNew = false;
      }
      current.push(note);
      if (note.type === 2) {
        groups.push(current);
        startNew = true;
      }
    }
    for (const group of groups) {
      if (group.length < 2) continue;
      const first = group[0];
      const last = group[group.length - 1];
      const dedupKey = `${first.tick}:${first.rawLane}:${last.tick}:${last.rawLane}`;
      if (slideSeen.has(dedupKey)) continue;
      slideSeen.add(dedupKey);
      keptSlides.push(group);
    }
  }

  // Kisa notalarla slide kesişimleri oyun tarafından birleştirilir
  const slideKeys = new Set<string>();
  for (const group of keptSlides) for (const p of group) slideKeys.add(`${p.tick}-${p.rawLane}`);

  // Kisa notalar -> Singles (referansla aynı filtreler)
  const notes: Note[] = [];
  let noteCounter = 0;
  const singleSeen = new Set<string>();
  const sortedTaps = [...taps].sort((a, b) => a.tick - b.tick);

  for (const tap of sortedTaps) {
    // 3 = slide step-ignore işareti, 4 = skill olayı, 7/8 = hidden-hold işareti (oyun tarafından oynanmaz)
    if (tap.type === 3 || tap.type === 4 || tap.type === 7 || tap.type === 8) continue;
    if (tap.rawLane < MIN_RAW_LANE || tap.rawLane > MAX_RAW_LANE || tap.rawLane === FEVER_RAW_LANE) continue;

    const key = `${tap.tick}-${tap.rawLane}`;
    if (slideKeys.has(key)) continue;
    if (singleSeen.has(key)) continue;
    singleSeen.add(key);

    const direction = flickMap.get(key);
    const type: NoteType =
      tap.type === 2 ? "critical" : tap.type === 5 || tap.type === 6 ? "trace" : direction ? "flick" : "tap";
    const note: Note = {
      id: `note_${noteCounter++}`,
      time: tickToSeconds(tap.tick),
      lane: laneOf(tap.rawLane),
      width: widthOf(tap.width),
      type,
    };
    if (direction) note.direction = direction;
    if (tap.type === 6) note.critical = true;
    notes.push(note);
  }

  // Slides -> tek bir uzun nota (başlangıçtan bitişe interpolasyon + görünür tikler)
  for (const group of keptSlides) {
    const first = group[0];
    const last = group[group.length - 1];
    const note: Note = {
      id: `note_${noteCounter++}`,
      time: tickToSeconds(first.tick),
      lane: laneOf(first.rawLane),
      width: widthOf(first.width),
      type: "slide",
      endTime: tickToSeconds(last.tick),
      endLane: laneOf(last.rawLane),
    };
    const endDirection = flickMap.get(`${last.tick}-${last.rawLane}`);
    if (endDirection) note.endDirection = endDirection;
    const ticks = group.filter((p) => p.type === 3).map((p) => tickToSeconds(p.tick));
    if (ticks.length > 0) note.ticks = ticks;
    notes.push(note);
  }

  notes.sort((a, b) => a.time - b.time);
  const duration = notes.reduce((max, note) => Math.max(max, note.endTime ?? note.time), 0);

  return {
    title,
    artist,
    designer,
    wave,
    audioOffset,
    bpm: bpmChanges[0]?.bpm ?? 120,
    ticksPerBeat,
    notes,
    bpmChanges,
    duration,
  };
}
