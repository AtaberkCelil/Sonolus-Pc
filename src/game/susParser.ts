export type NoteType = "tap" | "critical" | "trace" | "flick" | "damage" | "hold" | "slide";
export type FlickDirection = "up" | "left" | "right";

/** Slide gövdesindeki nokta çeşidi (referans: SlideStartPoint/RelayPoint/EndPoint). */
export type SlidePointKind = "start" | "tick" | "step" | "attach" | "end";

export interface SlidePoint {
  time: number;
  /** Ham tick değeri — continuation aralıklarını birebir hesaplamak için gerekli. */
  tick: number;
  lane: number;
  width: number;
  kind: SlidePointKind;
  critical: boolean;
  /** Bu nokta combo olayı üretiyor mu (görünür relay). */
  combo: boolean;
}

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
  /** Slide gövdesinin tüm noktaları (başlangıç -> bitiş, görünür ve görünmez adımlar). */
  points?: SlidePoint[];
  /** Baş vuruşu puanlanıyor mu (hidden hold -> judgeType "none"). */
  judgeStart?: boolean;
  /** Bitiş vuruşu puanlanıyor mu. */
  judgeEnd?: boolean;
  /** Slide yönü puanlanıyor mu (friction -> judgeType "trace"). */
  judgeTrace?: boolean;
  /** Tutma sırasında otomatik yarım-beat combo olayları (saniye). */
  continuations?: number[];
}

/** Kanal 9 "guide" varlığı: yalnızca görsel, puanlanmaz (referans: Guide). */
export interface GuideNote {
  id: string;
  critical: boolean;
  points: Array<{ time: number; lane: number; width: number }>;
}

export type ComboEventKind = "single" | "start" | "relay" | "continuation" | "end";

/**
 * Combo olayları takım zaman sırasına göre üretilir.
 * `input` olanlar oyuncunun vuruşunu, `hold` olanlar aktif tutmayı gerektirir.
 */
export interface ComboEvent {
  time: number;
  kind: ComboEventKind;
  critical: boolean;
  /** chart.notes içindeki indeks. */
  noteIndex: number;
  input: boolean;
  hold: boolean;
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
  /** Kanal 9 guide varlıkları (görsel, combo dışı). */
  guides: GuideNote[];
  /** Zaman sırasına göre tüm combo olayları (referans combo_events ile birebir). */
  comboEvents: ComboEvent[];
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

