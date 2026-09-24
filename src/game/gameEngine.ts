import { ComboEvent, FlickDirection, GuideNote, Note, ParsedChart, LANE_COUNT } from './susParser';

type Judgment = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

/** Vuruş pencereleri (saniye). */
const PERFECT_WINDOW = 0.06;
const GREAT_WINDOW = 0.12;
const GOOD_WINDOW = 0.18;
const MISS_WINDOW = 0.2;
/**
 * Bırakma toleransı: slide gövdesi bu kadar saniye içinde bırakılırsa
 * tutma kaybedilmez (oyundaki "grace" davranışı).
 */
const RELEASE_GRACE = 0.08;

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
  trace: '#7fd0ff',
  flick: '#00f0ff',
  hold: '#00ff66',
  slide: '#2bffb0',
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
  /**
   * Tüm combo olayları (tekiller + slide start/relay/continuation/end).
   * Referans `combo_events()` ile birebir aynı sırada ve içeriktedir.
   */
  private events: ComboEvent[] = [];
  /** Çözülmüş combo olaylarının bayrakları. */
  private eventJudged: boolean[] = [];
  /** İlk çözülmemiş combo olayının indeksi (kuyruk imleci). */
  private eventCursor: number = 0;
  /** Kanal 9 guide varlıkları (görsel, puanlanmaz). */
  private guides: GuideNote[] = [];
  /**
   * Aktif tutmalar: nota indeksi -> { hit, broken, releasedAt }.
   * Slide gövdesi boyunca tuş basılı tutulmalıdır.
   */
  private holds = new Map<number, { hit: boolean; broken: boolean; releasedAt: number | null }>();
  /** Fiziksel olarak basılı tutulan tuşlar (lane indeksi). */
  private heldLanes = new Set<number>();
  /** Fare/dokunma ile basılı tutulan şerit (aynı anda tek lane). */
  private pointerHeldLane: number | null = null;
  /** Nota kayma hızı çarpanı — yalnızca görsel; yargılama ses saatine bağlıdır. */
  private noteSpeed: number = 1;

  private judgmentLineY: number = 0;
  private fieldLeft: number = 0;
  private laneWidth: number = 0;
  /** Yüksek DPI ekranlar için ölçek (CSS pikseli -> aygıt pikseli). */
  private scale: number = 1;
  private rafId: number | null = null;

  /** Oyun bittiğinde sonucu dışarı bildirir (React tarafı sonuç ekranını gösterir). */
  public onFinish?: (result: { score: number; accuracy: number; maxCombo: number; totalNotes: number }) => void;

  private handleResize = () => this.resize();

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    const lane = LANE_KEYS[event.code] as number | undefined;
    if (lane === undefined) return;
    event.preventDefault();
    this.heldLanes.add(lane);
    if (this.isPlaying) this.triggerHit(lane);
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    const lane = LANE_KEYS[event.code] as number | undefined;
    if (lane === undefined) return;
    event.preventDefault();
    this.heldLanes.delete(lane);
    this.onRelease();
  };

  /** Pencere odağını kaybedince basılı tuşlar "bırakılmış" sayılır. */
  private handleBlur = () => {
    this.heldLanes.clear();
    this.pointerHeldLane = null;
    this.onRelease();
  };

  private laneFromPointer(event: PointerEvent): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const x = (event.clientX - rect.left) * scaleX;
    const lane = Math.floor((x - this.fieldLeft) / this.laneWidth);
    return lane >= 0 && lane < LANE_COUNT ? lane : null;
  }

  private handlePointerDown = (event: PointerEvent) => {
    const lane = this.laneFromPointer(event);
    if (lane === null) return;
    this.pointerHeldLane = lane;
    this.heldLanes.add(lane);
    if (this.isPlaying) this.triggerHit(lane);
  };

  private handlePointerUp = () => {
    if (this.pointerHeldLane !== null) this.heldLanes.delete(this.pointerHeldLane);
    this.pointerHeldLane = null;
    this.onRelease();
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.handleResize);
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

  /** Görsel kayma hızı çarpanı (0.25x - 4x). Combo/yargılama etkilenmez. */
  public setNoteSpeed(value: number) {
    this.noteSpeed = Math.min(Math.max(value, 0.25), 4);
  }

  public async loadLevel(chart: ParsedChart, audioSrc: string) {
    this.chart = chart;
    this.notes = chart.notes;
    this.guides = chart.guides ?? [];
    this.judged = new Array(this.notes.length).fill(false);
    this.cursor = 0;

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.judgedCount = 0;
    this.weightSum = 0;
    this.events = chart.comboEvents ?? [];
    this.eventJudged = new Array(this.events.length).fill(false);
    this.eventCursor = 0;
    this.holds.clear();
    this.heldLanes.clear();
    this.pointerHeldLane = null;
    this.notes.forEach((note, index) => {
      if (note.type === 'slide') this.holds.set(index, { hit: false, broken: false, releasedAt: null });
    });
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

    const menu = document.getElementById('menu');
    if (menu) menu.style.display = 'none';
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'flex';

    this.rafId = requestAnimationFrame(this.loop);
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
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
  }

  /**
   * Bir tuş bırakıldığında, gövdesi henüz bitmemiş ve basılı tutulmayan
   * hiçbir slide yoksa o tutmalar kırılır (combo bozulur).
   */
  private onRelease() {
    if (!this.isPlaying) return;
    if (this.autoPlay) return;
    if (this.heldLanes.size > 0) return;
    const songTime = this.getSongTime();
    for (const [index, hold] of this.holds) {
      if (hold.broken || hold.releasedAt !== null) continue;
      const note = this.notes[index];
      if (!note || note.endTime === undefined) continue;
      // Bitişten RELEASE_GRACE kadar önce bırakıldıysa tutma kaybedilir
      if (songTime >= note.endTime - RELEASE_GRACE) continue;
      hold.releasedAt = songTime;
      hold.broken = true;
    }
  }

  /** Belirli bir lane basılı mı (fare + klavye birlikte). */
  private isLaneHeld(lane: number): boolean {
    return this.heldLanes.has(lane);
  }

  private triggerHit(lane: number) {
    const songTime = this.getSongTime();
    let bestEvent = -1;
    let bestDelta = Infinity;

    // Giriş gerektiren combo olaylarında en yakın eşleşme aranır
    for (let i = this.eventCursor; i < this.events.length; i++) {
      const event = this.events[i];
      if (event.time > songTime + GOOD_WINDOW) break;
      if (!event.input || this.eventJudged[i]) continue;
      const note = this.notes[event.noteIndex];
      if (!note) continue;
      // Slide end/baş vuruşları: ilgili lane'e (veya gövde şeritlerine) basılmalı
      const matches =
        note.lane === lane ||
        (note.type === 'slide' && (note.endLane === lane || this.laneTouchesSlide(note, lane)));
      if (!matches) continue;
      const delta = event.time - songTime;
      if (Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta;
        bestEvent = i;
      }
    }

    if (bestEvent < 0) return;

    const event = this.events[bestEvent];
    const distance = Math.abs(bestDelta);
    const judgment: Judgment =
      distance <= PERFECT_WINDOW ? 'PERFECT' : distance <= GREAT_WINDOW ? 'GREAT' : 'GOOD';
    this.eventJudged[bestEvent] = true;
    this.judged[event.noteIndex] = true;
    if (event.kind === 'start') {
      // Slide tutması başladı: gövde boyunca lane basılı tutulmalı
      const hold = this.holds.get(event.noteIndex);
      if (hold) {
        hold.hit = true;
        hold.broken = false;
        hold.releasedAt = null;
      }
    }
    this.registerJudgment(judgment);
    this.advanceCursor(songTime);
  }

  /** Verilen lane, slide gövdesinin geçtiği şerit aralığına değiyor mu. */
  private laneTouchesSlide(note: Note, lane: number): boolean {
    if (!note.points || note.points.length === 0) return false;
    for (const point of note.points) {
      if (point.lane === lane) return true;
    }
    return false;
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

    const totalNotes = Math.max(this.events.length || this.notes.length, 1);
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

  private advanceCursor(songTime: number) {
    while (this.cursor < this.notes.length) {
      const note = this.notes[this.cursor];
      // Uzun notalar (hold/slide) kuyruğu çizgiyi geçene kadar aktif kalır;
      // böylece başları vurulduktan sonra gövdeleri kaybolmaz.
      const finished = this.judged[this.cursor] && (note.endTime === undefined || note.endTime <= songTime);
      if (!finished) break;
      this.cursor++;
    }
  }

  private updateMisses(songTime: number) {
    for (let i = this.eventCursor; i < this.events.length; i++) {
      const event = this.events[i];
      if (event.time > songTime + MISS_WINDOW) break;
      if (this.eventJudged[i]) continue;
      if (event.time < songTime - MISS_WINDOW) {
        this.eventJudged[i] = true;
        this.judged[event.noteIndex] = true;
        // Bırakılmış slide gövdesi: kalan iç olaylar da kaçırılmış sayılır
        if (event.hold) this.breakHold(event.noteIndex, songTime);
        this.registerJudgment('MISS');
      }
    }
    this.advanceEventCursor();
    this.advanceCursor(songTime);
  }

  /** Bir slide tutması kırıldıysa gövdesi kalan iç olaylar kaçırılmış işaretlenir. */
  private breakHold(noteIndex: number, songTime: number) {
    const hold = this.holds.get(noteIndex);
    if (hold && !hold.broken) {
      hold.broken = true;
      hold.releasedAt = songTime;
    }
  }

  private advanceEventCursor() {
    while (this.eventCursor < this.events.length && this.eventJudged[this.eventCursor]) {
      this.eventCursor++;
    }
  }

  private updateAutoPlay(songTime: number) {
    for (let i = this.eventCursor; i < this.events.length; i++) {
      const event = this.events[i];
      if (event.time > songTime) break;
      if (this.eventJudged[i]) continue;
      this.eventJudged[i] = true;
      this.judged[event.noteIndex] = true;
      if (event.kind === 'start') {
        const hold = this.holds.get(event.noteIndex);
        if (hold) {
          hold.hit = true;
          hold.broken = false;
        }
      }
      this.registerJudgment('PERFECT');
    }
    this.advanceEventCursor();
    this.advanceCursor(songTime);
  }

  /**
   * Slide gövdesi boyunca tutma denetimi.
   * Gövde aktifken ilgili lane'lerden en az biri basılı olmalıdır; aksi halde
   * "relay" ve "continuation" combo olayları kaçırılmış (MISS) sayılır.
   */
  private processHolds(songTime: number) {
    if (this.autoPlay) return;
    for (let i = this.eventCursor; i < this.events.length; i++) {
      const event = this.events[i];
      if (event.time > songTime) break;
      if (this.eventJudged[i] || !event.hold) continue;

      const note = this.notes[event.noteIndex];
      if (!note || note.type !== 'slide') continue;
      const hold = this.holds.get(event.noteIndex);
      if (!hold || hold.broken) {
        // Tutma zaten kırılmışsa bu iç olay da kaçırılmıştır
        this.eventJudged[i] = true;
        this.registerJudgment('MISS');
        continue;
      }
      // Baş vuruşu hiç yapılmadıysa gövde combo üretemez
      if (!hold.hit) {
        this.eventJudged[i] = true;
        this.breakHold(event.noteIndex, songTime);
        this.registerJudgment('MISS');
        continue;
      }
      // Gövde bu anda aktifse lane basılı mı kontrol et
      if (songTime >= note.time && songTime <= (note.endTime ?? note.time) + RELEASE_GRACE) {
        if (!this.anySlideLaneHeld(note)) {
          this.eventJudged[i] = true;
          this.breakHold(event.noteIndex, songTime);
          this.registerJudgment('MISS');
          continue;
        }
      }
      // Lane basılıysa veya gövde henüz başlamadıysa otomatik PERFECT
      this.eventJudged[i] = true;
      this.registerJudgment('PERFECT');
    }
    this.advanceEventCursor();
  }

  /** Slide gövdesinin geçtiği lane'lerden herhangi biri basılı mı. */
  private anySlideLaneHeld(note: Note): boolean {
    if (!note.points || note.points.length === 0) return this.isLaneHeld(note.lane);
    for (const point of note.points) {
      if (this.isLaneHeld(point.lane)) return true;
    }
    return false;
  }

  private loop = () => {
    if (!this.isPlaying || !this.chart) return;

    const songTime = this.getSongTime();
    this.updateMisses(songTime);
    if (this.autoPlay) this.updateAutoPlay(songTime);
    else this.processHolds(songTime);
    this.render(songTime);

    const finished = this.chart.notes.length > 0 && songTime > this.chart.duration + 1.5;
    if (finished || (this.audio && this.audio.ended)) {
      this.finish();
      return;
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private finish() {
    this.isPlaying = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    const accuracy = this.judgedCount === 0 ? 100 : (this.weightSum / this.judgedCount) * 100;
    const comboTotal = Math.max(this.events.length || this.notes.length, 1);
    console.log(
      `Bitti! Skor: ${this.score} | İsabet: ${accuracy.toFixed(2)}% | Max kombo: ${this.maxCombo} | Nota: ${this.judgedCount}/${comboTotal}`
    );
    const menu = document.getElementById('menu');
    if (menu) menu.style.display = 'flex';
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'none';
    const combo = document.getElementById('comboContainer');
    if (combo) combo.style.display = 'none';
    this.onFinish?.({
      score: this.score,
      accuracy,
      maxCombo: this.maxCombo,
      totalNotes: comboTotal,
    });
  }


  /** Oyun ekranından çıkılırken dinleyicileri ve sesi temizler. */
  public destroy() {
    this.isPlaying = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
    this.chart = null;
    this.notes = [];
    this.judged = [];
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

    // Kanal 9 guide varlıkları: görsel rehber çizgileri (puanlanmaz)
    for (const guide of this.guides) {
      if (guide.points.length < 2) continue;
      const alpha = guide.critical ? 0.16 : 0.11;
      ctx.strokeStyle = guide.critical ? `rgba(255, 230, 0, ${alpha})` : `rgba(0, 255, 102, ${alpha})`;
      ctx.lineWidth = Math.max(laneWidth * 0.22, 4 * this.scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      guide.points.forEach((point, index) => {
        const y = fieldBottom - (point.time - songTime) * PIXELS_PER_SECOND * this.noteSpeed * this.scale;
        const x = this.fieldLeft + point.lane * laneWidth + laneWidth / 2;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Guide uçlarında küçük işaretler
      ctx.fillStyle = guide.critical ? 'rgba(255, 230, 0, 0.5)' : 'rgba(0, 255, 102, 0.5)';
      for (const point of [guide.points[0], guide.points[guide.points.length - 1]]) {
        const y = fieldBottom - (point.time - songTime) * PIXELS_PER_SECOND * this.noteSpeed * this.scale;
        if (y < -40 * this.scale || y > canvas.height + 40 * this.scale) continue;
        const x = this.fieldLeft + point.lane * laneWidth + laneWidth / 2;
        const r = Math.max(laneWidth * 0.1, 3 * this.scale);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Notalar
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.fieldLeft, fieldTop, fieldWidth, fieldBottom - fieldTop);
    ctx.clip();

    for (let i = this.cursor; i < this.notes.length; i++) {
      const note = this.notes[i];
      const isLong = note.endTime !== undefined;
      // Vurulmuş kısa notalar kaybolur; uzun notaların gövdesi kuyruk çizgiyi geçene kadar görünür kalır.
      if (this.judged[i] && !isLong) continue;

      const y = fieldBottom - (note.time - songTime) * PIXELS_PER_SECOND * this.noteSpeed * this.scale;
      const endY = note.endTime !== undefined
        ? fieldBottom - (note.endTime - songTime) * PIXELS_PER_SECOND * this.noteSpeed * this.scale
        : y;
      // Baş ve (varsa) kuyruk birlikte ekranın altına indiyse sonraki notalar da ekran dışındadır.
      if (Math.min(y, endY) > canvas.height + 200 * this.scale) break;
      // Uzun notanın kuyruğu ekranın üstüne çıktıysa artık çizme.
      if (isLong && endY < -200 * this.scale) continue;
      // Kısa nota ekranın üstüne çıktıysa çizme.
      if (!isLong && y < -200 * this.scale) continue;

      const x = this.fieldLeft + note.lane * laneWidth;
      const width = Math.max(laneWidth * 0.45, note.width * laneWidth);
      const color = NOTE_COLORS[note.type];

      if (note.endTime !== undefined) {
        // Slide gövdesi: gerçek gövde noktaları (shape step'leri dahil) boyunca çizilir
        const endLane = note.endLane ?? note.lane;
        const bodyW = Math.max(laneWidth * 0.3, width - laneWidth * 0.3);
        const headX = this.fieldLeft + note.lane * laneWidth + laneWidth / 2;
        const tailX = this.fieldLeft + endLane * laneWidth + laneWidth / 2;
        const hold = this.holds.get(i);
        const broken = hold?.broken === true;
        const active = hold?.hit === true && !broken;
        const bodyAlpha = broken ? 0.18 : active ? 0.62 : this.judged[i] ? 0.5 : 0.32;

        const bodyPath: Array<{ lane: number; time?: number }> =
          note.points && note.points.length >= 2
            ? note.points
            : [{ lane: note.lane }, { lane: endLane }];
        const pointX = (lane: number) => this.fieldLeft + lane * laneWidth + laneWidth / 2;
        const pointY = (time: number) =>
          fieldBottom - (time - songTime) * PIXELS_PER_SECOND * this.noteSpeed * this.scale;

        ctx.beginPath();
        bodyPath.forEach((point, index) => {
          const px = pointX(point.lane);
          // points dizisinde zaman her zaman tanımlıdır; yedek yol için baş/son kullanılır
          const py = point.time !== undefined ? pointY(point.time) : index === 0 ? y : endY;
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        // İnce gövde çizgisi (düz interpolasyon yerine gerçek şekil)
        ctx.strokeStyle = broken
          ? 'rgba(255, 77, 77, 0.55)'
          : note.type === 'slide'
            ? `rgba(43, 255, 176, ${bodyAlpha})`
            : `rgba(0, 255, 102, ${bodyAlpha + 0.03})`;
        ctx.lineWidth = bodyW;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.strokeStyle = broken
          ? 'rgba(255, 140, 140, 0.6)'
          : note.type === 'slide'
            ? 'rgba(180, 255, 235, 0.55)'
            : 'rgba(186, 255, 205, 0.55)';
        ctx.lineWidth = 1.5 * this.scale;
        ctx.stroke();

        // Gövde üzerindeki görünür tikler (tip 3) ve combo üreten relay noktaları
        if (note.points && note.points.length > 0) {
          ctx.fillStyle = 'rgba(220, 255, 238, 0.92)';
          for (const point of note.points) {
            if (point.kind !== 'tick' && point.kind !== 'attach') continue;
            const tickX = this.fieldLeft + point.lane * laneWidth + laneWidth / 2;
            const tickY = fieldBottom - (point.time - songTime) * PIXELS_PER_SECOND * this.noteSpeed * this.scale;
            ctx.beginPath();
            ctx.roundRect(tickX - bodyW / 2, tickY - 3 * this.scale, bodyW, 6 * this.scale, 3 * this.scale);
            ctx.fill();
          }
        }

        // Bitiş kapağı (uç flick yönü varsa ok ile)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.roundRect(
          tailX - bodyW / 2,
          endY - (NOTE_HEIGHT * this.scale * 0.7) / 2,
          bodyW,
          NOTE_HEIGHT * this.scale * 0.7,
          6 * this.scale
        );
        ctx.fill();
        if (note.endDirection) {
          this.drawNoteMarker(note.type, tailX, endY, bodyW, NOTE_HEIGHT * this.scale, note.endDirection, note.critical);
        }
      }

      if (!this.judged[i]) {
        const isFlick = note.direction !== undefined || note.type === 'flick';
        const heightFactor = isFlick ? 1.25 : note.type === 'critical' ? 1.15 : note.type === 'damage' ? 1.1 : 1;
        const noteHeight = NOTE_HEIGHT * heightFactor * this.scale;
        const barX = x + 2;
        const barW = Math.max(width - 4, laneWidth * 0.4);
        const strongGlow = note.type === 'critical' || isFlick || note.type === 'damage';
        const isTrace = note.type === 'trace';

        ctx.globalAlpha = isTrace ? 0.62 : 1;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = strongGlow ? 22 : 14;
        ctx.beginPath();
        ctx.roundRect(barX, y - noteHeight / 2, barW, noteHeight, 8 * this.scale);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;

        // İnce kenar (trace için kesikli): notayı arka plandan ayırır.
        ctx.strokeStyle = isTrace ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5 * this.scale;
        if (isTrace) ctx.setLineDash([6 * this.scale, 4 * this.scale]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Tip işareti: flick yön oku, critical çekirdeği, damage X'i, hold çizgisi, slide elması.
        this.drawNoteMarker(
          note.type,
          barX + barW / 2,
          y,
          barW,
          noteHeight,
          note.direction ?? (note.type === 'flick' ? 'up' : undefined),
          note.critical
        );
      }
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

  /** Nota tipini ayırt edilebilir kılan başlık işaretleri (flick yön okları, critical çekirdeği, vb.). */
  private drawNoteMarker(
    type: Note['type'],
    cx: number,
    cy: number,
    barWidth: number,
    barHeight: number,
    direction?: FlickDirection,
    critical?: boolean
  ) {
    const ctx = this.ctx;
    const scale = this.scale;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const flickDir = direction ?? (type === 'flick' ? 'up' : undefined);
    if (flickDir) {
      // Flick: yöne bakan çift şevron (yukarı / sol / sağ)
      if (flickDir === 'left' || flickDir === 'right') {
        ctx.translate(cx, cy);
        ctx.rotate(flickDir === 'right' ? Math.PI / 2 : -Math.PI / 2);
        ctx.translate(-cx, -cy);
      }
      const halfW = Math.min(barWidth * 0.22, 16 * scale);
      const step = barHeight * 0.3;
      ctx.strokeStyle = 'rgba(6, 22, 32, 0.9)';
      ctx.lineWidth = 3 * scale;
      for (let k = 0; k < 2; k++) {
        const top = cy - step + k * step;
        ctx.beginPath();
        ctx.moveTo(cx - halfW, top + step * 0.75);
        ctx.lineTo(cx, top);
        ctx.lineTo(cx + halfW, top + step * 0.75);
        ctx.stroke();
      }
    }

    if (type === 'critical' || critical) {
      // Parlak çekirdek şeridi
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.beginPath();
      ctx.roundRect(cx - barWidth * 0.22, cy - barHeight * 0.16, barWidth * 0.44, barHeight * 0.32, 3 * scale);
      ctx.fill();
    }

    if (type === 'damage') {
      // Çapraz uyarı işareti
      const arm = Math.min(barWidth * 0.12, 9 * scale);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 2.5 * scale;
      ctx.beginPath();
      ctx.moveTo(cx - arm, cy - arm);
      ctx.lineTo(cx + arm, cy + arm);
      ctx.moveTo(cx + arm, cy - arm);
      ctx.lineTo(cx - arm, cy + arm);
      ctx.stroke();
    }

    if (type === 'hold') {
      // Tutma başlığı: yatay çizgi
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2.5 * scale;
      ctx.beginPath();
      ctx.moveTo(cx - barWidth * 0.28, cy);
      ctx.lineTo(cx + barWidth * 0.28, cy);
      ctx.stroke();
    }

    if (type === 'slide' && !flickDir) {
      // Kaydırma başlığı: elmas
      const size = Math.min(barWidth * 0.14, 8 * scale);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx + size, cy);
      ctx.lineTo(cx, cy + size);
      ctx.lineTo(cx - size, cy);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}

