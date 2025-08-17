'use strict';
/*
  Anime Music Quiz - main logic (compat)
  - Loads songs.json
  - Imports JSON/CSV
  - Uses YouTube IFrame API to play random snippets
  - Auto-generates choices if missing
*/

let SONGS = [];
let playable = []; // only with valid videoId
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

// utils
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
function shuffle(arr){ return arr.map(function(v){return [Math.random(), v];}).sort(function(a,b){return a[0]-b[0];}).map(function(x){return x[1];}); }
function byIdFromUrl(url){
  if (!url) return '';
  try {
    var u = new URL(url);
    if (u.hostname.indexOf('youtu.be') !== -1) return u.pathname.replace('/', '');
    var v = u.searchParams.get('v');
    return v || '';
  } catch(e){ return ''; }
}

function updateHUD(){
  els.round.textContent = 'Rodada ' + round + '/' + playable.length;
  els.score.textContent = 'Acertos: ' + score;
  els.pool.textContent = 'Tocáveis: ' + playable.length + '/' + SONGS.length;
}

function setButtonsPlayingState(isPlaying){
  els.btnPlay.disabled = !startUnlocked || isPlaying;
  els.btnReplay.disabled = !startUnlocked || isPlaying;
  els.btnNext.disabled = !startUnlocked || isPlaying;
}

function setOverlay(show){
  if (!els.overlay) return;
  if (show) els.overlay.classList.remove('hidden'); else els.overlay.classList.add('hidden');
}

// YouTube IFrame API hook (global)
window.onYouTubeIframeAPIReady = function(){
  player = new YT.Player('player', {
    height: '360', width: '640',
    playerVars: { controls: 0, modestbranding: 1, rel: 0, disablekb: 1, fs: 0, playsinline: 1 },
    events: {
      onReady: function(){
        els.btnStart.disabled = false;
      },
      onStateChange: function(e){ /* noop */ }
    }
  });
};

async function init(){
  // hide video by default
  if (els.hideVideo) {
    document.body.classList.toggle('hide-video', !!els.hideVideo.checked);
    els.hideVideo.addEventListener('change', function(){
      document.body.classList.toggle('hide-video', !!els.hideVideo.checked);
    });
  }

  // slider
  els.snippet.addEventListener('input', function(){
    snippetSec = Number(els.snippet.value);
    els.snippetVal.textContent = snippetSec + 's';
  });

  // start (unlock audio)
  els.btnStart.addEventListener('click', async function(){
    startUnlocked = true;
    els.btnPlay.disabled = false;
    els.btnNext.disabled = false;
    els.btnStart.textContent = 'Audio habilitado';
    els.btnStart.disabled = true;
    if (currentIdx === -1 && playable.length) nextRound();
  });

  // import
  els.fileInput.addEventListener('change', handleImport, false);
  document.getElementById('btnExport').addEventListener('click', exportJSON);
  if (els.btnLoadSongs) els.btnLoadSongs.addEventListener('click', loadFromSongsJson);

  // buttons
  els.btnPlay.addEventListener('click', function(){ playSnippet(); });
  els.btnReplay.addEventListener('click', function(){ replaySnippet(); });
  els.btnNext.addEventListener('click', function(){ nextRound(); });

  // load default list
  try {
    const base = await fetch('songs.json?_=' + Date.now()).then(function(r){return r.json();});
    applySongs(base);
  } catch(e){
    console.warn('songs.json not found or invalid, starting with empty list');
    applySongs([]);
  }
}

function normalizeSongs(arr){
  return (arr || []).map(function(s, i){
    const pos = Number(s.position || i + 1);
    const title = String(s.title || '').trim();
    let videoId = String(s.videoId || '').trim();
    if (!videoId && s.youtubeUrl) videoId = byIdFromUrl(s.youtubeUrl);

    let choices = Array.isArray(s.choices) ? s.choices.filter(Boolean).map(String) : [];
    const correct = String(s.correct || title);

    return { position: pos, title: title, videoId: videoId, youtubeUrl: s.youtubeUrl || (videoId ? ('https://www.youtube.com/watch?v=' + videoId) : ''), choices: choices, correct: correct };
  });
}

function ensureChoices(songs){
  const titles = songs.map(function(s){ return s.title; });
  const total = songs.length;
  for (let i=0; i<total; i++){
    const s = songs[i];
    if (!s.title) continue;
    if (!Array.isArray(s.choices) || s.choices.length < 4){
      const pool = shuffle(titles.filter(function(t){ return t && t !== s.title; })).slice(0, 3);
      s.choices = shuffle([s.title].concat(pool));
    } else {
      if (s.correct && s.choices.indexOf(s.correct) === -1){
        s.choices = shuffle([s.correct].concat(shuffle(s.choices).slice(0, Math.max(0, 3))));
      }
    }
  }
  return songs;
}

