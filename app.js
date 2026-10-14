'use strict';
/* Moodlog — 감각 기록 무드보드 (로컬 저장 · 파일/이미지로 공유) */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const view = $('#view');

const TAGS = ['색상', '폰트', '간격', '레이아웃', '이미지', '패키지', '로고', 'UI', '공간'];
const CUES = ['대비', '여백', '정렬', '위계', '리듬·반복', '톤 통일', '포인트 컬러', '질감', '비율', '빛·그림자', '서체 조합', '절제'];
const PROMPTS = [
  '가장 먼저 시선이 간 곳은 어디였고, 왜 그곳이었을까요?',
  '몇 가지 색으로 이루어져 있나요? 그중 포인트는 무엇인가요?',
  '비어 있는 공간(여백)이 어떤 역할을 하고 있나요?',
  '하나를 빼면 무너질 것 같은 요소는 무엇인가요?',
  '내 작업에 바로 가져다 쓸 수 있는 한 가지는?',
  '글자 크기·굵기 차이가 얼마나 나나요? 그게 어떤 느낌을 주나요?',
  '반대로 하면(색을 더 넣으면, 여백을 줄이면) 어떻게 될까요?',
  '이걸 한 단어 형용사로 말한다면? 그 느낌은 어디서 오나요?'
];
const PAPER = '#F4F1EA', INK = '#161513', MUTED = '#7A746B', ACCENT = '#D9481F';
const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const SERIF = '"Instrument Serif", Georgia, serif';
const APP_URL = location.origin + location.pathname;

/* ---------------- storage (IndexedDB) ---------------- */
const DB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('moodlog', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('entries', { keyPath: 'id' });
      d.createObjectStore('boards', { keyPath: 'id' });
      d.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (st, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(st, mode);
      const q = fn(t.objectStore(st));
      t.oncomplete = () => res(q.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  };
  return {
    all: s => run(s, 'readonly', o => o.getAll()),
    get: (s, k) => run(s, 'readonly', o => o.get(k)),
    put: (s, v, k) => run(s, 'readwrite', o => (k === undefined ? o.put(v) : o.put(v, k))),
    del: (s, k) => run(s, 'readwrite', o => o.delete(k))
  };
})();

let myName = '';
let boardFilter = '전체';

/* ---------------- small utils ---------------- */
let toastT;
function toast(m) {
  const t = $('#toast');
  t.textContent = m; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1900);
}
const pad = n => String(n).padStart(2, '0');
const fmtDate = t => { const d = new Date(t); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB';

const urls = new Map();
function blobURL(key, blob) {
  if (!blob) return '';
  let u = urls.get(key);
  if (!u) { u = URL.createObjectURL(blob); urls.set(key, u); }
  return u;
}
function dropURLs(prefix) {
  for (const [k, u] of urls) if (k.startsWith(prefix)) { URL.revokeObjectURL(u); urls.delete(k); }
}
const imgKey = (e, b = 'me') => `${b}:${e.id}:${e.updatedAt || e.createdAt}`;

/* ---------------- color ---------------- */
const hex2rgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
const rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = h => {
  const c = hex2rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const inkOn = h => contrast(h, '#FFFFFF') >= contrast(h, INK) ? '#FFFFFF' : INK;
function hsl(h) {
  const [r, g, b] = hex2rgb(h).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  let H = 0;
  if (d) H = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(H * 60 + 360) % 360, s, l];
}
function sortColors(list) {
  return [...list].sort((a, b) => {
    const A = hsl(a), B = hsl(b), ga = A[1] < 0.12, gb = B[1] < 0.12;
    if (ga !== gb) return ga ? 1 : -1;
    if (ga) return B[2] - A[2];
    return A[0] - B[0] || B[2] - A[2];
  });
}

/* ---------------- images ---------------- */
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
async function blobToImg(blob) {
  const u = URL.createObjectURL(blob);
  try { return await loadImg(u); } finally { setTimeout(() => URL.revokeObjectURL(u), 0); }
}
async function resizeBlob(blob, max = 1600, q = 0.86) {
  const img = await blobToImg(blob);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', q));
}
function extractPalette(img, k = 6) {
  const w = 80, h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, px = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2]]);
  if (!px.length) return [];
  const L = p => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11;
  px.sort((a, b) => L(a) - L(b));
  let cs = Array.from({ length: k }, (_, i) => px[Math.floor((i + 0.5) * px.length / k)].slice(0, 3).concat(0));
  for (let it = 0; it < 10; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < cs.length; j++) {
        const c2 = cs[j], dd = (p[0] - c2[0]) ** 2 + (p[1] - c2[1]) ** 2 + (p[2] - c2[2]) ** 2;
        if (dd < bd) { bd = dd; bi = j; }
      }
      const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    cs = cs.map((c2, j) => sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3], sum[j][3]] : [c2[0], c2[1], c2[2], 0]);
  }
  const out = [];
  cs.filter(c2 => c2[3] > 0).sort((a, b) => b[3] - a[3]).forEach(c2 => {
    if (!out.some(o => Math.hypot(o[0] - c2[0], o[1] - c2[1], o[2] - c2[2]) < 24)) out.push(c2);
  });
  return out.slice(0, 5).map(c2 => rgb2hex(c2[0], c2[1], c2[2]));
}
function pickFile(capture) {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*';
    if (capture) i.setAttribute('capture', 'environment');
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}