  // Kanal ayrıştırma: 1x kısa notalar, 5x air/yön, 3li slide akışları, 9lu guide akışları
  const taps: RawNote[] = [];
  const airs: RawNote[] = [];
  const slideStreams = new Map<string, RawNote[]>();
  const guideStreams = new Map<string, RawNote[]>();

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
    } else if (h.length === 6 && (h[3] === "3" || h[3] === "9")) {
      // 3 = slide/trace akışı, 9 = guide akışı (ikisi de aynı tip kodlarını kullanır)
      const rawLane = int36(h[4]);
      const id = h[5];
      const target = h[3] === "3" ? slideStreams : guideStreams;
      let stream = target.get(id);
      if (!stream) {
        stream = [];
        target.set(id, stream);
      }
      cells.forEach((cell, index) => {
        if (cell === "00") return;
        stream!.push({ tick: toTick(measure, index, cells.length), rawLane, width: int36(cell[1]), type: int36(cell[0]) });
      });
    }
  }

  /** Bir akışı START(1)/END(2) sırasıyla böler; bitmemiş akışlar atılır. */
  const splitStreams = (source: Map<string, RawNote[]>): RawNote[][] => {
    const out: RawNote[][] = [];
    for (const stream of source.values()) {
      const sorted = [...stream].sort((a, b) => a.tick - b.tick);
      let current: RawNote[] = [];
      for (const note of sorted) {
        current.push(note);
        if (note.type === 2) {
          if (current.length >= 2) out.push(current);
          current = [];
        }
      }
    }
    return out;
  };

  /** Aynı başlangıç/bitiş (tick, lane) çiftini taşıyan akışları birleştirir. */
  const dedupHolds = (holds: RawNote[][]): RawNote[][] => {
    const seen = new Set<string>();
    const result: RawNote[][] = [];
    for (const hold of holds) {
      if (hold.length < 2) continue;
      const key = `${hold[0].tick}:${hold[0].rawLane}:${hold[hold.length - 1].tick}:${hold[hold.length - 1].rawLane}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(hold);
    }
    return result;
  };

  const keptSlides = dedupHolds(splitStreams(slideStreams));
  const keptGuides = dedupHolds(splitStreams(guideStreams));

  // Air kanalı: 1=yukari, 3=sol, 4=sağ flick yönü (2/5/6 = ease in/out, yoksayılır)
  const flickMap = new Map<string, FlickDirection>();
  for (const air of airs) {
    const key = `${air.tick}-${air.rawLane}`;
    if (air.type === 1) flickMap.set(key, "up");
    else if (air.type === 3) flickMap.set(key, "left");
    else if (air.type === 4) flickMap.set(key, "right");
  }

  // Kısa nota işaretleri (referans sus loader ile birebir)
  const criticals = new Set<string>();
  const stepIgnore = new Set<string>();
  const frictions = new Set<string>();
  const hiddenHolds = new Set<string>();
  for (const tap of taps) {
    const key = `${tap.tick}-${tap.rawLane}`;
    if (tap.type === 2) criticals.add(key);
    else if (tap.type === 3) stepIgnore.add(key);
    else if (tap.type === 5) frictions.add(key);
    else if (tap.type === 6) {
      criticals.add(key);
      frictions.add(key);
    } else if (tap.type === 7) hiddenHolds.add(key);
    else if (tap.type === 8) {
      hiddenHolds.add(key);
      criticals.add(key);
    }
  }

  /** judgeType: hidden hold -> "none", friction -> "trace", aksi halde "normal". */
  const judgeTypeOf = (key: string): "normal" | "trace" | "none" => {
    if (hiddenHolds.has(key)) return "none";
    if (frictions.has(key)) return "trace";
    return "normal";
  };

  // Kısa notalarla slide kesişimleri oyun tarafından birleştirilir
  const slideKeys = new Set<string>();
  for (const group of keptSlides) for (const p of group) slideKeys.add(`${p.tick}-${p.rawLane}`);

  // Kisa notalar -> Singles (referansla aynı filtreler)
  const notes: Note[] = [];
  let noteCounter = 0;
  const singleSeen = new Set<string>();
  const sortedTaps = [...taps].sort((a, b) => a.tick - b.tick);

  for (const tap of sortedTaps) {
    // 4 = skill olayı (oyun notu değil), 15 = fever kanalı (combo dışı)
    if (tap.type === 4) continue;
    if (tap.rawLane === FEVER_RAW_LANE) continue;
    // 3 = step-ignore işareti, 7/8 = hidden-hold işareti (oyun tarafından oynanmaz)
    if (tap.type === 3 || tap.type === 7 || tap.type === 8) continue;
    if (tap.rawLane < MIN_RAW_LANE || tap.rawLane > MAX_RAW_LANE) continue;

    const key = `${tap.tick}-${tap.rawLane}`;
    if (slideKeys.has(key)) continue;
    if (singleSeen.has(key)) continue;
    singleSeen.add(key);

    const direction = flickMap.get(key);
    const isCritical = criticals.has(key);
    const isFriction = frictions.has(key);
    const type: NoteType = isCritical ? "critical" : isFriction ? "trace" : direction ? "flick" : "tap";
    const note: Note = {
      id: `note_${noteCounter++}`,
      time: tickToSeconds(tap.tick),
      lane: laneOf(tap.rawLane),
      width: widthOf(tap.width),
      type,
    };
    if (direction) note.direction = direction;
    if (isCritical) note.critical = true;
    notes.push(note);
  }

  // Slides -> tek bir uzun nota (gövde noktaları + combo üreten tikler)
  for (const group of keptSlides) {
    const first = group[0];
    const last = group[group.length - 1];
    const startKey = `${first.tick}-${first.rawLane}`;
    const startJudge = judgeTypeOf(startKey);
    const endJudge = judgeTypeOf(`${last.tick}-${last.rawLane}`);
    const isCritical = criticals.has(startKey);

    const note: Note = {
      id: `note_${noteCounter++}`,
      time: tickToSeconds(first.tick),
      lane: laneOf(first.rawLane),
      width: widthOf(first.width),
      type: "slide",
      endTime: tickToSeconds(last.tick),
      endLane: laneOf(last.rawLane),
      critical: isCritical,
      judgeStart: startJudge !== "none",
      judgeEnd: endJudge !== "none",
      judgeTrace: startJudge === "trace" || endJudge === "trace",
    };
    const endDirection = flickMap.get(`${last.tick}-${last.rawLane}`);
    if (endDirection) note.endDirection = endDirection;

    // Gövde noktaları: start / tick (tip 3) / step (tip 5) / attach / end
    const points: SlidePoint[] = [];
    for (const p of group) {
      const key = `${p.tick}-${p.rawLane}`;
      let kind: SlidePointKind;
      let combo: boolean;
      if (p.type === 1) {
        kind = "start";
        combo = true;
      } else if (p.type === 2) {
        kind = "end";
        combo = true;
      } else if (p.type === 3) {
        // tip 3 + step-ignore -> "attach": şekil değiştirmez ama combo ekler
        kind = stepIgnore.has(key) ? "attach" : "tick";
        combo = true;
      } else {
        // tip 5 -> görünmez adım: şekli değiştirir, combo EKLEMEZ
        kind = "step";
        combo = false;
      }
      // Kritiklik her bağlantı noktasının KENDİ değerinden gelir:
      //   - start / tick / step -> slide'ın kendi kritikliği
      //   - end                  -> slide kritik VEYA uç noktanın kendi kritikliği
      // Referans: sus/loader.py `end_critical = critical or (key in criticals)`
      const pointCritical = kind === "end" ? isCritical || criticals.has(key) : isCritical;
      points.push({
        time: tickToSeconds(p.tick),
        tick: p.tick,
        lane: laneOf(p.rawLane),
        width: widthOf(p.width),
        kind,
        critical: pointCritical,
        combo,
      });
    }
    note.points = points;
    notes.push(note);
  }

  // Guides (kanal 9): yalnızca görsel, combo dışı
  const guides: GuideNote[] = [];
  for (const group of keptGuides) {
    const first = group[0];
    guides.push({
      id: `guide_${guides.length}`,
      critical: criticals.has(`${first.tick}-${first.rawLane}`),
      points: group.map((p) => ({
        time: tickToSeconds(p.tick),
        lane: laneOf(p.rawLane),
        width: widthOf(p.width),
      })),
    });
  }

  notes.sort((a, b) => a.time - b.time);
  const duration = notes.reduce((max, note) => Math.max(max, note.endTime ?? note.time), 0);

  const comboEvents = buildComboEvents(notes, ticksPerBeat, tickToSeconds);
  comboEvents.sort((a, b) => a.time - b.time);

  return {
    title,
    artist,
    designer,
    wave,
    audioOffset,
    bpm: bpmChanges[0]?.bpm ?? 120,
    ticksPerBeat,
    notes,
    guides,
    comboEvents,
    bpmChanges,
    duration,
  };
}

/**
 * Referans `combo_events()` ile birebir aynı combo olaylarını üretir.
 *
 * Uzun nota (slide) olayları:
 *   - start / end (judgeType "none" ise puanlanmaz)
 *   - görünür relay'ler (tip 3) ve step-ignore "attach" relay'leri
 *   - "long_continuations": yarım beat (240 tick) aralıklarla, tutma başladıktan
 *     bitişe kadar otomatik combo üreten olaylar. Bunlar in-game komboyu
 *     yükselten ve daha önce eksik kalan notalardır.
 */
function buildComboEvents(
  notes: Note[],
  ticksPerBeat: number,
  tickToSeconds: (tick: number) => number
): ComboEvent[] {
  const events: ComboEvent[] = [];
  const HALF_BEAT = Math.floor(ticksPerBeat / 2);

  for (let index = 0; index < notes.length; index++) {
    const note = notes[index];
    if (note.type !== "slide" || !note.points || note.points.length === 0) {
      events.push({
        time: note.time,
        kind: "single",
        critical: Boolean(note.critical),
        noteIndex: index,
        input: true,
        hold: false,
      });
      continue;
    }

    const points = note.points;
    const startTick = points[0].tick;
    const endTick = points[points.length - 1].tick;
    let cursor = startTick + HALF_BEAT;
    if (cursor % HALF_BEAT) cursor -= cursor % HALF_BEAT;
    const hasTicks = cursor !== startTick && cursor !== endTick;

    let prevJointSeen = false;
    const flushContinuations = (upToTick: number) => {
      if (!hasTicks || !prevJointSeen) return;
      let adjusted = upToTick;
      if (adjusted % HALF_BEAT) adjusted += HALF_BEAT - (adjusted % HALF_BEAT);
      while (cursor < adjusted) {
        events.push({
          time: tickToSeconds(cursor),
          kind: "continuation",
          critical: Boolean(note.critical),
          noteIndex: index,
          input: false,
          hold: true,
        });
        cursor += HALF_BEAT;
      }
    };

    for (const point of points) {
      if (point.kind === "start") {
        if (note.judgeStart !== false) {
          events.push({
            time: point.time,
            kind: "start",
            critical: point.critical,
            noteIndex: index,
            input: true,
            hold: false,
          });
        }
        prevJointSeen = true;
      } else if (point.kind === "end") {
        if (note.judgeEnd !== false) {
          events.push({
            time: point.time,
            kind: "end",
            critical: point.critical,
            noteIndex: index,
            input: true,
            hold: false,
          });
        }
        flushContinuations(point.tick);
      } else if (point.kind === "tick" || point.kind === "attach") {
        if (point.combo) {
          events.push({
            time: point.time,
            kind: "relay",
            critical: point.critical,
            noteIndex: index,
            input: false,
            hold: true,
          });
        }
        // "attach" relay'leri prev_joint'i ilerletmez (referans davranışı)
        if (point.kind === "tick") {
          flushContinuations(point.tick);
          prevJointSeen = true;
        }
      }
      // "step" (tip 5): yalnızca şekli değiştirir, combo üretmez
    }
  }

  return events;
}
