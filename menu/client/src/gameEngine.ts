import { Note, ParsedChart, LANE_COUNT } from './susParser';

type Judgment = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

/** Vuruş pencereleri (saniye). */
const PERFECT_WINDOW = 0.06;
const GREAT_WINDOW = 0.12;
const GOOD_WINDOW = 0.18;
const MISS_WINDOW = 0.2;

const JUDGMENT_WEIGHT: Record<Judgment, number> = { PERFECT: 1, GREAT: 0.7, GOOD: 0.4, MISS: 0 };

/** Notaların kayma hızı (piksel/saniye) ve yüksekliği. */
const PIXELS_PER_SECOND = 520;
const NOTE_HEIGHT = 24;
const JUDGMENT_LINE_BOTTOM = 150;
/** Oyun alanının ekran genişliğine oranı (en fazla 760 piksel). */
const FIELD_WIDTH_RATIO = 0.55;
const MAX_FIELD_WIDTH = 760;

const NOTE_COLORS: Record<Note['type'], string> = {
  tap: '#ffe600',
  critical: '#ff2d95',
  flick: '#00f0ff',
  hold: '#00ff66',
  slide: '#00ff66',
  damage: '#ff4d4d',
};

/** 12 şerit için klavye eşlemesi (fiziksel tuş konumları, e.code). */
const LANE_KEYS: Record<string, number> = {
  KeyA: 0,
  KeyS: 1,
  KeyD: 2,
  KeyF: 3,
  KeyG: 4,
  KeyH: 5,
  KeyJ: 6,
  KeyK: 7,
  KeyL: 8,
  Semicolon: 9,
  Quote: 10,
  Backslash: 11,
};

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private chart: ParsedChart | null = null;
  private notes: Note[] = [];
  private judged: boolean[] = [];
  private cursor: number = 0;

  private audio: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private audioReady: boolean = false;

  private isPlaying: boolean = false;
  private autoPlay: boolean = true;
  private startTime: number = 0;

  private score: number = 0;
  private combo: number = 0;
  private maxCombo: number = 0;
  private judgedCount: number = 0;
  private weightSum: number = 0;

  private judgmentLineY: number = 0;
  private fieldLeft: number = 0;
  private laneWidth: number = 0;
  /** Yüksek DPI ekranlar için ölçek (CSS pikseli -> aygıt pikseli). */
  private scale: number = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setupInput();
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    this.scale = dpr;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;

    const fieldWidth = Math.min(this.canvas.width * FIELD_WIDTH_RATIO, MAX_FIELD_WIDTH * dpr);
    this.laneWidth = fieldWidth / LANE_COUNT;
    this.fieldLeft = (this.canvas.width - fieldWidth) / 2;
    this.judgmentLineY = this.canvas.height - JUDGMENT_LINE_BOTTOM * dpr;
  }

  public setAutoPlay(value: boolean) {
    this.autoPlay = value;
  }

  public async loadLevel(chart: ParsedChart, audioSrc: string) {
    this.chart = chart;
    this.notes = chart.notes;
    this.judged = new Array(this.notes.length).fill(false);
    this.cursor = 0;

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.judgedCount = 0;
    this.weightSum = 0;
    this.updateHud();

    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }

    this.audioReady = false;
    this.audio = new Audio(encodeURI(audioSrc));
    this.audio.addEventListener('canplay', () => {
      this.audioReady = true;
    });
    this.audio.addEventListener('error', () => {
      this.audioReady = false;
      console.error(
        `Müzik yüklenemedi: ${audioSrc} (HTTP yanıtı ses değil mi? Dosya adını ve yolu kontrol edin.)`
      );
    });
    this.audio.load();

    console.log(`Loaded ${chart.notes.length} notes (${chart.bpm} BPM, ${chart.ticksPerBeat} tick/beat)`);
  }

  public start() {
    if (!this.chart) return;

    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }

    if (this.audio) {
      this.audio.currentTime = 0;
      this.audio
        .play()
        .then(() => {
          this.audioReady = true;
        })
        .catch((error) => {
          this.audioReady = false;
          console.error('Müzik çalınamadı, oyun sessiz devam ediyor:', error);
        });
    }

    this.isPlaying = true;
    this.startTime = performance.now();

    const comboContainer = document.getElementById('comboContainer');
    const comboNum = document.getElementById('comboNum');
    const judgmentText = document.getElementById('judgmentText');
    if (comboContainer) comboContainer.style.display = 'none';
    if (comboNum) comboNum.innerText = '0';
    if (judgmentText) judgmentText.innerText = '';

    document.getElementById('menu')!.style.display = 'none';
    document.getElementById('hud')!.style.display = 'flex';

    requestAnimationFrame(this.loop);
  }


  /** Şarkı zamanı (saniye). Ses hazır değilse performans saati kullanılır. */
  private getSongTime(): number {
    const offset = this.chart?.audioOffset ?? 0;
    if (this.audio && this.audioReady && !this.audio.paused) {
      return this.audio.currentTime - offset;
    }
    return (performance.now() - this.startTime) / 1000 - offset;
  }

  private setupInput() {
    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      const lane = LANE_KEYS[event.code];
      if (lane === undefined) return;
      event.preventDefault();
      if (this.isPlaying) this.triggerHit(lane);
    });

    this.canvas.addEventListener('pointerdown', (event) => {
      if (!this.isPlaying) return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const x = (event.clientX - rect.left) * scaleX;
      const lane = Math.floor((x - this.fieldLeft) / this.laneWidth);
      if (lane >= 0 && lane < LANE_COUNT) this.triggerHit(lane);
    });
  }

  private triggerHit(lane: number) {
    const songTime = this.getSongTime();
    let bestIndex = -1;
    let bestDelta = Infinity;

    for (let i = this.cursor; i < this.notes.length; i++) {
      const note = this.notes[i];
      const delta = note.time - songTime;
      if (delta > GOOD_WINDOW) break;
      if (this.judged[i] || note.lane !== lane) continue;
      if (Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) return;

    const distance = Math.abs(bestDelta);
    const judgment: Judgment =
      distance <= PERFECT_WINDOW ? 'PERFECT' : distance <= GREAT_WINDOW ? 'GREAT' : 'GOOD';
    this.judged[bestIndex] = true;
    this.registerJudgment(judgment);
    this.advanceCursor();
  }

  private registerJudgment(judgment: Judgment) {
    this.judgedCount++;
    this.weightSum += JUDGMENT_WEIGHT[judgment];

    if (judgment === 'MISS') {
      this.combo = 0;
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }

    const totalNotes = Math.max(this.notes.length, 1);
    this.score = Math.round((this.weightSum / totalNotes) * 1000000);

    this.updateHud();
    this.updateComboDisplay(judgment);
  }

  private updateComboDisplay(judgment: Judgment) {
    const container = document.getElementById('comboContainer');
    const comboNum = document.getElementById('comboNum');
    const judgmentText = document.getElementById('judgmentText');
    if (!container || !comboNum || !judgmentText) return;

    comboNum.innerText = String(this.combo);
    judgmentText.innerText = judgment;
    judgmentText.className = `judgment-text ${judgment}`;
    container.style.display = this.combo > 0 || judgment === 'MISS' ? 'block' : 'none';
  }

  private updateHud() {
    const scoreDisplay = document.getElementById('scoreDisplay');
    const accDisplay = document.getElementById('accDisplay');
    if (scoreDisplay) scoreDisplay.innerText = `SCORE: ${String(this.score).padStart(7, '0')}`;
    if (accDisplay) {
      const accuracy = this.judgedCount === 0 ? 100 : (this.weightSum / this.judgedCount) * 100;
      accDisplay.innerText = `${accuracy.toFixed(2)}%`;
    }
  }

  private advanceCursor() {
    while (this.cursor < this.notes.length && this.judged[this.cursor]) this.cursor++;
  }

  private updateMisses(songTime: number) {
    for (let i = this.cursor; i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.time > songTime + MISS_WINDOW) break;
      if (this.judged[i]) continue;
      if (note.time < songTime - MISS_WINDOW) {
        this.judged[i] = true;
        this.registerJudgment('MISS');
      }
    }
    this.advanceCursor();
  }

  private updateAutoPlay(songTime: number) {
    for (let i = this.cursor; i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.time > songTime) break;
      if (this.judged[i]) continue;
      this.judged[i] = true;
      this.registerJudgment('PERFECT');
    }
    this.advanceCursor();
  }

  private loop = () => {
    if (!this.isPlaying || !this.chart) return;

    const songTime = this.getSongTime();
    this.updateMisses(songTime);
    if (this.autoPlay) this.updateAutoPlay(songTime);
    this.render(songTime);

    const finished = this.chart.notes.length > 0 && songTime > this.chart.duration + 1.5;
    if (finished || (this.audio && this.audio.ended)) {
      this.finish();
      return;
    }

    requestAnimationFrame(this.loop);
  };

  private finish() {
    this.isPlaying = false;
    const accuracy = this.judgedCount === 0 ? 100 : (this.weightSum / this.judgedCount) * 100;
    console.log(
      `Bitti! Skor: ${this.score} | İsabet: ${accuracy.toFixed(2)}% | Max kombo: ${this.maxCombo} | Nota: ${this.judgedCount}/${this.notes.length}`
    );
    document.getElementById('menu')!.style.display = 'flex';
    document.getElementById('hud')!.style.display = 'none';
    document.getElementById('comboContainer')!.style.display = 'none';
  }


  private render(songTime: number) {
    const { ctx, canvas } = this;

    const background = ctx.createLinearGradient(0, 0, 0, canvas.height);
    background.addColorStop(0, '#10101e');
    background.addColorStop(1, '#05050a');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const laneWidth = this.laneWidth;
    const fieldWidth = laneWidth * LANE_COUNT;
    const fieldTop = 0;
    const fieldBottom = this.judgmentLineY;

    // Şerit dolgusu (ikili gruplar halinde hafif aydınlatma)
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      if (lane % 2 === 0) continue;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.fillRect(this.fieldLeft + lane * laneWidth, fieldTop, laneWidth, fieldBottom - fieldTop);
    }

    // Şerit çizgileri
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
    ctx.lineWidth = 2;
    for (let lane = 0; lane <= LANE_COUNT; lane++) {
      const x = this.fieldLeft + lane * laneWidth;
      ctx.beginPath();
      ctx.moveTo(x, fieldTop);
      ctx.lineTo(x, fieldBottom);
      ctx.stroke();
    }

    // Notalar
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.fieldLeft, fieldTop, fieldWidth, fieldBottom - fieldTop);
    ctx.clip();

    for (let i = this.cursor; i < this.notes.length; i++) {
      const note = this.notes[i];
      if (this.judged[i]) continue;

      const y = fieldBottom - (note.time - songTime) * PIXELS_PER_SECOND * this.scale;
      if (y > canvas.height + 200 * this.scale) break;
      if (y < -200 * this.scale && !note.endTime) continue;

      const x = this.fieldLeft + note.lane * laneWidth;
      const width = Math.max(laneWidth * 0.45, note.width * laneWidth);
      const color = NOTE_COLORS[note.type];

      if (note.endTime !== undefined) {
        const endY = fieldBottom - (note.endTime - songTime) * PIXELS_PER_SECOND * this.scale;
        // Skip if both head and tail are above the screen
        if (endY < -200 * this.scale) continue;
        const barTop = Math.min(y, endY);
        const barHeight = Math.abs(y - endY);
        ctx.fillStyle = 'rgba(0, 255, 102, 0.35)';
        ctx.beginPath();
        ctx.roundRect(
          x + laneWidth * 0.15,
          Math.max(fieldTop, barTop),
          Math.max(laneWidth * 0.3, width - laneWidth * 0.3),
          Math.max(barHeight - Math.max(0, fieldTop - barTop), 4 * this.scale),
          8 * this.scale
        );
        ctx.fill();
      }

      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.roundRect(
        x + 2,
        y - (NOTE_HEIGHT * this.scale) / 2,
        Math.max(width - 4, laneWidth * 0.4),
        NOTE_HEIGHT * this.scale,
        8 * this.scale
      );
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // Yargı çizgisi
    ctx.strokeStyle = '#ff007f';
    ctx.shadowColor = '#ff007f';
    ctx.shadowBlur = 18;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(this.fieldLeft, fieldBottom);
    ctx.lineTo(this.fieldLeft + fieldWidth, fieldBottom);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