/* ---------------- shared bits ---------------- */
function heroHTML(e, key) {
  if (e.image) return `<img src="${blobURL(key, e.image)}" alt="${esc(e.title || '')}" loading="lazy">`;
  const p = e.palette?.length ? e.palette : ['#DDD7CC'];
  const f = e.fonts?.find(x => x.name)?.name;
  return `<div class="hero-pal">${p.map(c => `<i style="background:${c}"></i>`).join('')}${f ? `<span class="hero-font" style="color:${inkOn(p[0])}">Aa<small>${esc(f)}</small></span>` : ''}</div>`;
}
function cardHTML(e, href, key) {
  const body = `${e.title ? `<b>${esc(e.title)}</b>` : ''}${e.why ? `<p>${esc(e.why)}</p>` : ''}${e.cues?.length ? `<div class="mini-cues">${e.cues.slice(0, 3).map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}`;
  return `<a class="card" href="${href}"><div class="card-img">${heroHTML(e, key)}</div>${e.image && e.palette?.length ? `<div class="strip">${e.palette.map(c => `<i style="background:${c}"></i>`).join('')}</div>` : ''}<div class="card-body">${body}</div></a>`;
}
const chip = (t, on, kind) => `<button type="button" class="chip ${on ? 'on' : ''}" data-${kind}="${esc(t)}">${esc(t)}</button>`;
function linkify(s) {
  return /^https?:\/\/\S+$/.test(s.trim()) ? `<a href="${esc(s.trim())}" target="_blank" rel="noopener">${esc(s.trim())}</a>` : esc(s);
}
function countBy(entries, field) {
  const m = new Map();
  entries.forEach(e => (e[field] || []).forEach(v => m.set(v, (m.get(v) || 0) + 1)));
  return [...m].sort((a, b) => b[1] - a[1]);
}

/* ---------------- router ---------------- */
async function route() {
  const [a, b, c] = (location.hash.replace(/^#\/?/, '') || 'board').split('/');
  window.scrollTo(0, 0);
  $$('.overlay').forEach(o => o.remove());
  $$('[data-tab]').forEach(t => t.classList.toggle('on', t.dataset.tab === a || (a === 'entry' && t.dataset.tab === 'board')));
  try {
    if (a === 'board') return await viewBoard();
    if (a === 'new') return await viewEditor();
    if (a === 'edit') return await viewEditor(b);
    if (a === 'entry') return await viewEntry(b);
    if (a === 'inbox') return c ? await viewEntry(c, b) : b ? await viewShared(b) : await viewInbox();
    if (a === 'me') return await viewMe();
    location.replace('#/board');
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="empty"><p>문제가 생겼어요.</p><p class="muted small">${esc(err.message || err)}</p></div>`;
  }
}
const setMode = m => { document.body.dataset.mode = m; };

/* ---------------- board ---------------- */
async function viewBoard() {
  setMode('tab');
  const entries = (await DB.all('entries')).sort((a, b) => b.createdAt - a.createdAt);
  if (!entries.length) {
    view.innerHTML = `<section class="intro">
      <h1 class="display">예쁜 것을 보면,<br><em>왜</em> 예쁜지 적어두세요.</h1>
      <ol class="steps">
        <li><b>모으기</b>길에서 본 간판, 캡처한 화면, 포장지, 카페 메뉴판까지.</li>
        <li><b>뽑기</b>사진을 탭해 색을 뽑고, 폰트와 간격을 메모해요.</li>
        <li><b>말하기</b>왜 예뻐 보였는지 내 말로 한두 문장.</li>
        <li><b>나누기</b>카드 이미지나 보드 파일로 친구와 주고받아요.</li>
      </ol>
      <a class="btn primary block" href="#/new">첫 기록 남기기</a>
      <p class="muted small center" style="margin-top:14px">기록은 이 폰 안에만 저장돼요.</p>
    </section>`;
    return;
  }
  const tags = ['전체', ...TAGS.filter(t => entries.some(e => e.tags?.includes(t)))];
  if (!tags.includes(boardFilter)) boardFilter = '전체';
  const list = boardFilter === '전체' ? entries : entries.filter(e => e.tags?.includes(boardFilter));
  view.innerHTML = `
    <section class="board-head">
      <div><p class="muted small" style="margin:0 0 4px">${entries.length}개의 기록</p><h1 class="display">내가 모은<br><em>예쁜 것</em>들</h1></div>
      <button class="btn sm" id="shareBoard">보드 공유</button>
    </section>
    <div class="chips scroll" id="filters">${tags.map(t => chip(t, t === boardFilter, 'f')).join('')}</div>
    <div class="masonry">${list.map(e => cardHTML(e, '#/entry/' + e.id, imgKey(e))).join('')}</div>`;
  $('#filters').onclick = ev => {
    const b = ev.target.closest('[data-f]');
    if (b) { boardFilter = b.dataset.f; viewBoard(); }
  };
  $('#shareBoard').onclick = () => openBoardShare(list, myName, boardFilter);
}

function openBoardShare(entries, owner, label) {
  const scope = label && label !== '전체' ? ` (${label})` : '';
  openSheet('보드 공유하기' + scope, [
    {
      label: '보드를 이미지 한 장으로',
      desc: '최근 기록 9개를 콜라주 카드로 만들어 인스타·카톡에 올려요',
      run: () => openPreview({ render: () => renderBoardCard(entries, owner), filename: `moodlog-board-${Date.now()}.png` })
    },
    {
      label: '보드 파일 보내기',
      desc: '친구가 이 앱의 [받은 보드]에서 열어 이유까지 읽을 수 있어요',
      run: () => openPreview({
        kind: 'file',
        render: () => buildBoardFile(entries, owner),
        filename: `moodlog-${(owner || 'board').replace(/[^\w가-힣-]/g, '')}-${fmtDate(Date.now()).replace(/\./g, '')}.json`,
        text: `내 무드보드야! ${APP_URL} 에서 [받은 보드 → 보드 파일 열기]로 열어봐.`
      })
    },
    {
      label: '앱 주소 보내기',
      desc: '친구도 자기 무드보드를 시작할 수 있게',
      run: async () => {
        const data = { title: 'Moodlog', text: '예쁜 걸 보면 왜 예쁜지 적어두는 무드보드 앱', url: APP_URL };
        try { if (navigator.share) return await navigator.share(data); } catch (e) { if (e.name === 'AbortError') return; }
        try { await navigator.clipboard.writeText(APP_URL); toast('주소를 복사했어요'); } catch { prompt('주소를 복사하세요', APP_URL); }
      }
    }
  ]);
}

