/* مسابقة عودة ازدهار — منطق اللعبة */
(function () {
  'use strict';

  /* ================= constants ================= */
  const CATS = Array.isArray(window.LAMMA_DATA) ? window.LAMMA_DATA : [];
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
  const DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const ar = (v) => String(v).replace(/[0-9]/g, (d) => DIGITS[d]);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const POINTS = { 1: 100, 2: 200, 3: 300 };
  const DIFFS = [{ d: 1, name: 'سهل' }, { d: 2, name: 'متوسط' }, { d: 3, name: 'صعب' }];
  const MAX_TEAMS = 10;
  const TEAM_OPTIONS = Array.from({ length: MAX_TEAMS - 1 }, (_, i) => i + 2)
    .map((n) => ({ n, label: n === 2 ? 'فريقان' : `${ar(n)} فرق` }));
  const TIME_OPTIONS = [15, 30, 45, 60];
  const ROUND_OPTIONS = [2, 3, 4, 6, 8, 10];
  const DEFAULT_NAMES = ['الصقور', 'الفهود', 'النجوم', 'الشهب', 'الموج', 'البرق', 'النخيل', 'الرعد', 'القمم', 'العواصف'];
  const MIN_CATS = 3;
  const EXTRA_TIME = 15;
  const STEAL_MIN_TIME = 10;
  const FOG_SECONDS = 10;
  const SCRAMBLE_EVERY = 3;
  const STORE_KEY = 'lamma-family-v1';

  /* help = used by the answering team on its own turn; sabotage = used by the other teams against it */
  const CARDS = {
    time:     { name: 'وقت إضافي',    kind: 'help',     desc: 'تضيف ١٥ ثانية إلى وقت السؤال الحالي.' },
    double:   { name: 'نقاط مضاعفة',  kind: 'help',     desc: 'تضاعف نقاط السؤال إذا كانت إجابتكم صحيحة.' },
    fifty:    { name: 'حذف إجابتين',  kind: 'help',     desc: 'تحذف إجابتين خاطئتين فيبقى خياران فقط.' },
    life:     { name: 'فرصة ثانية',   kind: 'help',     desc: 'إذا أخطأتم تحصلون على محاولة أخرى في نفس السؤال.' },
    swap:     { name: 'تغيير السؤال', kind: 'help',     desc: 'تستبدل السؤال بآخر من نفس الفئة والصعوبة، ويبدأ الوقت من جديد ويزول الخلط والضباب والاستعجال.' },
    shield:   { name: 'الدرع',        kind: 'help',     desc: 'يمنع التخريب عنكم في هذا السؤال، ويُبطل الكذبة والخلط والضباب إن استُخدمت عليكم.' },
    lie:      { name: 'الكذبة',       kind: 'sabotage', desc: 'يرى فريقكم الإجابة سراً ثم يحاول تضليل الفريق المجيب. إن أخطأوا تأخذون نقاط السؤال.' },
    rush:     { name: 'الاستعجال',    kind: 'sabotage', desc: 'تقطع نصف الوقت المتبقي على الفريق المجيب.' },
    freeze:   { name: 'التجميد',      kind: 'sabotage', desc: 'يمنع الفريق المجيب من استخدام بطاقات المساعدة في هذا السؤال، ومنها الدرع.' },
    scramble: { name: 'الخلط',        kind: 'sabotage', desc: 'تتبدّل أماكن الإجابات كل ٣ ثوانٍ حتى يجيب الفريق.' },
    fog:      { name: 'الضباب',       kind: 'sabotage', desc: 'تختفي الإجابات خلف ضباب ينقشع تدريجياً خلال ١٠ ثوانٍ.' },
    steal:    { name: 'السرقة',       kind: 'sabotage', desc: 'إذا أخطأ الفريق المجيب تجيبون أنتم عن نفس السؤال وتأخذون نقاطه. تظهر تلقائياً عند الخطأ.' }
  };
  const CARD_ORDER = ['time', 'double', 'fifty', 'life', 'swap', 'shield', 'lie', 'rush', 'freeze', 'scramble', 'fog', 'steal'];
  const HELP = CARD_ORDER.filter((id) => CARDS[id].kind === 'help');
  const SABOTAGE = CARD_ORDER.filter((id) => CARDS[id].kind === 'sabotage');
  /* which question field records each sabotage (one of each per question) */
  const SABOTAGE_FIELD = { lie: 'lie', rush: 'rushBy', freeze: 'frozenBy', scramble: 'scrambleBy', fog: 'fogBy' };

  const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    time: svg('<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3.5h4M17.8 7.2l1.3-1.3"/>'),
    double: svg('<circle cx="12" cy="12" r="8.5"/><text x="12" y="15.6" text-anchor="middle" font-size="9.5" font-weight="600" fill="currentColor" stroke="none" font-family="system-ui, sans-serif">×2</text>'),
    fifty: svg('<circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/><path d="M13.2 15.4 18.8 8.6"/>'),
    life: svg('<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>'),
    swap: svg('<path d="M5 8h13M15 5l3 3-3 3M19 16H6M9 13l-3 3 3 3"/>'),
    shield: svg('<path d="M12 3.5 19 6.3v5c0 4.4-2.9 7.8-7 9.2-4.1-1.4-7-4.8-7-9.2v-5z"/><path d="m9 12 2 2 4-4"/>'),
    lie: svg('<path d="M4.5 5.5h15v10.5h-8.5l-4.5 3.5V16h-2z"/><path d="M10 9.4a2 2 0 1 1 2.6 1.9c-.4.1-.6.5-.6.9v.3"/><path d="M12 14.4h.01"/>'),
    rush: svg('<path d="M13 3 5.5 13.5H11L10 21l7.5-10.5H12z"/>'),
    steal: svg('<path d="M7 4v8a5 5 0 0 0 10 0V4h-3.5v8a1.5 1.5 0 0 1-3 0V4z"/><path d="M7 7.5h3.5M13.5 7.5H17"/>'),
    freeze: svg('<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>'),
    scramble: svg('<path d="M4 7h3c2.2 0 3.3 1.2 4.6 3.6M4 17h3c2.2 0 3.3-1.2 4.6-3.6M12.4 13.6C13.7 16 14.8 17 17 17h3M12.4 10.4C13.7 8 14.8 7 17 7h3M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5"/>'),
    fog: svg('<path d="M7 14.5h10a3.4 3.4 0 0 0 .3-6.8A5 5 0 0 0 7.6 8.6 3 3 0 0 0 7 14.5z"/><path d="M5 18h10M9 21h10"/>'),
    back: svg('<path d="m9 6 6 6-6 6"/>'),
    board: svg('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
    cards: svg('<rect x="4" y="6" width="11" height="14" rx="2"/><path d="M9 3.5h9a2 2 0 0 1 2 2V17"/>')
  };

  const STEPS = [
    { key: 'cats',   eyebrow: 'قبل أن نبدأ',          title: 'ما الفئات التي تريدون اللعب بها؟' },
    { key: 'teams',  eyebrow: 'رائع، والآن',          title: 'كم فريقاً سيلعب؟' },
    { key: 'names',  eyebrow: 'لكل فريق اسم يليق به', title: 'ما أسماء الفرق؟' },
    { key: 'time',   eyebrow: 'ممتاز',                title: 'كم ثانية لكل سؤال؟' },
    { key: 'rounds', eyebrow: 'سؤالان فقط وننطلق',    title: 'كم جولة تريدون؟' },
    { key: 'cards',  eyebrow: 'وأخيراً',              title: 'ما البطاقات المسموحة في اللعبة؟' }
  ];

  /* ================= state ================= */
  let S = null;
  const ui = { sheet: null, menu: false, lastKey: '', cardHint: null, shuffled: false, saboTeam: null };

  /* fingerprint of the question bank: a saved game from an older bank is dropped on load */
  const BANK = (() => {
    const txt = JSON.stringify(CATS.map((c) => [c.id, c.q]));
    let h = 5381;
    for (let i = 0; i < txt.length; i++) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0;
    return `${CATS.length}.${txt.length}.${h.toString(36)}`;
  })();
  /* cards added after the first release; older saved settings get them switched on */
  const CARDS_V2 = ['freeze', 'scramble', 'fog'];

  function freshState() {
    return {
      v: 1,
      bank: BANK,
      cardsV: 2,
      screen: 'setup',
      step: 0,
      settings: { cats: [], teams: 2, names: DEFAULT_NAMES.slice(), time: 30, rounds: 6, cards: CARD_ORDER.slice() },
      game: null,
      seen: {},
      sound: true
    };
  }

  function normalize(st) {
    const base = freshState();
    if (!st || typeof st !== 'object' || !st.settings) return base;
    const s = Object.assign(base, st);
    s.settings = Object.assign(freshState().settings, st.settings);
    s.settings.cats = (s.settings.cats || []).filter((id) => CAT[id]);
    s.settings.cards = (s.settings.cards || []).filter((id) => CARDS[id]);
    if ((st.cardsV || 1) < 2) {
      CARDS_V2.forEach((id) => { if (!s.settings.cards.includes(id)) s.settings.cards.push(id); });
      s.settings.cards.sort((a, b) => CARD_ORDER.indexOf(a) - CARD_ORDER.indexOf(b));
      s.cardsV = 2;
    }
    if (st.bank !== BANK) {
      s.bank = BANK;
      s.seen = {};
      if (s.game) { s.game = null; s.screen = 'setup'; s.step = 0; }
    }
    while (s.settings.names.length < DEFAULT_NAMES.length) s.settings.names.push(DEFAULT_NAMES[s.settings.names.length]);
    if (s.screen !== 'setup' && !s.game) { s.screen = 'setup'; s.step = 0; }
    if (s.screen === 'question' && !(s.game && s.game.q)) s.screen = 'turn';
    s.step = Math.min(Math.max(0, s.step | 0), STEPS.length - 1);
    s.seen = s.seen || {};
    return s;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
  }
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  /* ================= helpers ================= */
  const el = {};

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function catsWord(n) {
    if (n === 1) return 'فئة واحدة';
    if (n === 2) return 'فئتين';
    if (n <= 10) return `${ar(n)} فئات`;
    return `${ar(n)} فئة`;
  }
  function questionsWord(n) {
    if (n <= 10) return `${ar(n)} أسئلة`;
    return `${ar(n)} سؤالاً`;
  }
  function roundsWord(n) { return n === 2 ? 'جولتان' : n <= 10 ? `${ar(n)} جولات` : `${ar(n)} جولة`; }
  /* rough play time: the answer time plus about half a minute to pick, reveal and move on */
  function minutesWord(n) {
    if (n <= 2) return 'دقيقتين تقريباً';
    return n <= 10 ? `${ar(n)} دقائق تقريباً` : `${ar(n)} دقيقة تقريباً`;
  }
  const playMinutes = (st) => Math.max(1, Math.round((st.rounds * st.teams * (st.time + 30)) / 60 / 5) * 5);
  function poolSize() { return S.settings.cats.reduce((sum, id) => sum + (CAT[id] ? CAT[id].q.length : 0), 0); }
  /* keep the chosen number of rounds playable when categories or team count change */
  function fixRounds() {
    const st = S.settings;
    if (st.rounds * st.teams <= poolSize()) return;
    const ok = ROUND_OPTIONS.filter((n) => n * st.teams <= poolSize());
    st.rounds = ok.length ? ok[ok.length - 1] : ROUND_OPTIONS[0];
  }

  const G = () => S.game;
  const Q = () => (S.game ? S.game.q : null);
  const teamName = (i) => esc(S.game.teams[i].name);

  function unusedIdx(catId, d) {
    const used = (S.game.used[catId] || []);
    const out = [];
    CAT[catId].q.forEach((row, i) => { if (row[0] === d && !used.includes(i)) out.push(i); });
    return out;
  }
  function remaining(catId, d) {
    if (d) return unusedIdx(catId, d).length;
    return DIFFS.reduce((n, x) => n + unusedIdx(catId, x.d).length, 0);
  }
  function anyLeft() { return S.settings.cats.some((id) => remaining(id) > 0); }
  function pickIndex(catId, d) {
    const avail = unusedIdx(catId, d);
    if (!avail.length) return null;
    const fresh = avail.filter((i) => !S.seen[`${catId}:${i}`]);
    const from = fresh.length ? fresh : avail;
    return from[Math.floor(Math.random() * from.length)];
  }
  function markUsed(catId, idx) {
    (S.game.used[catId] = S.game.used[catId] || []).push(idx);
    S.seen[`${catId}:${idx}`] = 1;
  }
  function buildQ(catId, d, idx) {
    const row = CAT[catId].q[idx];
    const correctText = row[2];
    const options = shuffle(row.slice(2));
    return {
      id: `${catId}:${idx}`, cat: catId, d, text: row[1], options, correct: options.indexOf(correctText),
      selected: null, removed: [], struck: [], picked: null, phase: 'answer',
      timeLeft: S.settings.time, timeMax: S.settings.time,
      double: false, life: false, lifeUsed: false, shield: false, lie: null, rushBy: null,
      frozenBy: null, scrambleBy: null, scrambleOff: false, scrambleT: 0, order: [0, 1, 2, 3],
      fogBy: null, fogLeft: 0,
      stealer: null, stealPicked: null, stealOk: false, stealTimeout: false, outcome: null, won: 0
    };
  }
  function displayOrder(q) {
    return Array.isArray(q.order) && q.order.length === q.options.length ? q.order : q.options.map((_, i) => i);
  }
  function fogPx(q) {
    if (q.fogBy == null || !(q.fogLeft > 0) || q.phase !== 'answer') return 0;
    return 7 * (q.fogLeft / FOG_SECONDS);
  }

  function cardEnabled(id) { return S.settings.cards.includes(id); }
  function hasCard(ti, id) { return cardEnabled(id) && !S.game.teams[ti].used.includes(id); }
  function wrongLeft(q) {
    return q.options.filter((_, i) => i !== q.correct && !q.removed.includes(i) && !q.struck.includes(i)).length;
  }
  function stealers() {
    const g = G(), q = Q();
    if (!q || q.shield) return [];
    return g.teams.map((_, i) => i).filter((i) => i !== g.turn && hasCard(i, 'steal'));
  }

  function canUse(ti, id) {
    const g = G(), q = Q();
    const no = (why) => ({ ok: false, why });
    if (!cardEnabled(id)) return no('غير مفعّلة');
    if (g.teams[ti].used.includes(id)) return no('استُخدمت');
    if (S.screen !== 'question' || !q || q.phase !== 'answer') return no('أثناء السؤال فقط');
    if (CARDS[id].kind === 'help') {
      if (ti !== g.turn) return no('في دوركم فقط');
      if (q.frozenBy != null) return no('مجمّدة في هذا السؤال');
      if (id === 'double' && q.double) return no('مفعّلة الآن');
      if (id === 'fifty' && q.removed.length) return no('مفعّلة الآن');
      if (id === 'fifty' && wrongLeft(q) < 2) return no('لا تكفي الخيارات');
      if (id === 'life' && q.life) return no('مفعّلة الآن');
      if (id === 'shield' && q.shield) return no('مفعّل الآن');
      if (id === 'swap' && q.lie != null) return no('لا يمكن بعد الكذبة');
      if (id === 'swap' && !unusedIdx(q.cat, q.d).length) return no('لا يوجد سؤال بديل');
    } else {
      if (ti === g.turn) return no('في دور المنافسين');
      if (id === 'steal') return no('عند الخطأ');
      if (q.shield) return no('محميون بالدرع');
      if (q[SABOTAGE_FIELD[id]] != null) return no('استُخدمت على هذا السؤال');
      if ((id === 'rush' || id === 'fog') && q.timeLeft < 6) return no('الوقت قليل أصلاً');
    }
    return { ok: true };
  }

  function standings() {
    return S.game.teams.map((t, i) => ({ i, name: t.name, score: t.score })).sort((a, b) => b.score - a.score || a.i - b.i);
  }
  function activeTeam() {
    const q = Q();
    if (S.screen === 'question' && q && q.phase === 'steal') return q.stealer;
    return S.game.turn;
  }

  /* ================= sound ================= */
  let actx = null;
  function audio() {
    if (!actx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { actx = new C(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function tone(freq, dur, opt) {
    const o = Object.assign({ type: 'sine', gain: 0.07, at: 0, slide: null }, opt);
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + o.at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  function sfx(name) {
    if (!S.sound) return;
    switch (name) {
      case 'tap': tone(560, 0.06, { gain: 0.035 }); break;
      case 'tick': tone(980, 0.05, { gain: 0.045, type: 'triangle' }); break;
      case 'correct': tone(660, 0.14, { gain: 0.08 }); tone(990, 0.26, { gain: 0.08, at: 0.11 }); break;
      case 'wrong': tone(250, 0.34, { gain: 0.09, type: 'triangle', slide: 150 }); break;
      case 'card': tone(440, 0.08, { gain: 0.05 }); tone(660, 0.08, { gain: 0.05, at: 0.06 }); tone(880, 0.14, { gain: 0.05, at: 0.12 }); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { gain: 0.07, at: i * 0.12 })); break;
      default: break;
    }
  }

  /* ================= toast ================= */
  let toastTimer = null;
  function toast(msg) {
    el.toast.innerHTML = msg;
    el.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('on'), 2600);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    el.toast.classList.remove('on');
  }

  /* ================= view pieces ================= */
  function head(eyebrow, title) {
    return `<p class="eyebrow">${eyebrow}</p><h1 class="title">${title}</h1>`;
  }
  function pill(o) {
    const attrs = [
      `type="button"`,
      `class="pill ${o.cls || ''}"`,
      o.id != null ? `id="${o.act}-${esc(o.id)}"` : '',
      `data-act="${o.act}"`,
      o.id != null ? `data-id="${esc(o.id)}"` : '',
      o.pressed != null ? `aria-pressed="${o.pressed ? 'true' : 'false'}"` : '',
      o.disabled ? 'disabled' : ''
    ].join(' ');
    return `<button ${attrs}>${o.icon ? `<span class="pill-ic">${o.icon}</span>` : ''}<span dir="auto">${o.label}</span></button>`;
  }

  /* ---------- setup ---------- */
  function stepValid() {
    const st = S.settings;
    switch (STEPS[S.step].key) {
      case 'cats': return st.cats.length >= MIN_CATS;
      case 'rounds': return st.rounds * st.teams <= poolSize();
      default: return true;
    }
  }

  function viewSetup() {
    const st = S.settings;
    const step = STEPS[S.step];
    let body = '';
    if (step.key === 'cats') {
      const all = st.cats.length === CATS.length;
      body = `<div class="opts opts-wide">${CATS.map((c) => pill({ act: 'cat', id: c.id, label: c.name, pressed: st.cats.includes(c.id) })).join('')}</div>
        <p class="note">${st.cats.length < MIN_CATS
          ? `اختاروا ثلاث فئات أو أكثر${st.cats.length ? ` · اخترتم ${catsWord(st.cats.length)}` : ''}`
          : `اخترتم <b>${catsWord(st.cats.length)}</b> فيها ${questionsWord(poolSize())}`}
          &nbsp;·&nbsp; <button type="button" class="linkbtn" data-act="all-cats">${all ? 'إلغاء الكل' : 'اختيار الكل'}</button></p>`;
    } else if (step.key === 'teams') {
      body = `<div class="opts opts-3">${TEAM_OPTIONS.map((o) => pill({ act: 'teams', id: o.n, label: o.label, pressed: st.teams === o.n })).join('')}</div>
        <p class="note">الأفضل ٢ إلى ٤ أشخاص في الفريق. مثلاً ٣٠ شخصاً = ١٠ فرق من ٣ أشخاص.</p>`;
    } else if (step.key === 'names') {
      const fields = st.names.slice(0, st.teams).map((nm, i) =>
        `<label class="field"><span class="sr">اسم الفريق ${ar(i + 1)}</span><input class="pill-input" id="team-name-${i}" data-name="${i}" value="${esc(nm)}" maxlength="18" placeholder="الفريق ${ar(i + 1)}" autocomplete="off" enterkeyhint="next"></label>`).join('');
      body = `<div class="opts${st.teams > 4 ? ' short' : ''}">${fields}</div><p class="note">اكتبوا ما تشاؤون، أو اتركوا الأسماء كما هي.</p>`;
    } else if (step.key === 'time') {
      body = `<div class="opts">${TIME_OPTIONS.map((n) => pill({ act: 'time', id: n, label: `${ar(n)} ثانية`, pressed: st.time === n })).join('')}</div>
        <p class="note">يُحسب الوقت من لحظة ظهور السؤال، ويمكن زيادته ببطاقة الوقت الإضافي.</p>`;
    } else if (step.key === 'rounds') {
      const pool = poolSize();
      body = `<div class="opts opts-3">${ROUND_OPTIONS.map((n) => pill({ act: 'rounds', id: n, label: roundsWord(n), pressed: st.rounds === n, disabled: n * st.teams > pool })).join('')}</div>
        <p class="note">في كل جولة يجيب كل فريق عن سؤال واحد · المجموع <b>${questionsWord(st.rounds * st.teams)}</b> · مدة اللعب <b>${minutesWord(playMinutes(st))}</b></p>`;
    } else if (step.key === 'cards') {
      const hint = ui.cardHint && CARDS[ui.cardHint]
        ? `<b>${CARDS[ui.cardHint].name}:</b> ${CARDS[ui.cardHint].desc}`
        : 'كل فريق يستخدم كل بطاقة مرة واحدة فقط في اللعبة. اضغطوا على البطاقة لتفعيلها أو إلغائها.';
      const group = (ids) => ids.map((id) => pill({ act: 'card-toggle', id, label: CARDS[id].name, icon: ICON[id], pressed: st.cards.includes(id) })).join('');
      body = `<p class="group-label"><b>بطاقات المساعدة</b> · يستخدمها الفريق في دوره</p>
        <div class="opts opts-3 opts-tight">${group(HELP)}</div>
        <p class="group-label"><b>بطاقات التخريب</b> · يستخدمها المنافسون ضد الفريق الذي يجيب</p>
        <div class="opts opts-3 opts-tight">${group(SABOTAGE)}</div>
        <p class="note">${hint}</p>`;
    }
    return head(step.eyebrow, step.title) + body;
  }

  /* ---------- turn ---------- */
  function viewTurn() {
    const g = G();
    const st = S.settings;
    const pick = g.pick;
    const cats = st.cats.map((id) => pill({
      act: 'pick-cat', id, label: CAT[id].name, pressed: pick.cat === id, disabled: remaining(id) === 0
    })).join('');
    const diffs = DIFFS.map((x) => pill({
      act: 'pick-diff', id: x.d, label: `${x.name} <small>${ar(POINTS[x.d])} نقطة</small>`, pressed: pick.diff === x.d,
      disabled: pick.cat ? remaining(pick.cat, x.d) === 0 : false
    })).join('');
    const wide = st.cats.length > 4 ? 'opts-wide' : 'short';
    const sabo = SABOTAGE.some(cardEnabled) && g.round === 1
      ? '<p class="note">أثناء السؤال تستطيع الفرق الأخرى التخريب عليكم من زر «تخريب»، والدرع يحميكم.</p>'
      : '';
    return head(`الجولة ${ar(g.round)} من ${ar(st.rounds)} · دور <b>فريق ${teamName(g.turn)}</b>`, 'اختاروا فئة السؤال')
      + `<div class="opts ${wide}">${cats}</div>`
      + `<p class="group-label">ثم الصعوبة</p>`
      + `<div class="opts opts-3 opts-tight">${diffs}</div>`
      + sabo;
  }

  /* ---------- question ---------- */
  function optState(i) {
    const q = Q();
    if (q.phase === 'reveal') {
      if (i === q.correct) return 'is-correct';
      if (i === q.picked || i === q.stealPicked || q.struck.includes(i)) return 'is-wrong';
      if (q.removed.includes(i)) return 'is-removed';
      return 'is-dim';
    }
    if (q.removed.includes(i)) return 'is-removed';
    if (q.struck.includes(i) || i === q.picked) return 'is-wrong';
    return '';
  }

  function tagsHtml() {
    const q = Q();
    const t = [];
    if (q.double) t.push('<span class="tag">نقاط مضاعفة</span>');
    if (q.life && !q.lifeUsed) t.push('<span class="tag">فرصة ثانية جاهزة</span>');
    if (q.shield) t.push('<span class="tag">الدرع مفعّل</span>');
    if (q.lie != null) t.push(q.shield
      ? `<span class="tag is-off">كذبة فريق ${teamName(q.lie)} أُبطلت</span>`
      : `<span class="tag is-sabo">كذبة من فريق ${teamName(q.lie)}</span>`);
    if (q.rushBy != null) t.push(`<span class="tag is-sabo">استعجال من فريق ${teamName(q.rushBy)}</span>`);
    if (q.frozenBy != null) t.push(`<span class="tag is-sabo">تجميد من فريق ${teamName(q.frozenBy)}</span>`);
    if (q.scrambleBy != null) t.push(q.scrambleOff
      ? `<span class="tag is-off">خلط فريق ${teamName(q.scrambleBy)} أُبطل</span>`
      : `<span class="tag is-sabo">خلط من فريق ${teamName(q.scrambleBy)}</span>`);
    if (q.fogBy != null) t.push(q.fogOff
      ? `<span class="tag is-off">ضباب فريق ${teamName(q.fogBy)} أُبطل</span>`
      : `<span class="tag is-sabo">ضباب من فريق ${teamName(q.fogBy)}</span>`);
    return t.length ? `<div class="tags">${t.join('')}</div>` : '';
  }

  function revealText() {
    const g = G(), q = Q();
    const base = POINTS[q.d];
    if (q.outcome === 'correct') {
      let s = `<span class="ok">إجابة صحيحة</span> · ${ar(q.won)} نقطة لفريق <b>${teamName(g.turn)}</b>`;
      if (q.lie != null && !q.shield) s += ' · لم تنطلِ الكذبة';
      return s;
    }
    const lead = q.outcome === 'timeout' ? '<span class="no">انتهى الوقت</span>' : '<span class="no">إجابة خاطئة</span>';
    if (q.stealer != null) {
      return q.stealOk
        ? `${lead} · <span class="ok">سرقة ناجحة</span>، ${ar(base)} نقطة لفريق <b>${teamName(q.stealer)}</b>`
        : `${lead} · ${q.stealTimeout ? 'انتهى وقت' : 'فشلت'} سرقة فريق <b>${teamName(q.stealer)}</b>`;
    }
    if (q.lie != null && !q.shield) return `${lead} · نجحت الكذبة، ${ar(base)} نقطة لفريق <b>${teamName(q.lie)}</b>`;
    return `${lead} · لا نقاط هذه المرة`;
  }

  function viewQuestion() {
    const g = G(), q = Q();
    if (q.phase === 'lie') return viewLie();
    const cat = CAT[q.cat];
    const pts = POINTS[q.d] * (q.double ? 2 : 1);
    let eyebrow;
    if (q.phase === 'answer') eyebrow = `<b>فريق ${teamName(g.turn)}</b> · ${cat.name} · ${ar(pts)} نقطة`;
    else if (q.phase === 'stealOffer') eyebrow = `${q.outcome === 'timeout' ? '<span class="no">انتهى الوقت</span>' : '<span class="no">إجابة خاطئة</span>'} · فرصة للسرقة`;
    else if (q.phase === 'steal') eyebrow = `<b>فريق ${teamName(q.stealer)}</b> يحاول السرقة · ${ar(POINTS[q.d])} نقطة`;
    else eyebrow = revealText();

    const interactive = q.phase === 'answer' || q.phase === 'steal';
    const short = q.options.every((o) => o.length <= 16) ? 'short' : '';
    const opts = displayOrder(q).map((i) => {
      const state = optState(i);
      const locked = !interactive || state !== '';
      return `<button type="button" class="pill ${state}" id="opt-${i}" data-act="opt" data-id="${i}" aria-pressed="${q.selected === i ? 'true' : 'false'}" ${locked ? 'disabled' : ''}><span dir="auto">${esc(q.options[i])}</span></button>`;
    }).join('');
    const fog = fogPx(q);
    const fx = `${fog > 0 ? ' is-fog' : ''}${ui.shuffled ? ' is-shuffled' : ''}`;
    ui.shuffled = false;

    let below = '';
    if (q.phase === 'answer') below = cardChips();
    else if (q.phase === 'stealOffer') {
      below = `<p class="note">هل يريد فريق آخر سرقة السؤال؟ يجيب الفريق السارق عن نفس السؤال ويأخذ نقاطه إن أصاب.</p>
        <div class="actions">${stealers().map((i) => `<button type="button" class="chip is-hot" data-act="steal" data-id="${i}">${ICON.steal}<span>سرقة · ${teamName(i)}</span></button>`).join('')}</div>`;
    }

    return head(eyebrow, esc(q.text)) + tagsHtml()
      + `<div class="opts ${short}${fx}" id="answers" style="--fog:${fog.toFixed(2)}px">${opts}</div>` + below;
  }

  function cardChips() {
    const g = G();
    const helpCards = HELP.filter(cardEnabled);
    const saboCards = SABOTAGE.filter((id) => id !== 'steal' && cardEnabled(id));
    if (!helpCards.length && !saboCards.length) return '';
    const mine = helpCards.filter((id) => hasCard(g.turn, id)).length;
    const theirs = g.teams.reduce((n, _, i) => n + (i === g.turn ? 0 : saboCards.filter((id) => hasCard(i, id)).length), 0);
    let out = '<div class="actions">';
    if (helpCards.length) {
      out += `<button type="button" class="chip" data-act="sheet-mine" ${mine ? '' : 'disabled'}>${ICON.cards}<span>مساعدة ${teamName(g.turn)}</span><span class="chip-n">${ar(mine)}</span></button>`;
    }
    if (saboCards.length) {
      out += `<button type="button" class="chip is-hot" data-act="sheet-theirs" ${theirs ? '' : 'disabled'}>${ICON.rush}<span>تخريب</span><span class="chip-n">${ar(theirs)}</span></button>`;
    }
    return out + '</div>';
  }

  function viewLie() {
    const g = G(), q = Q();
    const liar = teamName(q.lie);
    return head(`بطاقة الكذبة · فريق ${liar}`, `يا فريق ${teamName(g.turn)}، أديروا وجوهكم عن الشاشة`)
      + `<p class="lead">على فريق <b>${liar}</b> وحده أن يضغط مطوّلاً على الزر ليرى الإجابة الصحيحة، ثم يحاول إقناعكم بإجابة قد تكون صحيحة وقد تكون كذبة. إن أخطأتم تذهب نقاط السؤال إليهم. الوقت متوقف الآن.</p>`
      + `<button type="button" class="pill peek" id="peek"><span class="peek-hide">اضغطوا مطوّلاً لكشف الإجابة</span><span class="peek-show" dir="auto">${esc(q.options[q.correct])}</span></button>`
      + '<p class="note">عندما تنتهون اضغطوا الزر البرتقالي للعودة إلى السؤال.</p>';
  }

  /* ---------- round & final ---------- */
  function boardHtml() {
    const st = standings();
    const top = st[0].score;
    return `<ol class="board${st.length > 5 ? ' is-many' : ''}">${st.map((t, n) => `<li class="board-row ${t.score === top && top > 0 ? 'is-lead' : ''}">
      <span class="board-n">${ar(n + 1)}</span><span class="board-name">${esc(t.name)}</span><span class="board-pts">${ar(t.score)} <small>نقطة</small></span></li>`).join('')}</ol>`;
  }
  function leaderLine() {
    const st = standings();
    const top = st[0].score;
    const leaders = st.filter((t) => t.score === top);
    if (top === 0) return 'لا نقاط بعد، والمنافسة مفتوحة';
    if (leaders.length > 1) return `تعادل في الصدارة بين ${leaders.map((t) => esc(t.name)).join(' و')}`;
    return `فريق ${esc(leaders[0].name)} في الصدارة`;
  }
  function viewRound() {
    const g = G();
    return head(`انتهت الجولة ${ar(g.round)} من ${ar(S.settings.rounds)}`, leaderLine()) + boardHtml();
  }
  function viewFinal() {
    const st = standings();
    const top = st[0].score;
    const winners = st.filter((t) => t.score === top);
    let title;
    if (winners.length === 1) title = `مبروك لفريق ${esc(winners[0].name)}!`;
    else if (winners.length === st.length) title = 'تعادل بين جميع الفرق!';
    else title = `تعادل بين ${winners.map((t) => esc(t.name)).join(' و')}`;
    return head('انتهت اللعبة', title) + boardHtml()
      + `<div class="final-actions">
          <button type="button" class="pill pill-solid" data-act="replay">العبوا مرة أخرى</button>
          <button type="button" class="pill" data-act="new-game">إعدادات جديدة</button>
        </div>`;
  }

  /* ---------- sheets ---------- */
  function cardRow(ti, id) {
    const c = CARDS[id];
    const used = S.game.teams[ti].used.includes(id);
    const chk = canUse(ti, id);
    const action = chk.ok
      ? `<button type="button" class="pill pill-sm" data-act="use" data-id="${id}" data-team="${ti}">استخدام</button>`
      : `<span class="row-state">${chk.why}</span>`;
    return `<li class="row ${used ? 'is-used' : ''}"><span class="row-ic">${ICON[id]}</span><span class="row-txt"><b>${c.name}</b><span>${c.desc}</span></span>${action}</li>`;
  }

  function sheetHtml(kind) {
    const g = G();
    if (kind === 'mine') {
      const ti = g.turn;
      const frozen = Q() && Q().frozenBy != null;
      return `<p class="eyebrow">كل بطاقة تُستخدم مرة واحدة في اللعبة · الوقت متوقف</p><h2 class="title" id="sheetTitle">بطاقات المساعدة لفريق ${teamName(ti)}</h2>
        ${frozen ? `<p class="lead">فريق <b>${teamName(Q().frozenBy)}</b> جمّد بطاقاتكم في هذا السؤال.</p>` : ''}
        <ul class="rows">${HELP.filter(cardEnabled).map((id) => cardRow(ti, id)).join('')}</ul>
        ${SABOTAGE.some(cardEnabled) ? '<p class="note">بطاقات التخريب الخاصة بكم تستخدمونها من زر «تخريب» أثناء دور فريق آخر.</p>' : ''}`;
    }
    if (kind === 'theirs') {
      const others = g.teams.map((_, i) => i).filter((i) => i !== g.turn);
      const ids = SABOTAGE.filter(cardEnabled);
      const teamBlock = (i) => `<p class="sheet-team">فريق <b>${teamName(i)}</b> يخرّب بـ</p>
        <div class="opts opts-3 opts-tight sabo">${ids.map((id) => {
          const chk = canUse(i, id);
          const used = g.teams[i].used.includes(id);
          return `<button type="button" class="pill pill-sm ${used ? 'is-used' : ''}" data-act="use" data-id="${id}" data-team="${i}" ${chk.ok ? '' : 'disabled'} title="${esc(chk.ok ? CARDS[id].desc : chk.why)}"><span class="pill-ic">${ICON[id]}</span><span>${CARDS[id].name}${chk.ok ? '' : `<small>${chk.why}</small>`}</span></button>`;
        }).join('')}</div>`;
      /* with many teams, pick the saboteur first so the list stays short */
      const pickFirst = others.length >= 3;
      const canSabotage = (i) => ids.some((id) => canUse(i, id).ok);
      const chooser = `<p class="sheet-team">من الفريق الذي يخرّب؟</p>
        <div class="opts opts-3 opts-tight sabo">${others.map((i) => pill({ act: 'sabo-team', id: i, label: teamName(i), pressed: ui.saboTeam === i, cls: 'pill-sm', disabled: !canSabotage(i) })).join('')}</div>
        ${ui.saboTeam != null && others.includes(ui.saboTeam) ? teamBlock(ui.saboTeam) : ''}`;
      return `<p class="eyebrow">ضد فريق ${teamName(g.turn)} · الوقت متوقف</p><h2 class="title" id="sheetTitle">التخريب</h2>
        <p class="lead">${pickFirst ? 'اختاروا الفريق الذي يخرّب، ثم بطاقته.' : 'الفريق الذي يريد التخريب يضغط على بطاقته.'} لكل نوع بطاقة واحدة فقط في السؤال.</p>
        ${pickFirst ? chooser : others.map(teamBlock).join('')}
        <h3>ماذا تفعل كل بطاقة؟</h3>
        <ul class="legend">${ids.map((id) => `<li><b>${CARDS[id].name}:</b> ${CARDS[id].desc}</li>`).join('')}</ul>`;
    }
    if (kind === 'scores') {
      const sub = S.screen === 'setup' ? '' : `الجولة ${ar(g.round)} من ${ar(S.settings.rounds)}`;
      return `<p class="eyebrow">${sub}</p><h2 class="title" id="sheetTitle">النتائج</h2>${boardHtml()}`;
    }
    if (kind === 'new') {
      return `<p class="eyebrow">لعبة جديدة</p><h2 class="title" id="sheetTitle">هل تريدون إنهاء هذه اللعبة؟</h2>
        <p class="lead">ستُحذف نقاط الفرق الحالية وتعودون إلى اختيار الفئات.</p>
        <div class="final-actions"><button type="button" class="pill pill-solid" data-act="confirm-new">نعم، لعبة جديدة</button><button type="button" class="pill" data-act="close">متابعة اللعبة</button></div>`;
    }
    if (kind === 'rules') {
      const rules = [
        'اختاروا الفئات وعدد الفرق وأسماءها والوقت وعدد الجولات.',
        'في كل جولة يجيب كل فريق عن سؤال واحد بالدور.',
        'الفريق صاحب الدور يختار الفئة والصعوبة: <b>سهل ١٠٠</b>، <b>متوسط ٢٠٠</b>، <b>صعب ٣٠٠</b> نقطة.',
        'اختاروا إجابة ثم اضغطوا الزر البرتقالي لتأكيدها قبل انتهاء الوقت.',
        'أثناء السؤال تستطيع الفرق الأخرى التخريب من زر «تخريب».',
        'لا تُخصم نقاط عند الخطأ، لكن قد يسرق فريق آخر السؤال.',
        'الفريق صاحب أعلى نقاط بعد آخر جولة هو الفائز.'
      ];
      const rows = (ids) => ids.map((id) => `<li class="row"><span class="row-ic">${ICON[id]}</span><span class="row-txt"><b>${CARDS[id].name}</b><span>${CARDS[id].desc}</span></span></li>`).join('');
      return `<p class="eyebrow">دليل سريع</p><h2 class="title" id="sheetTitle">طريقة اللعب</h2>
        <ol class="rules">${rules.map((r, i) => `<li><span>${ar(i + 1)}</span><span>${r}</span></li>`).join('')}</ol>
        <h3>بطاقات المساعدة · في دوركم</h3>
        <ul class="rows">${rows(HELP)}</ul>
        <h3>بطاقات التخريب · ضد الفريق الذي يجيب</h3>
        <ul class="rows">${rows(SABOTAGE)}</ul>
        ${window.LAMMA_NO_PDF ? '' : '<p class="note"><a class="linkbtn" href="questions.pdf" target="_blank" rel="noopener">تحميل كل الأسئلة مع الإجابات (PDF)</a></p>'}`;
    }
    return '';
  }

  function menuHtml() {
    const inGame = S.screen !== 'setup';
    return `${inGame ? `<button type="button" role="menuitem" data-act="scores"><span>النتائج</span>${ICON.board.replace('<svg', '<svg width="18" height="18"')}</button>` : ''}
      <button type="button" role="menuitem" data-act="rules"><span>طريقة اللعب</span></button>
      <button type="button" role="menuitem" data-act="sound"><span>الصوت</span><span class="muted">${S.sound ? 'يعمل' : 'متوقف'}</span></button>
      <button type="button" role="menuitem" data-act="${inGame ? 'ask-new' : 'new-game'}"><span>لعبة جديدة</span></button>`;
  }

  /* ================= chrome & render ================= */
  function goState() {
    const g = G(), q = Q();
    switch (S.screen) {
      case 'setup': return { enabled: stepValid(), label: S.step === STEPS.length - 1 ? 'ابدأ اللعب' : 'التالي' };
      case 'turn': return { enabled: !!(g.pick.cat && g.pick.diff), label: 'اعرض السؤال' };
      case 'question':
        if (q.phase === 'answer' || q.phase === 'steal') return { enabled: q.selected != null, label: 'تأكيد الإجابة', timer: true };
        if (q.phase === 'lie') return { enabled: true, label: 'رجوع للسؤال' };
        if (q.phase === 'stealOffer') return { enabled: true, label: 'اكشف الإجابة' };
        if (g.turn === g.teams.length - 1) return { enabled: true, label: g.round >= S.settings.rounds ? 'النتيجة النهائية' : 'نتائج الجولة' };
        return { enabled: true, label: 'السؤال التالي' };
      case 'round': return { enabled: true, label: 'الجولة التالية' };
      default: return { hidden: true };
    }
  }

  function progress() {
    if (S.screen === 'setup') return (S.step + 1) / STEPS.length;
    const g = G();
    if (S.screen === 'final') return 1;
    let done = g.done;
    if (S.screen === 'question' && Q().phase === 'reveal') done += 1;
    return Math.min(1, done / g.total);
  }

  function renderChrome() {
    const g = G();
    const inGame = S.screen !== 'setup' && g;

    el.scores.hidden = !inGame;
    if (inGame) {
      const active = activeTeam();
      el.scores.classList.toggle('is-many', g.teams.length > 5);
      el.scores.innerHTML = g.teams.map((t, i) => `<span class="score ${i === active && S.screen !== 'final' && S.screen !== 'round' ? 'is-turn' : ''}"><span>${esc(t.name)}</span><span class="score-pts">${ar(t.score)}</span></span>`).join('');
    }

    if (S.screen === 'setup') {
      el.back.innerHTML = `${ICON.back}<span>رجوع</span>`;
      el.back.dataset.act = 'back';
      el.back.classList.toggle('is-ghost', S.step === 0);
      el.back.disabled = S.step === 0;
    } else {
      el.back.innerHTML = `${ICON.board}<span>النتائج</span>`;
      el.back.dataset.act = 'scores';
      el.back.classList.remove('is-ghost');
      el.back.disabled = false;
    }

    const gs = goState();
    el.halo.hidden = !!gs.hidden;
    el.go.disabled = !gs.enabled;
    el.go.setAttribute('aria-label', gs.label || '');
    el.goLabel.textContent = gs.label || '';
    el.ring.style.visibility = gs.timer ? 'visible' : 'hidden';
    if (!gs.timer) { el.clock.innerHTML = ''; el.clock.className = 'clock'; el.halo.classList.remove('is-low'); }
    else updateTimer();

    el.bar.style.width = `${(progress() * 100).toFixed(2)}%`;
  }

  function renderSheet() {
    el.sheet.hidden = !ui.sheet;
    if (ui.sheet) el.sheetBody.innerHTML = sheetHtml(ui.sheet);
    el.menu.hidden = !ui.menu;
    el.burger.setAttribute('aria-expanded', ui.menu ? 'true' : 'false');
    if (ui.menu) el.menu.innerHTML = menuHtml();
  }

  function viewKey() {
    const q = Q();
    return [S.screen, S.step, S.screen === 'question' && q ? q.id : '', S.screen === 'question' && q && q.phase === 'lie' ? 'lie' : ''].join('|');
  }

  function render() {
    let html = '';
    switch (S.screen) {
      case 'setup': html = viewSetup(); break;
      case 'turn': html = viewTurn(); break;
      case 'question': html = viewQuestion(); break;
      case 'round': html = viewRound(); break;
      case 'final': html = viewFinal(); break;
      default: html = '';
    }
    const active = document.activeElement;
    const focusId = active && active.id && el.view.contains(active) ? active.id : null;
    el.view.innerHTML = html;
    el.view.dataset.screen = S.screen;
    const key = viewKey();
    if (key !== ui.lastKey) {
      el.view.classList.remove('enter');
      void el.view.offsetWidth;
      el.view.classList.add('enter');
      ui.lastKey = key;
    } else if (focusId) {
      const again = document.getElementById(focusId);
      if (again) again.focus();
    }
    renderChrome();
    renderSheet();
    save();
  }

  /* ================= timer ================= */
  let lastTick = performance.now();
  function timing() {
    const q = Q();
    return S.screen === 'question' && q && (q.phase === 'answer' || q.phase === 'steal') && !ui.sheet && !ui.menu && !document.hidden;
  }
  function updateTimer() {
    const q = Q();
    if (!q) return;
    const secs = Math.ceil(q.timeLeft);
    const frac = q.timeMax > 0 ? Math.max(0, Math.min(1, q.timeLeft / q.timeMax)) : 0;
    el.ringFill.style.strokeDashoffset = String(100 - frac * 100);
    const low = secs <= 5;
    el.halo.classList.toggle('is-low', low);
    el.clock.className = `clock${low ? ' is-low' : ''}`;
    el.clock.innerHTML = `<span class="clock-n">${ar(secs)}</span><span class="clock-l">ثانية</span>`;
  }
  function tick() {
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    if (!timing()) return;
    const q = Q();
    const before = Math.ceil(q.timeLeft);
    /* round to the millisecond so repeated 0.2s steps land exactly on whole seconds */
    q.timeLeft = Math.max(0, Math.round((q.timeLeft - dt) * 1000) / 1000);
    const after = Math.ceil(q.timeLeft);
    if (after !== before) {
      if (after > 0 && after <= 5) sfx('tick');
      save();
    }
    updateTimer();
    if (q.phase === 'answer') {
      if (q.fogBy != null && q.fogLeft > 0) {
        q.fogLeft = Math.max(0, Math.round((q.fogLeft - dt) * 1000) / 1000);
        const box = document.getElementById('answers');
        if (box) {
          const px = fogPx(q);
          box.style.setProperty('--fog', `${px.toFixed(2)}px`);
          box.classList.toggle('is-fog', px > 0);
        }
      }
      if (q.scrambleBy != null && !q.scrambleOff && q.timeLeft > 0) {
        q.scrambleT += dt;
        if (q.scrambleT >= SCRAMBLE_EVERY) {
          q.scrambleT = 0;
          reshuffle(q);
          render();
        }
      }
    }
    if (q.timeLeft <= 0) timeUp();
  }
  function reshuffle(q) {
    const cur = displayOrder(q);
    let next = cur.slice();
    for (let n = 0; n < 6 && next.join() === cur.join(); n++) next = shuffle(cur.slice());
    q.order = next;
    ui.shuffled = true;
  }
  function timeUp() {
    const q = Q();
    if (q.phase === 'answer') {
      q.selected = null;
      failMain('timeout');
    } else if (q.phase === 'steal') {
      q.selected = null;
      q.stealOk = false;
      q.stealTimeout = true;
      q.phase = 'reveal';
      sfx('wrong');
      render();
    }
  }

  /* ================= game flow ================= */
  function startGame() {
    const st = S.settings;
    const names = st.names.slice(0, st.teams).map((n, i) => (n || '').trim() || DEFAULT_NAMES[i]);
    S.game = {
      teams: names.map((name) => ({ name, score: 0, used: [] })),
      round: 1, turn: 0, done: 0, total: st.rounds * st.teams,
      used: {}, pick: { cat: null, diff: null }, q: null
    };
    S.screen = 'turn';
    sfx('card');
    render();
  }

  function openQuestion() {
    const g = G();
    const { cat, diff } = g.pick;
    if (!cat || !diff) return;
    const idx = pickIndex(cat, diff);
    if (idx == null) { toast('لا توجد أسئلة متبقية بهذه الصعوبة'); return; }
    markUsed(cat, idx);
    g.q = buildQ(cat, diff, idx);
    S.screen = 'question';
    lastTick = performance.now();
    render();
  }

  function confirmAnswer() {
    const g = G(), q = Q();
    if (q.selected == null) return;
    const sel = q.selected;
    q.selected = null;
    if (q.phase === 'steal') {
      q.stealOk = sel === q.correct;
      if (q.stealOk) { g.teams[q.stealer].score += POINTS[q.d]; sfx('correct'); }
      else { q.stealPicked = sel; sfx('wrong'); }
      q.phase = 'reveal';
      render();
      return;
    }
    if (sel === q.correct) {
      q.won = POINTS[q.d] * (q.double ? 2 : 1);
      g.teams[g.turn].score += q.won;
      q.outcome = 'correct';
      q.phase = 'reveal';
      sfx('correct');
      render();
      return;
    }
    if (q.life && !q.lifeUsed) {
      q.lifeUsed = true;
      q.struck.push(sel);
      sfx('wrong');
      toast('إجابة خاطئة، لكن معكم فرصة ثانية');
      render();
      return;
    }
    q.picked = sel;
    failMain('wrong');
  }

  function failMain(kind) {
    const g = G(), q = Q();
    q.outcome = kind;
    sfx('wrong');
    if (q.lie != null && !q.shield) {
      g.teams[q.lie].score += POINTS[q.d];
      q.phase = 'reveal';
    } else if (stealers().length) {
      q.phase = 'stealOffer';
    } else {
      q.phase = 'reveal';
    }
    render();
  }

  function startSteal(ti) {
    const g = G(), q = Q();
    if (q.phase !== 'stealOffer' || !stealers().includes(ti)) return;
    g.teams[ti].used.push('steal');
    q.stealer = ti;
    q.phase = 'steal';
    q.selected = null;
    q.timeLeft = q.timeMax = Math.max(STEAL_MIN_TIME, Math.round(S.settings.time / 2));
    lastTick = performance.now();
    sfx('card');
    toast(`فريق ${teamName(ti)} يحاول السرقة`);
    render();
  }

  function nextTurn() {
    const g = G();
    hideToast();
    g.done += 1;
    g.q = null;
    g.pick = { cat: null, diff: null };
    g.turn += 1;
    if (g.turn >= g.teams.length) {
      g.turn = 0;
      S.screen = g.round >= S.settings.rounds ? 'final' : 'round';
    } else {
      S.screen = 'turn';
    }
    if (S.screen === 'turn' && !anyLeft()) S.screen = 'final';
    if (S.screen === 'final') finishGame();
    render();
  }

  function finishGame() {
    sfx('win');
    setTimeout(confetti, 200);
  }

  function useCard(ti, id) {
    const g = G(), q = Q();
    const chk = canUse(ti, id);
    if (!chk.ok) return;
    g.teams[ti].used.push(id);
    ui.sheet = null;
    switch (id) {
      case 'time':
        q.timeLeft += EXTRA_TIME;
        q.timeMax = Math.max(q.timeMax, q.timeLeft);
        toast('أُضيفت ١٥ ثانية');
        break;
      case 'double':
        q.double = true;
        toast('نقاط هذا السؤال مضاعفة');
        break;
      case 'fifty': {
        const cand = shuffle(q.options.map((_, i) => i).filter((i) => i !== q.correct && !q.removed.includes(i) && !q.struck.includes(i)));
        q.removed.push(...cand.slice(0, Math.min(2, cand.length - 1)));
        if (q.removed.includes(q.selected)) q.selected = null;
        toast('حُذفت إجابات خاطئة');
        break;
      }
      case 'life':
        q.life = true;
        toast('إن أخطأتم فلديكم محاولة ثانية');
        break;
      case 'swap': {
        const idx = pickIndex(q.cat, q.d);
        if (idx == null) break;
        markUsed(q.cat, idx);
        /* help effects carry over; rush, scramble and fog stay with the old question */
        const keep = { double: q.double, life: q.life, lifeUsed: q.lifeUsed, shield: q.shield };
        g.q = Object.assign(buildQ(q.cat, q.d, idx), keep);
        toast('سؤال جديد، والوقت من البداية');
        break;
      }
      case 'shield': {
        q.shield = true;
        const undone = [];
        if (q.lie != null) undone.push('الكذبة');
        if (q.scrambleBy != null) { q.scrambleOff = true; undone.push('الخلط'); }
        if (q.fogBy != null) { q.fogLeft = 0; q.fogOff = true; undone.push('الضباب'); }
        toast(undone.length ? `الدرع أبطل ${undone.join(' و')}` : 'الدرع يمنع التخريب عنكم في هذا السؤال');
        break;
      }
      case 'lie':
        q.lie = ti;
        q.phase = 'lie';
        break;
      case 'rush':
        q.rushBy = ti;
        q.timeLeft = Math.max(3, Math.ceil(q.timeLeft / 2));
        toast(`فريق ${teamName(ti)} استعجلكم: نصف الوقت فقط`);
        break;
      case 'freeze':
        q.frozenBy = ti;
        toast(`فريق ${teamName(ti)} جمّد بطاقات المساعدة`);
        break;
      case 'scramble':
        q.scrambleBy = ti;
        q.scrambleT = 0;
        reshuffle(q);
        toast(`فريق ${teamName(ti)} خلط الإجابات`);
        break;
      case 'fog':
        q.fogBy = ti;
        q.fogLeft = FOG_SECONDS;
        toast(`فريق ${teamName(ti)} أطلق الضباب`);
        break;
      default: break;
    }
    sfx('card');
    lastTick = performance.now();
    render();
  }

  function go() {
    const gs = goState();
    if (gs.hidden || !gs.enabled) return;
    switch (S.screen) {
      case 'setup':
        sfx('tap');
        if (S.step < STEPS.length - 1) { S.step += 1; ui.cardHint = null; render(); } else startGame();
        break;
      case 'turn':
        sfx('tap');
        openQuestion();
        break;
      case 'question': {
        const q = Q();
        if (q.phase === 'answer' || q.phase === 'steal') confirmAnswer();
        else if (q.phase === 'lie') { q.phase = 'answer'; lastTick = performance.now(); sfx('tap'); render(); }
        else if (q.phase === 'stealOffer') { q.phase = 'reveal'; sfx('tap'); render(); }
        else if (q.phase === 'reveal') { sfx('tap'); nextTurn(); }
        break;
      }
      case 'round':
        sfx('tap');
        G().round += 1;
        S.screen = anyLeft() ? 'turn' : 'final';
        if (S.screen === 'final') finishGame();
        render();
        break;
      default: break;
    }
  }

  function newGame() {
    hideToast();
    S.game = null;
    S.screen = 'setup';
    S.step = 0;
    ui.sheet = null;
    ui.menu = false;
    render();
  }

  /* ================= events ================= */
  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (ui.menu && !e.target.closest('#menu') && !e.target.closest('#burger')) { ui.menu = false; renderSheet(); }
    if (!t || t.disabled) return;
    const act = t.dataset.act;
    const id = t.dataset.id;
    const st = S.settings;
    switch (act) {
      case 'cat': {
        const i = st.cats.indexOf(id);
        if (i >= 0) st.cats.splice(i, 1); else st.cats.push(id);
        st.cats.sort((a, b) => CATS.findIndex((c) => c.id === a) - CATS.findIndex((c) => c.id === b));
        fixRounds();
        sfx('tap'); render(); break;
      }
      case 'all-cats':
        st.cats = st.cats.length === CATS.length ? [] : CATS.map((c) => c.id);
        fixRounds();
        sfx('tap'); render(); break;
      case 'teams':
        st.teams = Number(id);
        fixRounds();
        sfx('tap'); render(); break;
      case 'time': st.time = Number(id); sfx('tap'); render(); break;
      case 'rounds': st.rounds = Number(id); sfx('tap'); render(); break;
      case 'card-toggle': {
        const i = st.cards.indexOf(id);
        if (i >= 0) st.cards.splice(i, 1); else st.cards.push(id);
        st.cards.sort((a, b) => CARD_ORDER.indexOf(a) - CARD_ORDER.indexOf(b));
        ui.cardHint = id;
        sfx('tap'); render(); break;
      }
      case 'back':
        if (S.screen === 'setup' && S.step > 0) { S.step -= 1; ui.cardHint = null; sfx('tap'); render(); }
        break;
      case 'pick-cat': {
        const g = G();
        g.pick.cat = id;
        if (g.pick.diff && remaining(id, g.pick.diff) === 0) g.pick.diff = null;
        sfx('tap'); render(); break;
      }
      case 'pick-diff': G().pick.diff = Number(id); sfx('tap'); render(); break;
      case 'opt': {
        const q = Q();
        if (!q || (q.phase !== 'answer' && q.phase !== 'steal')) break;
        q.selected = Number(id);
        sfx('tap'); render(); break;
      }
      case 'sheet-mine': ui.sheet = 'mine'; sfx('tap'); render(); break;
      case 'sheet-theirs': ui.sheet = 'theirs'; ui.saboTeam = null; sfx('tap'); render(); break;
      case 'sabo-team': ui.saboTeam = Number(id); sfx('tap'); renderSheet(); break;
      case 'use': useCard(Number(t.dataset.team), id); break;
      case 'steal': startSteal(Number(id)); break;
      case 'close': ui.sheet = null; lastTick = performance.now(); render(); break;
      case 'menu': ui.menu = !ui.menu; renderSheet(); break;
      case 'scores': if (S.game) { ui.menu = false; ui.sheet = 'scores'; render(); } break;
      case 'rules': ui.menu = false; ui.sheet = 'rules'; render(); break;
      case 'sound': S.sound = !S.sound; save(); renderSheet(); if (S.sound) sfx('tap'); break;
      case 'ask-new': ui.menu = false; ui.sheet = 'new'; render(); break;
      case 'confirm-new':
      case 'new-game': newGame(); break;
      case 'replay': ui.sheet = null; startGame(); break;
      default: break;
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.matches('[data-name]')) {
      S.settings.names[Number(t.dataset.name)] = t.value;
      save();
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      if (ui.menu) { ui.menu = false; renderSheet(); return; }
      if (ui.sheet) { ui.sheet = null; lastTick = performance.now(); render(); return; }
    }
    if (ui.sheet || ui.menu) return;
    const tag = e.target && e.target.tagName;
    if (e.key === 'Enter') {
      if (tag === 'BUTTON') return;
      if (tag === 'INPUT') {
        const inputs = Array.from(el.view.querySelectorAll('input'));
        const i = inputs.indexOf(e.target);
        if (i >= 0 && i < inputs.length - 1) { e.preventDefault(); inputs[i + 1].focus(); return; }
      }
      e.preventDefault();
      go();
      return;
    }
    if (tag === 'INPUT') return;
    const map = { '1': 0, '2': 1, '3': 2, '4': 3, '١': 0, '٢': 1, '٣': 2, '٤': 3 };
    if (S.screen === 'question' && map[e.key] != null) {
      const i = displayOrder(Q())[map[e.key]];
      const btn = el.view.querySelector(`[data-act="opt"][data-id="${i}"]`);
      if (btn && !btn.disabled) btn.click();
    }
  }

  function setPeek(on) {
    const p = document.getElementById('peek');
    if (p) p.classList.toggle('on', on);
  }

  /* ================= confetti ================= */
  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const card = el.card;
    const cs = getComputedStyle(document.documentElement);
    const colors = ['--orange', '--ink', '--hair-2', '--orange-deep'].map((v) => cs.getPropertyValue(v).trim() || '#f7951d');
    const c = document.createElement('canvas');
    c.className = 'confetti';
    const w = card.clientWidth, h = card.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr; c.height = h * dpr;
    card.appendChild(c);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const parts = Array.from({ length: 110 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: h * 0.42,
      vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 9 - 4,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      s: 5 + Math.random() * 6, col: colors[Math.floor(Math.random() * colors.length)]
    }));
    const t0 = performance.now();
    (function frame(now) {
      const t = now - t0;
      ctx.clearRect(0, 0, w, h);
      parts.forEach((p) => {
        p.vy += 0.22; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.globalAlpha = Math.max(0, 1 - t / 2800);
        ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      });
      if (t < 2800) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  /* ================= boot ================= */
  function boot(data) {
    document.documentElement.setAttribute('lang', 'ar');
    document.documentElement.setAttribute('dir', 'rtl');
    ['card', 'view', 'scores', 'back', 'halo', 'go', 'goLabel', 'clock', 'bar', 'ring', 'ringFill', 'menu', 'sheet', 'sheetBody', 'toast', 'burger']
      .forEach((id) => { el[id] = document.getElementById(id); });

    S = normalize(data && data.settings ? data : load());

    el.card.addEventListener('click', onClick);
    el.card.addEventListener('input', onInput);
    el.go.addEventListener('click', go);
    document.addEventListener('keydown', onKey);
    el.card.addEventListener('pointerdown', (e) => { if (e.target.closest('#peek')) { e.preventDefault(); setPeek(true); } });
    ['pointerup', 'pointercancel', 'blur'].forEach((ev) => window.addEventListener(ev, () => setPeek(false)));
    el.card.addEventListener('contextmenu', (e) => { if (e.target.closest('#peek')) e.preventDefault(); });
    el.card.addEventListener('keydown', (e) => { if (e.target.id === 'peek' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.stopPropagation(); setPeek(true); } });
    el.card.addEventListener('keyup', (e) => { if (e.target.id === 'peek') setPeek(false); });
    document.addEventListener('visibilitychange', () => { lastTick = performance.now(); });

    render();
    setInterval(tick, 200);
  }

  if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === 'function') {
    window.claude.hot.snapshot(() => S);
  }
  if (window.claude && window.claude.hot && typeof window.claude.hot.ready === 'function') {
    window.claude.hot.ready(boot);
  } else {
    boot((window.claude && window.claude.hot && window.claude.hot.data) || {});
  }
})();
