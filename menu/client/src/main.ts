import { parseSUS } from './susParser';
import { GameEngine } from './gameEngine';

/**
 * Oynatılan seviye.
 *
 * Bu pakette haritalar <şarkı>/<zorluk>/<zorluk>.txt, müzik ise <şarkı>/music/
 * altında durur. SUS dosyalarındaki #WAVE alanı boş bırakıldığı için ses
 * dosyasının adı burada tanımlıdır (yeni şarkı eklerken burayı güncelleyin).
 */
const LEVEL = {
  folder: '/levelinfo/The intense voice of hatsune miku',
  audio: 'music/初音ミクの激唱-full-初音 ミク.mp3',
};

const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert', 'master'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  const engine = new GameEngine(canvas);

  let currentDiff: Difficulty = 'expert';

  const diffButtons = document.querySelectorAll<HTMLButtonElement>('#diffGroup button');
  diffButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      diffButtons.forEach((other) => other.classList.remove('selected'));
      btn.classList.add('selected');
      currentDiff = (btn.dataset.diff as Difficulty) ?? 'expert';
      void loadSelectedDifficulty(currentDiff);
    });
  });

  const autoPlayCheckbox = document.getElementById('autoPlay') as HTMLInputElement | null;
  if (autoPlayCheckbox) {
    engine.setAutoPlay(autoPlayCheckbox.checked);
    autoPlayCheckbox.addEventListener('change', () => engine.setAutoPlay(autoPlayCheckbox.checked));
  }

  document.getElementById('startBtn')?.addEventListener('click', () => engine.start());

  async function loadSelectedDifficulty(diff: Difficulty) {
    const chartUrl = encodeURI(`${LEVEL.folder}/${diff}/${diff}.txt`);

    try {
      const response = await fetch(chartUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status} - ${chartUrl}`);

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/html')) {
        // Vite bulunamayan dosyalar için index.html döndürdüğünde SUS verisi gelmez.
        throw new Error(`Dosya bulunamadı (sunucu HTML döndürdü): ${chartUrl}`);
      }

      const chart = parseSUS(await response.text());
      console.log(
        `${diff}: ${chart.notes.length} nota, ${chart.bpm} BPM, süre ${chart.duration.toFixed(1)} sn`
      );
      if (chart.notes.length === 0) {
        console.warn(`${diff} için hiç nota bulunamadı, dosya biçimini kontrol edin.`);
      }

      const audioPath = chart.wave.trim() ? chart.wave.trim() : LEVEL.audio;
      await engine.loadLevel(chart, `${LEVEL.folder}/${audioPath}`);
    } catch (error) {
      console.error(`Zorluk yüklenemedi (${diff}):`, error);
    }
  }

  // Başlangıçta seçili zorluğu yükle
  void loadSelectedDifficulty(currentDiff);
});

