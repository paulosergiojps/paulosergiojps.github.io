---

## `app.js`

```js
/*
  Anime Music Quiz — lógica principal
  - Carrega songs.json
  - Permite importar JSON/CSV
  - Usa YouTube IFrame API para tocar trechos aleatórios
  - Gera alternativas automaticamente se não vierem no arquivo
*/

let SONGS = [];
let playable = []; // somente com videoId válido
let currentIdx = -1;
let score = 0;
let round = 0;
let snippetSec = 12;
let player, startUnlocked = false, stopTimer = null;

const els = {
  round: document.getElementById('round'),
  score: document.getElementById('score'),
  pool: document.getElementById('pool'),
  snippet: document.getElementById('snippet'),
  snippetVal: document.getElementById('snippetVal'),
  btnStart: document.getElementById('btnStart'),
  btnPlay: document.getElementById('btnPlay'),
  btnReplay: document.getElementById('btnReplay'),
  btnNext: document.getElementById('btnNext'),
  hideVideo: document.getElementById('hideVideo'),
  shuffleAll: document.getElementById('shuffleAll'),
  fileInput: document.getElementById('fileInput'),
  btnLoadSongs: document.getElementById('btnLoadSongs'),
  choices: document.getElementById('choices'),
  feedback: document.getElementById('feedback'),
  overlay: document.getElementById('overlay'),
};

// Utilidades
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shuffle = (arr) => arr.map(v=>[Math.random(), v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
const byIdFromUrl = (url='') => {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.replace('/', '');
    const v = u.searchParams.get('v');
    return v || '';
  } catch { return ''; }
};

function updateHUD() {
  els.round.textContent = `Rodada ${round}/${playable.length}`;
  els.score.textContent = `Acertos: ${score}`;
  els.pool.textContent = `Tocáveis: ${playable.length}/${SONGS.length}`;
}

function setButtonsPlayingState(isPlaying) {
  els.btnPlay.disabled = !startUnlocked || isPlaying;
  els.btnReplay.disabled = !startUnlocked || isPlaying;
  els.btnNext.disabled = !startUnlocked || isPlaying;
}

function setOverlay(show) {
  els.overlay.classList.toggle('hidden', !show);
}

// YouTube IFrame API hook global
window.onYouTubeIframeAPIReady = function() {
  player = new YT.Player('player', {
    height: '360', width: '640',
    playerVars: { controls: 0, modestbranding: 1, rel: 0, disablekb: 1, fs: 0, playsinline: 1 },
    events: {
      onReady: () => {
        els.btnStart.disabled = false;
      },
      onStateChange: (e) => {
        // 0=ended, 1=playing, 2=paused
        // Nada extra por enquanto
      }
    }
  });
};

async function init() {
  // preferir esconder vídeo
  document.body.classList.toggle('hide-video', els.hideVideo.checked);
  els.hideVideo.addEventListener('change', () => {
    document.body.classList.toggle('hide-video', els.hideVideo.checked);
  });

  // slider
  els.snippet.addEventListener('input', () => {
    snippetSec = Number(els.snippet.value);
    els.snippetVal.textContent = `${snippetSec}s`;
  });

  // start (liberar áudio)
  els.btnStart.addEventListener('click', async () => {
    startUnlocked = true;
    els.btnPlay.disabled = false;
    els.btnNext.disabled = false;
    els.btnStart.textContent = '✅ Áudio habilitado';
    els.btnStart.disabled = true;
    if (currentIdx === -1 && playable.length) nextRound();
  });

  // importar
  els.fileInput.addEventListener('change', handleImport, false);
  document.getElementById('btnExport').addEventListener('click', exportJSON);
  els.btnLoadSongs?.addEventListener('click', loadFromSongsJson);

  // botões
  els.btnPlay.addEventListener('click', () => playSnippet());
  els.btnReplay.addEventListener('click', () => replaySnippet());
  els.btnNext.addEventListener('click', () => nextRound());

  // carregar lista padrão
  const base = await fetch('songs.json').then(r => r.json()).catch(()=>[]);
  applySongs(base);
}

function normalizeSongs(arr) {
  // normaliza estrutura e gera alternativas se faltarem
  return arr.map((s, i) => {
    const pos = Number(s.position || i + 1);
    const title = String(s.title || '').trim();
    let videoId = String(s.videoId || '').trim();
    if (!videoId && s.youtubeUrl) videoId = byIdFromUrl(s.youtubeUrl);

    let choices = Array.isArray(s.choices) ? s.choices.filter(Boolean).map(String) : [];
    const correct = String(s.correct || title);

    return { position: pos, title, videoId, youtubeUrl: s.youtubeUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''), choices, correct };
  });
}

function ensureChoices(songs) {
  // se não houver escolhas, gerar a partir do pool de títulos
  const titles = songs.map(s=>s.title);
  const total = songs.length;
  for (let i=0; i<total; i++) {
    const s = songs[i];
    if (!s.title) continue;
    if (!Array.isArray(s.choices) || s.choices.length < 4) {
      // pegar 3 títulos distintos e adicionar o correto
      const pool = shuffle(titles.filter(t => t && t !== s.title)).slice(0, 3);
      s.choices = shuffle([s.title, ...pool]);
    } else {
      // garantir que o correto está presente
      if (!s.choices.includes(s.correct)) {
        s.choices = shuffle([s.correct, ...shuffle(s.choices).slice(0, Math.max(0, 3))]);
      }
    }
  }
  return songs;
}

function applySongs(arr) {
  SONGS = ensureChoices(normalizeSongs(arr));
  // filtrar somente as que têm videoId válido
  playable = SONGS.filter(s => s.videoId && /^[-_a-zA-Z0-9]{6,}$/.test(s.videoId));
  if (els.shuffleAll.checked) playable = shuffle(playable);
  currentIdx = -1; score = 0; round = 0;
  updateHUD();
  els.btnPlay.disabled = !startUnlocked;
  els.btnReplay.disabled = true;
  els.btnNext.disabled = !startUnlocked;
}

async function playSnippet(replay=false) {
  if (!startUnlocked || !playable.length) return;
  const item = playable[currentIdx];
  if (!item) return;

  clearTimeout(stopTimer);
  setButtonsPlayingState(true);
  setOverlay(true);

  // pegar duração e escolher início aleatório
  // se duração desconhecida, carrega e espera onReady interno do player
  const playNow = () => {
    try {
      const dur = Math.floor(player.getDuration?.() || 0);
      const safe = dur > (snippetSec + 2) ? dur - snippetSec - 1 : 0;
      const start = safe > 0 ? Math.floor(Math.random() * safe) + 1 : 0;
      player.loadVideoById({ videoId: item.videoId, startSeconds: start, suggestedQuality: 'small' });
      player.unMute?.();
      player.playVideo?.();

      stopTimer = setTimeout(() => {
        player.pauseVideo?.();
        setButtonsPlayingState(false);
        setOverlay(false);
      }, snippetSec * 1000);
    } catch (e) {
      console.error(e);
      setButtonsPlayingState(false);
      setOverlay(false);
    }
  };

  // Em alguns casos, o player precisa de um pequeno delay
  await sleep(100);
  playNow();
}

function replaySnippet() { playSnippet(true); }

function nextRound() {
  if (!playable.length) return;
  clearTimeout(stopTimer);
  els.feedback.textContent = '';
  els.choices.innerHTML = '';

  currentIdx = (currentIdx + 1) % playable.length;
  round = currentIdx + 1;
  updateHUD();

  const item = playable[currentIdx];
  // render alternativas
  item.choices.forEach((label) => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.textContent = label;
    btn.addEventListener('click', () => onAnswer(btn, label, item));
    els.choices.appendChild(btn);
  });

  // preparar reprodução
  els.btnReplay.disabled = false;
  els.btnPlay.disabled = !startUnlocked;
  els.btnNext.disabled = false;
}

function onAnswer(btn, label, item) {
  const correct = (label === item.correct) || (label === item.title);
  if (correct) {
    btn.classList.add('correct');
    els.feedback.textContent = '✅ Acertou!';
    score += 1;
  } else {
    btn.classList.add('wrong');
    els.feedback.textContent = `❌ Errou. Resposta: ${item.correct || item.title}`;
  }
  updateHUD();

  // desabilitar botões de escolha
  [...els.choices.children].forEach(b => b.disabled = true);
}

async function handleImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  let data = [];
  if (file.name.endsWith('.json')) {
    data = JSON.parse(text);
  } else if (file.name.endsWith('.csv')) {
    data = parseCSV(text);
  }
  applySongs(data);
}

function parseCSV(csv) {
  // CSV esperado: position,title,youtubeUrl,videoId,choices,correct
  // choices pode vir separada por | (pipe)
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const hdr = lines.shift().split(',').map(h=>h.trim());
  const idx = {
    pos: hdr.findIndex(h=>/position/i.test(h)),
    title: hdr.findIndex(h=>/title/i.test(h)),
    url: hdr.findIndex(h=>/youtubeurl|url/i.test(h)),
    vid: hdr.findIndex(h=>/videoid|id/i.test(h)),
    choices: hdr.findIndex(h=>/choices|alternativas/i.test(h)),
    correct: hdr.findIndex(h=>/correct|resposta/i.test(h)),
  };
  return lines.map((ln, i) => {
    const cols = ln.split(',');
    const c = (k) => idx[k] >= 0 ? (cols[idx[k]] || '').trim() : '';
    const title = c('title');
    const youtubeUrl = c('url');
    const videoId = c('vid') || byIdFromUrl(youtubeUrl);
    const choices = (c('choices') || '').split('|').map(s=>s.trim()).filter(Boolean);
    const correct = c('correct') || title;
    const position = Number(c('pos') || i+1);
    return { position, title, youtubeUrl, videoId, choices, correct };
  });
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(SONGS, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'songs_export.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function loadFromSongsJson() {
  fetch('songs.json?cachebust=' + Date.now())
    .then(r => r.json())
    .then(data => applySongs(data))
    .catch(() => alert('Não foi possível carregar songs.json.'));
}

// start app
init();