/* ---------------- editor ---------------- */
async function viewEditor(id) {
  setMode('editor');
  const existing = id ? await DB.get('entries', id) : null;
  if (id && !existing) { location.replace('#/board'); return; }
  const d = existing ? { ...existing, palette: [...(existing.palette || [])], tags: [...(existing.tags || [])], cues: [...(existing.cues || [])], fonts: (existing.fonts || []).map(f => ({ ...f })) }
    : { id: uid(), createdAt: Date.now(), image: null, palette: [], tags: [], cues: [], fonts: [], title: '', why: '', spacing: '', source: '' };
  let dirty = false, pick = null, previewURL = '';
  const promptText = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

  view.innerHTML = `<form class="editor" id="ed" autocomplete="off" novalidate>
    <div class="ed-bar"><button type="button" class="link" id="edClose">취소</button><b>${existing ? '기록 수정' : '새 기록'}</b><button type="submit" class="btn primary sm">저장</button></div>
    <div id="photo"></div>
    <section class="field"><div class="f-head"><label>팔레트</label><span class="muted">탭하면 빠져요 · 최대 8색</span></div><div class="swatches" id="sw"></div></section>
    <section class="field"><label>무엇을 모았나요</label><div class="chips wrap" id="tagChips">${TAGS.map(t => chip(t, d.tags.includes(t), 'tag')).join('')}</div></section>
    <section class="field"><label for="fTitle">한 줄 제목</label><input id="fTitle" name="title" value="${esc(d.title)}" placeholder="예: 성수동 카페 메뉴판" maxlength="60"></section>
    <section class="field"><label for="fWhy">왜 예뻐 보였나요?</label>
      <p class="prompt">✎ ${esc(promptText)}</p>
      <textarea id="fWhy" name="why" rows="5" placeholder="느낀 그대로 적어도 좋아요. 이유를 말로 바꾸는 순간, 감각이 내 것이 돼요.">${esc(d.why)}</textarea>
      <div class="sub">이유를 키워드로 고르면 나중에 내 취향이 보여요</div>
      <div class="chips wrap" id="cueChips">${CUES.map(c => chip(c, d.cues.includes(c), 'cue')).join('')}</div>
    </section>
    <section class="field"><div class="f-head"><label>폰트</label><button type="button" class="link" id="addFont">+ 추가</button></div><div id="fonts"></div></section>
    <section class="field"><label for="fSpace">간격 · 레이아웃</label><textarea id="fSpace" name="spacing" rows="3" placeholder="예: 좌우 여백이 화면의 1/8쯤, 행간 넉넉하게(1.7), 사진과 글 사이 40px 정도">${esc(d.spacing)}</textarea></section>
    <section class="field"><label for="fSrc">출처</label><input id="fSrc" name="source" value="${esc(d.source)}" placeholder="장소, 브랜드, 링크 등"></section>
    ${existing ? '<button type="button" class="btn danger block ed-del" id="edDel">이 기록 삭제</button>' : ''}
  </form>`;

  const photo = $('#photo');
  async function setImage(file) {
    if (!file) return;
    try {
      toast('사진을 정리하는 중…');
      const blob = await resizeBlob(file);
      d.image = blob; dirty = true;
      const img = await blobToImg(blob);
      const pal = extractPalette(img);
      d.palette = [...pal, ...d.palette.filter(c => !pal.includes(c))].slice(0, 8);
      await renderPhoto(); renderSw();
      toast('색 ' + pal.length + '개를 뽑았어요. 사진을 탭해 더 담아보세요');
    } catch (err) { console.error(err); toast('사진을 열 수 없어요'); }
  }
  async function renderPhoto() {
    if (previewURL) URL.revokeObjectURL(previewURL);
    if (!d.image) {
      photo.innerHTML = `<div class="photo-empty"><p class="display sm">무엇이 눈에 들어왔나요?</p>
        <div class="row"><button type="button" class="btn primary" id="cam">사진 찍기</button><button type="button" class="btn" id="lib">앨범 · 캡처</button></div>
        <p class="muted small" style="margin:0">사진 없이 색이나 폰트만 기록해도 좋아요.</p></div>`;
      $('#cam').onclick = async () => setImage(await pickFile(true));
      $('#lib').onclick = async () => setImage(await pickFile(false));
      return;
    }
    previewURL = URL.createObjectURL(d.image);
    photo.innerHTML = `<div class="pick" id="pickBox"><img id="pImg" src="${previewURL}" alt="" draggable="false"><span class="ring" id="ring"></span></div>
      <div class="photo-actions"><span class="muted">사진을 탭하면 그 지점의 색이 팔레트에 담겨요</span><button type="button" class="link" id="rePhoto">사진 바꾸기</button></div>`;
    const img = $('#pImg');
    await img.decode().catch(() => {});
    const s = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
    pick = document.createElement('canvas');
    pick.width = Math.max(1, Math.round(img.naturalWidth * s)); pick.height = Math.max(1, Math.round(img.naturalHeight * s));
    const pctx = pick.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(img, 0, 0, pick.width, pick.height);
    img.addEventListener('click', ev => {
      const r = img.getBoundingClientRect(), box = $('#pickBox').getBoundingClientRect();
      const fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
      const cx = Math.min(pick.width - 3, Math.max(0, Math.floor(fx * pick.width) - 2));
      const cy = Math.min(pick.height - 3, Math.max(0, Math.floor(fy * pick.height) - 2));
      const px = pctx.getImageData(cx, cy, Math.min(5, pick.width - cx), Math.min(5, pick.height - cy)).data;
      let R = 0, G = 0, B = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) { R += px[i]; G += px[i + 1]; B += px[i + 2]; n++; }
      const hex = rgb2hex(R / n, G / n, B / n);
      const ring = $('#ring');
      ring.style.left = (ev.clientX - box.left) + 'px'; ring.style.top = (ev.clientY - box.top) + 'px';
      ring.style.background = hex; ring.classList.remove('on'); void ring.offsetWidth; ring.classList.add('on');
      clearTimeout(ring._t); ring._t = setTimeout(() => ring.classList.remove('on'), 900);
      addColor(hex);
    });
    $('#rePhoto').onclick = async () => setImage(await pickFile(false));
  }
  function addColor(h) {
    if (d.palette.includes(h)) return toast('이미 담긴 색이에요');
    if (d.palette.length >= 8) return toast('팔레트는 8색까지예요. 하나를 빼주세요');
    d.palette.push(h); dirty = true; renderSw(); toast(h + ' 담았어요');
  }
  function renderSw() {
    $('#sw').innerHTML = d.palette.map((c, i) => `<button type="button" class="sw" data-i="${i}" style="background:${c};color:${inkOn(c)}" aria-label="${c} 빼기"><span>${c}</span></button>`).join('')
      + (d.palette.length < 8 ? `<label class="sw add" aria-label="색 직접 추가">+<input type="color" id="colorIn" value="#D9481F"></label>` : '');
  }
  $('#sw').addEventListener('click', ev => {
    const b = ev.target.closest('.sw[data-i]');
    if (b) { d.palette.splice(+b.dataset.i, 1); dirty = true; renderSw(); }
  });
  $('#sw').addEventListener('change', ev => { if (ev.target.id === 'colorIn') addColor(ev.target.value.toUpperCase()); });

  function renderFonts() {
    $('#fonts').innerHTML = d.fonts.length
      ? d.fonts.map((f, i) => `<div class="font-row" data-i="${i}"><input data-k="name" value="${esc(f.name)}" placeholder="폰트 이름"><input data-k="note" value="${esc(f.note)}" placeholder="느낌 · 쓰임"><button type="button" class="x" aria-label="삭제">×</button></div>`).join('')
      : `<p class="muted small" style="margin:0">이름을 몰라도 괜찮아요. ‘둥근 손글씨’, ‘가는 세리프’처럼 생김새로 적어보세요.</p>`;
  }
  $('#fonts').addEventListener('input', ev => {
    const r = ev.target.closest('.font-row');
    if (r) { d.fonts[+r.dataset.i][ev.target.dataset.k] = ev.target.value; dirty = true; }
  });
  $('#fonts').addEventListener('click', ev => {
    const r = ev.target.closest('.x') && ev.target.closest('.font-row');
    if (r) { d.fonts.splice(+r.dataset.i, 1); renderFonts(); }
  });
  $('#addFont').onclick = () => { d.fonts.push({ name: '', note: '' }); renderFonts(); $('#fonts .font-row:last-child input').focus(); };

  $('#tagChips').onclick = ev => toggleChip(ev, 'tag', d.tags);
  $('#cueChips').onclick = ev => toggleChip(ev, 'cue', d.cues);
  function toggleChip(ev, kind, arr) {
    const b = ev.target.closest(`[data-${kind}]`); if (!b) return;
    const v = b.dataset[kind], i = arr.indexOf(v);
    i >= 0 ? arr.splice(i, 1) : arr.push(v);
    b.classList.toggle('on', i < 0); dirty = true;
  }
  $('#ed').addEventListener('input', ev => {
    const n = ev.target.name;
    if (n && n in d) { d[n] = ev.target.value; dirty = true; }
  });
  $('#edClose').onclick = () => {
    if (dirty && !confirm('작성 중인 내용이 사라져요. 닫을까요?')) return;
    location.hash = existing ? '#/entry/' + d.id : '#/board';
  };
  if (existing) $('#edDel').onclick = async () => {
    if (!confirm('이 기록을 삭제할까요? 되돌릴 수 없어요.')) return;
    await DB.del('entries', d.id); dropURLs('me:' + d.id); toast('삭제했어요'); location.replace('#/board');
  };
  $('#ed').onsubmit = async ev => {
    ev.preventDefault();
    d.fonts = d.fonts.filter(f => f.name.trim() || f.note.trim());
    d.title = d.title.trim(); d.why = d.why.trim(); d.spacing = d.spacing.trim(); d.source = d.source.trim();
    if (!d.image && !d.palette.length && !d.why && !d.fonts.length) return toast('사진·색·이유 중 하나는 남겨주세요');
    dropURLs('me:' + d.id);
    d.updatedAt = Date.now();
    await DB.put('entries', d);
    if (previewURL) URL.revokeObjectURL(previewURL);
    navigator.storage?.persist?.().catch(() => {});
    toast(existing ? '수정했어요' : '기록했어요');
    location.replace('#/entry/' + d.id);
  };

  await renderPhoto(); renderSw(); renderFonts();
}

