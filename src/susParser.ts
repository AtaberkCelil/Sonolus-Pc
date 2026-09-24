export type NoteType = 'tap' | 'critical' | 'flick' | 'damage' | 'hold' | 'slide';

export interface Note {
  id: string;
  /** Vurulma zamanı (saniye, şarkının başına göre) */
  time: number;
  /** 0 tabanlı şerit indeksi */
  lane: number;
  /** Şerit cinsinden genişlik (1 = tam şerit) */
  width: number;
  type: NoteType;
  /** hold / slide notaları için bitiş zamanı (saniye) */
  endTime?: number;
  /** hold / slide notaları için bitiş şeridi */
  endLane?: number;
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

/** Oyun alanındaki şerit sayısı (ProSeka / Ched 12 şerit). */
export const LANE_COUNT = 12;

/**
 * Ched dosyalarında oyun alanının ilk şeridi '2' karakteridir (2..13 arası 12 şerit).
 * 0, 1, 14 ve 15 numaralı şeritler oyun alanı dışındaki dolgu şeritleridir.
 */
const LANE_CHAR_OFFSET = 1;
const PADDING_LANES = new Set([0, 1, 14, 15]);

/**
 * Token'ın ikinci karakteri nota genişliğidir ve yarım şerit birimindedir
 * (resmi ProSeka verisinde de şerit başlangıcı/bitişi yarım şerit birimindedir).
 * Yani 2 birim = 1 tam şerit.
 */
const HALF_LANE_UNITS = 2;

const SHORT_NOTE_TYPES: Record<string, NoteType> = {
  '1': 'tap',
  '2': 'critical',
  '3': 'flick',
  '4': 'damage',
};

/** Uzun nota adımları: 1 = başlangıç, 3 = görünür adım, 5 = gizli adım, 2 = bitiş. */
const LONG_NOTE_START = '1';
const LONG_NOTE_END = '2';

interface HeaderLine {
  header: string;
  data: string;
}

interface Bar {
  measure: number;
  ticksPerMeasure: number;
  startTick: number;
}

interface LongStep {
  tick: number;
  lane: number | null;
  width: number;
  type: string;
}

function parseBase36(text: string): number {
  return parseInt(text, 36);
}

/** Genişlik karakteri 1..f (hex) ya da 16 anlamına gelen 'g' olabilir. */
function parseWidth(digit: string): number {
  return digit === 'g' ? 16 : parseBase36(digit);
}

function toLane(laneChar: string): number | null {
  const raw = parseBase36(laneChar);
  if (Number.isNaN(raw) || PADDING_LANES.has(raw)) return null;
  const lane = raw - LANE_CHAR_OFFSET;
  if (lane < 0 || lane >= LANE_COUNT) return null;
  return lane;
}

function splitTokens(data: string): string[] {
  const tokens: string[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) tokens.push(data.substr(i, 2));
  return tokens;
}

/** Ölçü/BPM değerlerinde ondalık nokta korunur; nota verisinde sadece alfanümerik karakterler kalır. */
function sanitize(data: string): string {
  return data.replace(/[^0-9A-Za-z.]/g, '');
}

/**
 * Ched (SUS) formatındaki metni çözümler.
 *
 * Kanal yapısı (başlık = 3 haneli ölçü numarası + kanal):
 *   #mmm02: <vuruş>        -> ölçünün vuruş sayısı (zaman imzası)
 *   #BPMxx: <bpm>          -> BPM tanımı
 *   #mmm08: <BPM kimliği>  -> BPM değişimi
 *   #mmm1x: <veri>         -> kısa notalar (x = şerit), token = <tip><genişlik>
 *   #mmm5x: <veri>         -> air işaretleyicileri (bu pakette notaların kopyası, atlanır)
 *   #mmm2xy: <veri>        -> hold notalar (x = şerit, y = kimlik)
 *   #mmm3xy: <veri>        -> slide notalar (x = şerit, y = kimlik)
 */
export function parseSUS(content: string): ParsedChart {
  let title = '';
  let artist = '';
  let designer = '';
  let wave = '';
  let audioOffset = 0;
  let ticksPerBeat = 480;

  const bpmDefinitions = new Map<string, number>();
  const barLengths = new Map<number, number>();
  const headerLines: HeaderLine[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('#')) continue;

    const dataLine = /^#([0-9A-Za-z]{5,6}):\s*(.*)$/.exec(line);
    if (dataLine) {
      headerLines.push({ header: dataLine[1], data: sanitize(dataLine[2]) });
      continue;
    }

    const meta = /^#([A-Za-z]+)\s+(.*)$/.exec(line);
    if (!meta) continue;

    const key = meta[1].toUpperCase();
    const value = meta[2].trim().replace(/^"(.*)"$/, '$1');

    if (key === 'TITLE') title = value;
    else if (key === 'ARTIST') artist = value;
    else if (key === 'DESIGNER') designer = value;
    else if (key === 'WAVE') wave = value;
    else if (key === 'WAVEOFFSET') audioOffset = parseFloat(value) || 0;
    else if (key === 'REQUEST') {
      const ticksMatch = /ticks_per_beat\s+(\d+)/.exec(value);
      if (ticksMatch) ticksPerBeat = parseInt(ticksMatch[1], 10);
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

  // Ölçü -> tick dönüşümü: SUS her ölçünün uzunluğunu vuruş cinsinden saklar.
  const barEntries = [...barLengths.entries()].sort((a, b) => a[0] - b[0]);
  if (barEntries.length === 0 || barEntries[0][0] !== 0) barEntries.unshift([0, 4]);

  const bars: Bar[] = [];
  let runningTicks = 0;
  barEntries.forEach(([measure, beats], index) => {
    if (index > 0) {
      const [prevMeasure, prevBeats] = barEntries[index - 1];
      runningTicks += (measure - prevMeasure) * prevBeats * ticksPerBeat;
    }
    bars.push({
      measure,
      ticksPerMeasure: Math.round(beats * ticksPerBeat),
      startTick: runningTicks,
    });
  });

  function toTick(measure: number, index: number, total: number): number {
    let bar = bars[0];
    for (const candidate of bars) {
      if (measure >= candidate.measure) bar = candidate;
      else break;
    }
    const offset = Math.floor((index * bar.ticksPerMeasure) / total);
    return bar.startTick + (measure - bar.measure) * bar.ticksPerMeasure + offset;
  }
  // BPM değişimleri (zaman hesabı için tick -> saniye tablosu üretilir)
  const bpmEvents: { tick: number; identifier: string }[] = [];
  for (const line of headerLines) {
    if (!/^[0-9]{3}08$/.test(line.header)) continue;
    const measure = parseInt(line.header.slice(0, 3), 10);
    const tokens = splitTokens(line.data);
    tokens.forEach((token, index) => {
      if (token === '00') return;
      bpmEvents.push({ tick: toTick(measure, index, tokens.length), identifier: token });
    });
  }
  bpmEvents.sort((a, b) => a.tick - b.tick);

  const baseBpm =
    bpmDefinitions.size > 0
      ? (bpmDefinitions.get(bpmEvents.length > 0 ? bpmEvents[0].identifier : '') ??
          bpmDefinitions.values().next().value ??
          120)
      : 120;

  const bpmChanges: BPMChange[] = [{ tick: 0, bpm: baseBpm, time: 0 }];
  let currentBpm = baseBpm;
  let lastTick = 0;
  let lastTime = 0;

  for (const event of bpmEvents) {
    const bpm = bpmDefinitions.get(event.identifier);
    if (!bpm || event.tick < lastTick) continue;
    lastTime += ((event.tick - lastTick) / ticksPerBeat) * (60 / currentBpm);
    lastTick = event.tick;
    currentBpm = bpm;
    if (bpmChanges[bpmChanges.length - 1].tick === event.tick) {
      bpmChanges[bpmChanges.length - 1] = { tick: event.tick, bpm, time: lastTime };
    } else {
      bpmChanges.push({ tick: event.tick, bpm, time: lastTime });
    }
  }

  function tickToSeconds(tick: number): number {
    let change = bpmChanges[0];
    for (const candidate of bpmChanges) {
      if (candidate.tick <= tick) change = candidate;
      else break;
    }
    return change.time + ((tick - change.tick) / ticksPerBeat) * (60 / change.bpm);
  }

  const notes: Note[] = [];
  let noteCounter = 0;

  const pushNote = (
    tick: number,
    lane: number | null,
    widthUnits: number,
    type: NoteType,
    end?: { tick: number; lane: number | null }
  ) => {
    if (lane === null) return;
    const note: Note = {
      id: `note_${noteCounter++}`,
      time: tickToSeconds(tick),
      lane,
      width: Math.max(0.5, Math.min(widthUnits / HALF_LANE_UNITS, LANE_COUNT)),
      type,
    };
    if (end) {
      note.endTime = tickToSeconds(end.tick);
      note.endLane = end.lane === null ? lane : end.lane;
    }
    notes.push(note);
  };

  // Kısa notalar (tap / critical / flick / damage)
  for (const line of headerLines) {
    if (line.header.length !== 5 || line.header[3] !== '1') continue;
    const measure = parseInt(line.header.slice(0, 3), 10);
    const lane = toLane(line.header[4]);
    const tokens = splitTokens(line.data);
    tokens.forEach((token, index) => {
      if (token === '00') return;
      const type = SHORT_NOTE_TYPES[token[0]];
      if (!type) return;
      pushNote(toTick(measure, index, tokens.length), lane, parseWidth(token[1]), type);
    });
  }

  // Uzun notalar (slide / hold): aynı kimlik harfi zaman içinde tekrar kullanılır,
  // bu yüzden akışlar bitiş token'ı ('2') görülünce kapatılır.
  const streams = new Map<string, LongStep[]>();
  for (const line of headerLines) {
    if (line.header.length !== 6) continue;
    const kind = line.header[3];
    if (kind !== '2' && kind !== '3') continue;

    const measure = parseInt(line.header.slice(0, 3), 10);
    const laneChar = line.header[4];
    const streamId = kind + line.header[5];
    const tokens = splitTokens(line.data);

    tokens.forEach((token, index) => {
      if (token === '00') return;
      const step: LongStep = {
        tick: toTick(measure, index, tokens.length),
        lane: toLane(laneChar),
        width: parseWidth(token[1]),
        type: token[0],
      };
      const stream = streams.get(streamId);
      if (stream) stream.push(step);
      else streams.set(streamId, [step]);
    });
  }

    for (const [streamId, steps] of streams) {
    const type: NoteType = streamId[0] === '2' ? 'hold' : 'slide';
    steps.sort((a: LongStep, b: LongStep) => a.tick - b.tick);
    let current: LongStep | null = null;

    for (const step of steps) {
      if (step.type === LONG_NOTE_START) {
        if (current) pushNote(current.tick, current.lane, current.width, type);
        current = step;
      } else if (step.type === LONG_NOTE_END) {
        const start = current ?? step;
        pushNote(start.tick, start.lane, start.width, type, { tick: step.tick, lane: step.lane });
        current = null;
      }
      // '3' (görünür adım) ve '5' (gizli adım) token'ları başlangıç olmadan kullanılmaz.
    }
    if (current) pushNote(current.tick, current.lane, current.width, type);
  }

  notes.sort((a: Note, b: Note) => a.time - b.time);

  const duration = notes.reduce((max, note) => Math.max(max, note.endTime ?? note.time), 0);

  return {
    title,
    artist,
    designer,
    wave,
    audioOffset,
    bpm: baseBpm,
    ticksPerBeat,
    notes,
    bpmChanges,
    duration,
  };
}