function applySongs(arr){
  SONGS = ensureChoices(normalizeSongs(arr));
  // only with plausible YouTube IDs
  playable = SONGS.filter(function(s){ return s.videoId && /^[-_a-zA-Z0-9]{6,}$/.test(s.videoId); });
  if (els.shuffleAll && els.shuffleAll.checked) playable = shuffle(playable);
  currentIdx = -1; score = 0; round = 0;
  updateHUD();
  els.btnPlay.disabled = !startUnlocked;
  els.btnReplay.disabled = true;
  els.btnNext.disabled = !startUnlocked;
}

async function playSnippet(){
  if (!startUnlocked || !playable.length) return;
  const item = playable[currentIdx];
  if (!item || !player || !player.loadVideoById) return;

  clearTimeout(stopTimer);
  setButtonsPlayingState(true);
  setOverlay(true);

  const playNow = function(){
    try {
      const dur = (player && typeof player.getDuration === 'function') ? Math.floor(player.getDuration() || 0) : 0;
      const safe = dur > (snippetSec + 2) ? dur - snippetSec - 1 : 0;
      const start = safe > 0 ? Math.floor(Math.random() * safe) + 1 : 0;
      player.loadVideoById({ videoId: item.videoId, startSeconds: start, suggestedQuality: 'small' });
      if (player.unMute) player.unMute();
      if (player.playVideo) player.playVideo();

      stopTimer = setTimeout(function(){
        if (player.pauseVideo) player.pauseVideo();
        setButtonsPlayingState(false);
        setOverlay(false);
      }, snippetSec * 1000);
    } catch (e) {
      console.error(e);
      setButtonsPlayingState(false);
      setOverlay(false);
    }
  };

  await sleep(100);
  playNow();
}

function replaySnippet(){ playSnippet(); }

function nextRound(){
  if (!playable.length) return;
  clearTimeout(stopTimer);
  els.feedback.textContent = '';
  els.choices.innerHTML = '';

  currentIdx = (currentIdx + 1) % playable.length;
  round = currentIdx + 1;
  updateHUD();

  const item = playable[currentIdx];
  (item.choices || []).forEach(function(label){
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.textContent = label;
    btn.addEventListener('click', function(){ onAnswer(btn, label, item); });
    els.choices.appendChild(btn);
  });

  els.btnReplay.disabled = false;
  els.btnPlay.disabled = !startUnlocked;
  els.btnNext.disabled = false;
}

function onAnswer(btn, label, item){
  const isCorrect = (label === (item.correct || '')) || (label === (item.title || ''));
  if (isCorrect){
    btn.classList.add('correct');
    els.feedback.textContent = 'Acertou!';
    score += 1;
  } else {
    btn.classList.add('wrong');
    els.feedback.textContent = 'Errado. Resposta: ' + (item.correct || item.title || '');
  }
  updateHUD();

  Array.prototype.forEach.call(els.choices.children, function(b){ b.disabled = true; });
}

async function handleImport(e){
  const file = (e.target && e.target.files && e.target.files[0]) ? e.target.files[0] : null;
  if (!file) return;
  const text = await file.text();
  let data = [];
  if (file.name.toLowerCase().endsWith('.json')){
    data = JSON.parse(text);
  } else if (file.name.toLowerCase().endsWith('.csv')){
    data = parseCSV(text);
  }
  applySongs(data);
}

function parseCSV(csv){
  const lines = csv.split(/
?
/).filter(Boolean);
  if (!lines.length) return [];
  const hdr = lines.shift().split(',').map(function(h){ return h.trim(); });
  const idx = {
    pos: hdr.findIndex(function(h){return /position/i.test(h);}),
    title: hdr.findIndex(function(h){return /title/i.test(h);}),
    url: hdr.findIndex(function(h){return /youtubeurl|url/i.test(h);}),
    vid: hdr.findIndex(function(h){return /videoid|id/i.test(h);}),
    choices: hdr.findIndex(function(h){return /choices|alternativas/i.test(h);}),
    correct: hdr.findIndex(function(h){return /correct|resposta/i.test(h);}),
  };
  return lines.map(function(ln, i){
    const cols = ln.split(',');
    const c = function(k){ return idx[k] >= 0 ? (cols[idx[k]] || '').trim() : ''; };
    const title = c('title');
    const youtubeUrl = c('url');
    const videoId = c('vid') || byIdFromUrl(youtubeUrl);
    const choices = (c('choices') || '').split('|').map(function(s){return s.trim();}).filter(Boolean);
    const correct = c('correct') || title;
    const position = Number(c('pos') || i+1);
    return { position: position, title: title, youtubeUrl: youtubeUrl, videoId: videoId, choices: choices, correct: correct };
  });
}

function exportJSON(){
  const blob = new Blob([JSON.stringify(SONGS, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'songs_export.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function loadFromSongsJson(){
  fetch('songs.json?_=' + Date.now())
    .then(function(r){ return r.json(); })
    .then(function(data){ applySongs(data); })
    .catch(function(){ alert('Não foi possível carregar songs.json.'); });
}

// start app
init();