/* ---------------- detail ---------------- */
async function viewEntry(id, boardId) {
  setMode('detail');
  let e, board;
  if (boardId) { board = await DB.get('boards', boardId); e = board?.entries.find(x => x.id === id); }
  else e = await DB.get('entries', id);
  if (!e) { view.innerHTML = `<div class="empty"><p>기록을 찾을 수 없어요.</p><a class="btn" href="#/board">보드로</a></div>`; return; }
  const key = imgKey(e, boardId || 'me');
  const back = boardId ? `#/inbox/${boardId}` : '#/board';
  const owner = boardId ? (board.owner || '') : myName;
  const pal = e.palette || [];
  let contrastLine = '';
  if (pal.length > 1) {
    const s = [...pal].sort((a, b) => lum(a) - lum(b)), r = contrast(s[0], s[s.length - 1]);
    const note = r >= 7 ? '아주 또렷한 대비예요' : r >= 4.5 ? '본문 글자를 올려도 잘 읽혀요' : r >= 3 ? '큰 글씨 정도에 적당한 대비예요' : '부드럽고 차분한, 대비가 낮은 톤이에요';
    contrastLine = `<p class="muted small contrast">가장 밝은 색 ↔ 가장 어두운 색 명도 대비 <b>${r.toFixed(1)}:1</b> · ${note}</p>`;
  }
  view.innerHTML = `<article class="detail">
    <div class="d-bar"><a href="${back}" class="link">← ${boardId ? esc((board.owner || '이름 없음') + '의 보드') : '내 보드'}</a><span class="muted">${fmtDate(e.createdAt)}</span></div>
    <div class="d-img">${heroHTML(e, key)}</div>
    ${pal.length ? `<div class="d-pal">${pal.map(c => `<button class="d-sw" data-hex="${c}" style="background:${c};color:${inkOn(c)}" aria-label="${c} 복사"><span>${c}</span><small>${hex2rgb(c).join(' ')}</small></button>`).join('')}</div>${contrastLine}` : ''}
    <h1 class="d-title">${esc(e.title || '제목 없는 기록')}</h1>
    ${e.tags?.length ? `<div class="chips wrap static">${e.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
    ${e.savedFrom ? `<p class="saved-from">${esc(e.savedFrom)}님의 보드에서 담아온 기록</p>` : ''}
    ${e.why || e.cues?.length ? `<section class="d-sec"><h3>Why it works</h3>${e.why ? `<p class="why">${esc(e.why)}</p>` : ''}${e.cues?.length ? `<div class="cues">${e.cues.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}</section>` : ''}
    ${e.fonts?.length ? `<section class="d-sec"><h3>Type</h3>${e.fonts.map(f => `<div class="d-font"><b>${esc(f.name)}</b><span>${esc(f.note)}</span></div>`).join('')}</section>` : ''}
    ${e.spacing ? `<section class="d-sec"><h3>Spacing &amp; Layout</h3><p>${esc(e.spacing)}</p></section>` : ''}
    ${e.source ? `<section class="d-sec"><h3>Source</h3><p>${linkify(e.source)}</p></section>` : ''}
    <div class="d-actions">
      <button class="btn primary" id="shareCard">카드로 공유</button>
      ${boardId ? '<button class="btn" id="keep">내 보드에 담기</button>' : `<a class="btn" href="#/edit/${esc(e.id)}">수정</a>`}
    </div>
  </article>`;
  $$('.d-sw').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.hex); toast(b.dataset.hex + ' 복사했어요'); } catch { toast(b.dataset.hex); }
  });
  $('#shareCard').onclick = () => openPreview({ render: () => renderEntryCard(e, owner), filename: `moodlog-${e.id}.png` });
  if (boardId) $('#keep').onclick = async () => {
    const copy = { ...e, id: uid(), createdAt: Date.now(), updatedAt: Date.now(), savedFrom: board.owner || '친구' };
    await DB.put('entries', copy); toast('내 보드에 담았어요');
  };
}

/* ---------------- inbox ---------------- */
async function viewInbox() {
  setMode('tab');
  const boards = (await DB.all('boards')).sort((a, b) => b.receivedAt - a.receivedAt);
  view.innerHTML = `<section class="page-head">
      <h1 class="display">받은 <em>보드</em></h1>
      <p class="muted">친구가 보낸 보드 파일을 열면 여기에 모여요. 남의 ‘왜’를 읽는 것만큼 좋은 훈련은 없어요.</p>
      <button class="btn primary block" id="openFile">보드 파일 열기</button>
    </section>
    ${boards.length ? `<div class="inbox-list">${boards.map(b => `<a class="ib" href="#/inbox/${b.id}">
        <div class="ib-thumbs">${b.entries.slice(0, 4).map(e => `<div>${heroHTML(e, imgKey(e, b.id))}</div>`).join('')}</div>
        <div class="ib-meta"><b>${esc(b.owner || '이름 없음')}의 보드</b><span class="muted">기록 ${b.entries.length}개 · ${fmtDate(b.receivedAt)} 받음</span></div>
      </a>`).join('')}</div>`
      : `<div class="empty"><p>아직 받은 보드가 없어요.</p><p class="muted small">친구에게 앱 주소를 보내고,<br>서로 [보드 공유 → 보드 파일 보내기]로 주고받아 보세요.</p></div>`}`;
  $('#openFile').onclick = () => importFile('inbox');
}

async function viewShared(boardId) {
  setMode('tab');
  const b = await DB.get('boards', boardId);
  if (!b) { location.replace('#/inbox'); return; }
  const cues = countBy(b.entries, 'cues').slice(0, 4);
  view.innerHTML = `<section class="board-head">
      <div><p class="muted small" style="margin:0 0 4px"><a href="#/inbox">← 받은 보드</a> · 기록 ${b.entries.length}개</p>
      <h1 class="display">${esc(b.owner || '이름 없음')}의<br><em>무드보드</em></h1></div>
      <button class="btn sm ghost" id="delBoard">삭제</button>
    </section>
    ${cues.length ? `<p class="small muted" style="margin:-4px 0 14px">자주 꼽은 이유 · ${cues.map(c => `<b style="color:var(--accent)">#${esc(c[0])}</b>`).join(' ')}</p>` : ''}
    <div class="masonry">${b.entries.map(e => cardHTML(e, `#/inbox/${b.id}/${e.id}`, imgKey(e, b.id))).join('')}</div>`;
  $('#delBoard').onclick = async () => {
    if (!confirm('이 보드를 목록에서 지울까요?')) return;
    await DB.del('boards', b.id); dropURLs(b.id + ':'); location.replace('#/inbox');
  };
}

async function importFile(mode) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = '.json,.txt,application/json,text/plain'; i.multiple = mode === 'inbox';
  i.onchange = async () => {
    let last = null, total = 0;
    for (const f of i.files) {
      try {
        const data = JSON.parse(await f.text());
        if (data?.app !== 'moodlog' || !Array.isArray(data.entries)) throw new Error('Moodlog 보드 파일이 아니에요');
        const entries = [];
        for (const raw of data.entries) {
          const e = { ...raw, palette: raw.palette || [], tags: raw.tags || [], cues: raw.cues || [], fonts: raw.fonts || [] };
          if (typeof raw.image === 'string' && raw.image.startsWith('data:image/')) e.image = await (await fetch(raw.image)).blob();
          else e.image = null;
          entries.push(e);
        }
        total += entries.length;
        if (mode === 'inbox') {
          last = uid();
          await DB.put('boards', { id: last, owner: data.owner || '', exportedAt: data.exportedAt, receivedAt: Date.now(), entries });
        } else {
          for (const e of entries) await DB.put('entries', e);
        }
      } catch (err) { console.error(err); toast(f.name + ': ' + (err.message || '열 수 없어요')); return; }
    }
    if (mode === 'inbox' && last) { toast('보드를 열었어요'); location.hash = '#/inbox/' + last; }
    else if (mode === 'restore') { toast(`기록 ${total}개를 복원했어요`); route(); }
  };
  i.click();
}

async function blobToDataURL(blob, max = 1200) {
  const small = await resizeBlob(blob, max, 0.82);
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(small); });
}
async function buildBoardFile(entries, owner) {
  const out = [];
  for (const e of entries) {
    const { image, ...rest } = e;
    out.push({ ...rest, image: image ? await blobToDataURL(image) : null });
  }
  const json = JSON.stringify({ app: 'moodlog', version: 1, owner: owner || '', exportedAt: Date.now(), entries: out });
  const blob = new Blob([json], { type: 'application/json' });
  return { blob, meta: `기록 ${entries.length}개 · ${fmtSize(blob.size)}` };
}

/* ---------------- me ---------------- */
async function viewMe() {
  setMode('tab');
  const entries = await DB.all('entries');
  const week = entries.filter(e => e.createdAt > Date.now() - 7 * 864e5).length;
  const colors = sortColors([...new Set(entries.flatMap(e => e.palette || []))]);
  const cues = countBy(entries, 'cues').slice(0, 6), tags = countBy(entries, 'tags').slice(0, 5);
  const bars = list => { const mx = list[0]?.[1] || 1; return list.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="width:${Math.max(6, v / mx * 100)}%"></i><em>${v}</em></div>`).join(''); };
  view.innerHTML = `<section class="page-head"><h1 class="display">나의 <em>감각</em> 노트</h1></section>
    <section class="field" style="margin-top:0"><label for="nm">공유할 때 표시될 이름</label><input id="nm" value="${esc(myName)}" placeholder="예: 하나" maxlength="20"></section>
    <div class="stats"><div><b>${entries.length}</b><span>전체 기록</span></div><div><b>${week}</b><span>최근 7일</span></div><div><b>${colors.length}</b><span>모은 색</span></div></div>
    ${cues.length ? `<section class="d-sec"><h3>내가 자주 꼽는 이유</h3>${bars(cues)}<p class="muted small" style="margin-top:8px">한쪽으로 치우쳐 있다면, 다음엔 다른 관점(${esc(CUES.filter(c => !cues.some(x => x[0] === c)).slice(0, 2).join(', ') || '비율')})으로 봐보세요.</p></section>` : ''}
    ${tags.length ? `<section class="d-sec"><h3>자주 모으는 것</h3>${bars(tags)}</section>` : ''}
    ${colors.length ? `<section class="d-sec"><h3>내 컬러 취향</h3><div class="taste">${colors.map(c => `<i style="background:${c}" title="${c}"></i>`).join('')}</div></section>` : ''}
    <section class="d-sec"><h3>Backup</h3>
      <p class="muted small" style="margin-bottom:10px">기록은 이 폰의 브라우저 안에만 저장돼요. 브라우저 데이터를 지우면 사라지니, 가끔 백업 파일을 만들어 두세요.</p>
      <div class="row"><button class="btn" id="bk">백업 파일 만들기</button><button class="btn" id="rs">백업 복원</button></div>
    </section>
    <section class="d-sec howto"><h3>홈 화면에 앱으로 설치</h3>
      <p class="small"><b>iPhone</b> · Safari 아래 공유 버튼 → ‘홈 화면에 추가’</p>
      <p class="small"><b>Android</b> · Chrome 메뉴(⋮) → ‘앱 설치’ 또는 ‘홈 화면에 추가’</p>
    </section>`;
  $('#nm').onchange = async ev => { myName = ev.target.value.trim(); await DB.put('meta', myName, 'name'); toast('이름을 저장했어요'); };
  $('#bk').onclick = async () => {
    if (!entries.length) return toast('아직 기록이 없어요');
    openPreview({ kind: 'file', render: () => buildBoardFile(entries.sort((a, b) => b.createdAt - a.createdAt), myName), filename: `moodlog-backup-${fmtDate(Date.now()).replace(/\./g, '')}.json` });
  };
  $('#rs').onclick = () => importFile('restore');
}

/* ---------------- overlays & sharing ---------------- */
function openSheet(title, actions) {
  const ov = document.createElement('div');
  ov.className = 'overlay sheet';
  ov.innerHTML = `<div class="sheet-inner" role="dialog" aria-label="${esc(title)}"><div class="grab"></div><h3>${esc(title)}</h3>
    ${actions.map((a, i) => `<button class="sheet-act" data-i="${i}"><b>${esc(a.label)}</b><span>${esc(a.desc || '')}</span></button>`).join('')}
    <button class="btn block" data-close>닫기</button></div>`;
  document.body.append(ov);
  requestAnimationFrame(() => ov.classList.add('on'));
  const close = () => { ov.classList.remove('on'); setTimeout(() => ov.remove(), 230); };
  ov.onclick = ev => {
    if (ev.target === ov || ev.target.closest('[data-close]')) return close();
    const b = ev.target.closest('.sheet-act');
    if (b) { close(); actions[+b.dataset.i].run(); }
  };
}

/* 렌더 → 미리보기 → (새 탭 제스처로) 공유. iOS가 오래 걸린 작업 뒤 share()를 막는 문제를 피하려고 두 단계로 나눔 */
async function openPreview({ render, filename, text = '', kind = 'image' }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="ov-inner"><div class="ov-img"><div class="spinner"></div></div>
    <p class="muted small center">${kind === 'image' ? '이미지를 길게 눌러 사진에 저장할 수도 있어요' : '카톡·메일·에어드롭 등으로 보내세요'}</p>
    <div class="row"><button class="btn" data-a="close">닫기</button><button class="btn primary" data-a="share" disabled>${kind === 'image' ? '공유 · 저장' : '보내기'}</button></div></div>`;
  document.body.append(ov);
  requestAnimationFrame(() => ov.classList.add('on'));
  let closed = false, u = '';
  const close = () => { closed = true; ov.classList.remove('on'); setTimeout(() => { ov.remove(); if (u) URL.revokeObjectURL(u); }, 230); };
  ov.onclick = ev => { if (ev.target === ov || ev.target.closest('[data-a=close]')) close(); };
  let res;
  try { res = await render(); } catch (err) { console.error(err); toast('만들지 못했어요: ' + (err.message || err)); close(); return; }
  if (closed) return;
  const blob = res.blob || res;
  if (kind === 'image') {
    u = URL.createObjectURL(blob);
    $('.ov-img', ov).innerHTML = `<img src="${u}" alt="공유 카드 미리보기">`;
  } else {
    $('.ov-img', ov).innerHTML = `<div class="filecard"><b>Moodlog board</b><span>${esc(res.meta || '')}</span><span>${esc(filename)}</span></div>`;
  }
  const sb = $('[data-a=share]', ov);
  sb.disabled = false;
  sb.onclick = () => shareFile(blob, filename, text);
}

async function shareFile(blob, name, text) {
  const candidates = [new File([blob], name, { type: blob.type })];
  if (blob.type === 'application/json') candidates.push(new File([blob], name.replace(/\.json$/, '.txt'), { type: 'text/plain' }));
  const file = candidates.find(f => navigator.canShare?.({ files: [f] }));
  if (file) {
    try {
      await navigator.share(text ? { files: [file], text } : { files: [file] });
      return;
    } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('파일로 저장했어요');
}

/* ---------------- canvas cards ---------------- */
async function fontsReady() {
  try {
    await Promise.race([
      Promise.all([`700 40px ${FONT}`, `400 40px ${FONT}`, `600 40px ${FONT}`, `italic 40px ${SERIF}`].map(f => document.fonts.load(f, '가Aa'))),
      new Promise(r => setTimeout(r, 2500))
    ]);
  } catch { /* fallback fonts are fine */ }
}
function cover(x, img, dx, dy, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight), sw = w / s, sh = h / s;
  x.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, dx, dy, w, h);
}
function wrap(x, text, maxW, maxLines) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (let w of para.split(' ')) {
      const cand = line ? line + ' ' + w : w;
      if (x.measureText(cand).width <= maxW) { line = cand; continue; }
      if (line) { out.push(line); line = ''; }
      while (x.measureText(w).width > maxW) {
        let i = 1;
        while (i < w.length && x.measureText(w.slice(0, i + 1)).width <= maxW) i++;
        out.push(w.slice(0, i)); w = w.slice(i);
      }
      line = w;
    }
    out.push(line);
  }
  if (out.length > maxLines) {
    const l = out.slice(0, Math.max(0, maxLines));
    if (!l.length) return l;
    let last = l[l.length - 1];
    while (last && x.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    l[l.length - 1] = last + '…';
    return l;
  }
  return out;
}
function drawPalBlocks(x, pal, dx, dy, w, h) {
  const p = pal.length ? pal : ['#DDD7CC'], bw = w / p.length;
  p.forEach((c, i) => { x.fillStyle = c; x.fillRect(Math.round(dx + i * bw), dy, Math.ceil(bw) + 1, h); });
}
async function drawHero(x, e, dx, dy, w, h) {
  if (e.image) { cover(x, await blobToImg(e.image), dx, dy, w, h); return; }
  drawPalBlocks(x, e.palette || [], dx, dy, w, h);
  const f = e.fonts?.find(z => z.name)?.name;
  if (f) {
    const col = inkOn((e.palette || ['#DDD7CC'])[0]);
    x.fillStyle = col; x.font = `700 ${Math.round(h * 0.22)}px ${FONT}`;
    x.fillText('Aa', dx + w * 0.06, dy + h * 0.78);
    x.font = `600 ${Math.max(14, Math.round(h * 0.05))}px ${FONT}`;
    x.fillText(f, dx + w * 0.065, dy + h * 0.9);
  }
}
const toPNG = c => new Promise(r => c.toBlob(r, 'image/png'));

async function renderEntryCard(e, owner) {
  await fontsReady();
  const W = 1080, H = 1350, M = 72, hw = W - 2 * M;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = PAPER; x.fillRect(0, 0, W, H);
  x.textBaseline = 'alphabetic';
  x.fillStyle = INK; x.font = `700 40px ${FONT}`; x.fillText('Mood', M, 104);
  const mw = x.measureText('Mood').width;
  x.fillStyle = ACCENT; x.font = `italic 48px ${SERIF}`; x.fillText('log', M + mw + 2, 104);
  x.fillStyle = MUTED; x.font = `500 24px ${FONT}`; x.textAlign = 'right';
  x.fillText(`${owner ? owner + ' · ' : ''}${fmtDate(e.createdAt)}`, W - M, 100); x.textAlign = 'left';

  const pal = (e.palette || []).slice(0, 8);
  const hy = 140, hh = e.image ? 600 : 520;
  await drawHero(x, e, M, hy, hw, hh);
  let y = hy + hh + 24;
  if (pal.length && e.image) {
    const gap = 10, sw = (hw - gap * (pal.length - 1)) / pal.length;
    pal.forEach((col, i) => {
      const px = M + i * (sw + gap);
      x.fillStyle = col; x.fillRect(px, y, sw, 92);
      x.fillStyle = MUTED; x.font = `600 ${pal.length > 6 ? 16 : 20}px ui-monospace, Menlo, monospace`;
      x.fillText(col, px, y + 124);
    });
    y += 168;
  } else if (pal.length) {
    x.fillStyle = MUTED; x.font = `600 22px ui-monospace, Menlo, monospace`;
    x.fillText(wrap(x, pal.join('   '), hw, 1)[0] || '', M, y + 30);
    y += 64;
  } else y += 16;

  const bottom = H - 120;
  if (e.title) {
    x.fillStyle = INK; x.font = `700 46px ${FONT}`;
    for (const l of wrap(x, e.title, hw, 2)) { x.fillText(l, M, y + 46); y += 60; }
    y += 10;
  }
  if (e.why) {
    x.fillStyle = '#3A3833'; x.font = `400 31px ${FONT}`;
    const n = Math.max(1, Math.floor((bottom - y) / 48));
    for (const l of wrap(x, e.why, hw, n)) { x.fillText(l, M, y + 34); y += 48; }
  }
  const tagsLine = (e.cues?.length ? e.cues : e.tags || []).map(t => '#' + t).join('   ');
  x.fillStyle = ACCENT; x.font = `600 26px ${FONT}`;
  if (tagsLine) x.fillText(wrap(x, tagsLine, hw, 1)[0], M, H - 64);
  x.fillStyle = MUTED; x.font = `italic 26px ${SERIF}`; x.textAlign = 'right';
  x.fillText('why it works', W - M, H - 64); x.textAlign = 'left';
  return toPNG(c);
}

async function renderBoardCard(entries, owner) {
  await fontsReady();
  const W = 1080, H = 1350, M = 60;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = PAPER; x.fillRect(0, 0, W, H);
  const items = entries.slice(0, 9), n = items.length;
  x.fillStyle = INK; x.font = `700 58px ${FONT}`; x.fillText(owner ? `${owner}의` : '나의', M, 118);
  const ow = x.measureText(owner ? `${owner}의` : '나의').width;
  x.fillStyle = ACCENT; x.font = `italic 70px ${SERIF}`; x.fillText(' moodlog', M + ow, 118);
  x.fillStyle = MUTED; x.font = `500 24px ${FONT}`;
  const dates = entries.map(e => e.createdAt);
  x.fillText(`기록 ${entries.length}개 · ${fmtDate(Math.min(...dates))} — ${fmtDate(Math.max(...dates))}`, M, 166);

  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), gap = 12;
  const top = 200, areaH = H - top - 230, cw = (W - 2 * M - gap * (cols - 1)) / cols, ch = (areaH - gap * (rows - 1)) / rows;
  for (let i = 0; i < n; i++) {
    const cx = M + (i % cols) * (cw + gap), cy = top + Math.floor(i / cols) * (ch + gap);
    x.save(); x.beginPath(); x.rect(cx, cy, cw, ch); x.clip();
    await drawHero(x, items[i], cx, cy, cw, ch);
    x.restore();
  }
  const colors = [...new Set(entries.flatMap(e => (e.palette || []).slice(0, 2)))].slice(0, 12);
  const py = H - 200;
  if (colors.length) drawPalBlocks(x, colors, M, py, W - 2 * M, 54);
  const cues = countBy(entries, 'cues').slice(0, 4).map(c2 => '#' + c2[0]).join('   ');
  x.fillStyle = MUTED; x.font = `500 22px ${FONT}`; x.fillText('자주 꼽은 이유', M, py + 104);
  x.fillStyle = ACCENT; x.font = `600 28px ${FONT}`; x.fillText(cues || '#감각기록', M, py + 146);
  x.font = `italic 34px ${SERIF}`;
  const lw = x.measureText('log').width;
  x.textAlign = 'right';
  x.fillStyle = ACCENT; x.fillText('log', W - M, py + 146);
  x.fillStyle = INK; x.font = `700 28px ${FONT}`; x.fillText('Mood', W - M - lw - 2, py + 146);
  x.textAlign = 'left';
  return toPNG(c);
}

/* ---------------- boot ---------------- */
window.addEventListener('hashchange', route);
(async () => {
  try { myName = (await DB.get('meta', 'name')) || ''; } catch (e) { console.warn(e); }
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
