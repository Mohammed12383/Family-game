/*
  Automated tests for مسابقة عودة ازدهار.
  Run:  npm install && npx playwright install chromium && npm test
  Each test opens the real game in a headless browser, plays it through the UI,
  and checks the saved game state. Timers use a fake clock so they run instantly.
*/
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const ALL_CARDS = ['time', 'double', 'fifty', 'life', 'swap', 'shield', 'lie', 'rush', 'freeze', 'scramble', 'fog', 'steal'];

let server;
let browser;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}/index.html`;
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  server.close();
});

/* ---------- helpers ---------- */
async function open({ viewport = { width: 1280, height: 860 }, motion = 'reduce' } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: motion });
  await context.clock.install();
  // the font comes from Google Fonts; tests don't need it and must not depend on the network
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return { page, context, errors };
}

const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('lamma-family-v1')));
const q = async (page) => (await state(page)).game.q;
const wrongOf = (qq) => [0, 1, 2, 3].find((i) => i !== qq.correct && !qq.removed.includes(i) && !qq.struck.includes(i));

async function setup(page, { cats = ['general', 'geo', 'islamic'], teams = 2, names, time = 30, rounds = 4, cards = ALL_CARDS } = {}) {
  for (const c of cats) await page.click(`[data-act="cat"][data-id="${c}"]`);
  await page.click('#go');
  await page.click(`[data-act="teams"][data-id="${teams}"]`);
  await page.click('#go');
  if (names) for (let i = 0; i < names.length; i++) await page.fill(`#team-name-${i}`, names[i]);
  await page.click('#go');
  await page.click(`[data-act="time"][data-id="${time}"]`);
  await page.click('#go');
  await page.click(`[data-act="rounds"][data-id="${rounds}"]`);
  await page.click('#go');
  for (const id of ALL_CARDS) {
    const on = (await page.getAttribute(`[data-act="card-toggle"][data-id="${id}"]`, 'aria-pressed')) === 'true';
    if (on !== cards.includes(id)) await page.click(`[data-act="card-toggle"][data-id="${id}"]`);
  }
  await page.click('#go');
}

async function openQuestion(page, { cat, diff = 1 } = {}) {
  await page.click(cat ? `[data-act="pick-cat"][data-id="${cat}"]` : '[data-act="pick-cat"]:not([disabled])');
  await page.click(`[data-act="pick-diff"][data-id="${diff}"]`);
  await page.click('#go');
  return q(page);
}

async function choose(page, i) {
  await page.click(`#opt-${i}`);
  await page.click('#go');
}

async function useHelp(page, id) {
  await page.click('[data-act="sheet-mine"]');
  await page.click(`[data-act="use"][data-id="${id}"]`);
}

async function useSabotage(page, team, id) {
  await page.click('[data-act="sheet-theirs"]');
  await page.click(`[data-act="use"][data-id="${id}"][data-team="${team}"]`);
}

/* ---------- question bank ---------- */
test('question bank: every question has 4 different answers and a valid difficulty', () => {
  const sandbox = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'assets/questions.js'), 'utf8'))(sandbox);
  const data = sandbox.LAMMA_DATA;
  assert.ok(data.length >= 3, 'at least three categories');
  const texts = new Set();
  for (const cat of data) {
    const per = { 1: 0, 2: 0, 3: 0 };
    for (const row of cat.q) {
      assert.equal(row.length, 6, `${cat.id}: "${row[1]}" must have a question and 4 answers`);
      assert.ok([1, 2, 3].includes(row[0]), `${cat.id}: "${row[1]}" has difficulty ${row[0]}`);
      assert.equal(new Set(row.slice(2)).size, 4, `${cat.id}: "${row[1]}" repeats an answer`);
      assert.ok(row.slice(1).every((s) => typeof s === 'string' && s.trim()), `${cat.id}: "${row[1]}" has an empty field`);
      assert.ok(!texts.has(row[1]), `duplicate question: "${row[1]}"`);
      texts.add(row[1]);
      per[row[0]] += 1;
    }
    for (const d of [1, 2, 3]) assert.ok(per[d] >= 5, `${cat.id} needs at least 5 questions of difficulty ${d}`);
  }
});

/* ---------- setup ---------- */
test('setup: you need at least three categories to continue', async () => {
  const { page, context, errors } = await open();
  await page.click('[data-act="cat"][data-id="general"]');
  await page.click('[data-act="cat"][data-id="geo"]');
  assert.equal(await page.isDisabled('#go'), true);
  await page.click('[data-act="cat"][data-id="tech"]');
  assert.equal(await page.isDisabled('#go'), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('setup: round counts that need more questions than you picked are disabled', async () => {
  const { page, context, errors } = await open();
  for (const c of ['general', 'geo', 'islamic']) await page.click(`[data-act="cat"][data-id="${c}"]`); // 45 questions
  await page.click('#go');
  await page.click('[data-act="teams"][data-id="5"]');
  for (let i = 0; i < 3; i++) await page.click('#go');
  assert.equal(await page.isDisabled('[data-act="rounds"][data-id="10"]'), true, '10 rounds x 5 teams = 50 > 45');
  assert.equal(await page.isDisabled('[data-act="rounds"][data-id="8"]'), false, '8 rounds x 5 teams = 40');
  assert.equal(await page.isDisabled('#go'), false, 'the chosen round count is adjusted to a playable one');
  assert.deepEqual(errors, []);
  await context.close();
});

test('setup: help and sabotage cards are shown as two groups', async () => {
  const { page, context, errors } = await open();
  for (const c of ['general', 'geo', 'islamic']) await page.click(`[data-act="cat"][data-id="${c}"]`);
  for (let i = 0; i < 5; i++) await page.click('#go');
  const labels = await page.$$eval('.group-label b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(labels, ['بطاقات المساعدة', 'بطاقات التخريب']);
  assert.equal(await page.locator('[data-act="card-toggle"]').count(), ALL_CARDS.length);
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------- a whole game ---------- */
test('full game: points follow the difficulty and the game ends after rounds x teams questions', async () => {
  const { page, context, errors } = await open();
  await setup(page, { teams: 2, rounds: 4 });
  const expected = [0, 0];
  for (let turn = 0; turn < 8; turn++) {
    const diff = (turn % 3) + 1;
    const qq = await openQuestion(page, { diff });
    await choose(page, qq.correct);
    expected[turn % 2] += diff * 100;
    await page.click('#go'); // next question / round results
    const s = await state(page);
    if (s.screen === 'round') await page.click('#go');
  }
  const s = await state(page);
  assert.equal(s.screen, 'final');
  assert.deepEqual(s.game.teams.map((t) => t.score), expected);
  assert.equal(s.game.done, 8);
  assert.match(await page.textContent('.title'), /مبروك|تعادل/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('play again keeps the settings and avoids questions you just had', async () => {
  const { page, context, errors } = await open();
  await setup(page, { teams: 2, rounds: 4 });
  const first = new Set();
  for (let turn = 0; turn < 8; turn++) {
    const qq = await openQuestion(page, { diff: 1 + (turn % 3) });
    first.add(qq.id);
    await choose(page, qq.correct);
    await page.click('#go');
    if ((await state(page)).screen === 'round') await page.click('#go');
  }
  await page.click('[data-act="replay"]');
  const again = await openQuestion(page, { diff: 1 });
  assert.equal((await state(page)).game.teams[0].score, 0);
  assert.ok(!first.has(again.id), 'a fresh question is chosen first');
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------- help cards ---------- */
test('help: double points doubles a correct answer', async () => {
  const { page, context, errors } = await open();
  await setup(page);
  const qq = await openQuestion(page, { diff: 2 });
  await useHelp(page, 'double');
  await choose(page, qq.correct);
  assert.equal((await state(page)).game.teams[0].score, 400);
  assert.deepEqual(errors, []);
  await context.close();
});

test('help: second chance lets the team try again after a wrong answer', async () => {
  const { page, context, errors } = await open();
  await setup(page);
  const qq = await openQuestion(page, { diff: 1 });
  await useHelp(page, 'life');
  await choose(page, wrongOf(qq));
  let s = await state(page);
  assert.equal(s.game.q.phase, 'answer', 'still answering after the first mistake');
  assert.equal(await page.isDisabled(`#opt-${wrongOf(qq)}`), true, 'the wrong answer is crossed out');
  await choose(page, qq.correct);
  s = await state(page);
  assert.equal(s.game.teams[0].score, 100);
  assert.deepEqual(errors, []);
  await context.close();
});

test('help: remove two answers leaves the right answer and one wrong one', async () => {
  const { page, context, errors } = await open();
  await setup(page);
  const qq = await openQuestion(page);
  await useHelp(page, 'fifty');
  const after = await q(page);
  assert.equal(after.removed.length, 2);
  assert.ok(!after.removed.includes(qq.correct), 'the right answer is never removed');
  assert.deepEqual(errors, []);
  await context.close();
});

test('help: extra time adds 15 seconds', async () => {
  const { page, context, errors } = await open();
  await setup(page, { time: 30 });
  await openQuestion(page);
  await page.clock.runFor(5000);
  await useHelp(page, 'time');
  const t = (await q(page)).timeLeft;
  assert.ok(Math.abs(t - 40) < 0.6, `expected about 40s, got ${t}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('help: change question gives a new question and a full timer', async () => {
  const { page, context, errors } = await open();
  await setup(page, { time: 30 });
  const qq = await openQuestion(page);
  await page.clock.runFor(8000);
  await useHelp(page, 'swap');
  const after = await q(page);
  assert.notEqual(after.id, qq.id);
  assert.equal(after.timeLeft, 30);
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------- sabotage cards ---------- */
test('sabotage: the sabotage button is visible on every question', async () => {
  const { page, context, errors } = await open();
  await setup(page);
  await openQuestion(page);
  const chip = page.locator('[data-act="sheet-theirs"]');
  assert.equal(await chip.isVisible(), true);
  assert.match(await chip.textContent(), /تخريب/);
  await chip.click();
  assert.equal(await page.locator('#sheet [data-act="use"][data-team="1"]:not([disabled])').count(), 5, 'bluff, rush, freeze, scramble, fog');
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: a successful bluff gives the bluffing team the points, and the clock stops while they peek', async () => {
  const { page, context, errors } = await open();
  await setup(page, { teams: 3 });
  const qq = await openQuestion(page, { diff: 2 });
  await useSabotage(page, 1, 'lie');
  assert.equal(await page.isVisible('#peek'), true);
  const before = (await q(page)).timeLeft;
  await page.clock.runFor(6000);
  assert.equal((await q(page)).timeLeft, before, 'timer paused during the bluff');
  const peek = await page.locator('#peek').boundingBox();
  await page.mouse.move(peek.x + peek.width / 2, peek.y + peek.height / 2);
  await page.mouse.down();
  assert.equal((await page.textContent('#peek .peek-show')).trim(), qq.options[qq.correct]);
  assert.equal(await page.isVisible('#peek .peek-show'), true, 'answer shows while held');
  await page.mouse.up();
  assert.equal(await page.isVisible('#peek .peek-show'), false, 'answer hides on release');
  await page.click('#go');
  await choose(page, wrongOf(qq));
  const s = await state(page);
  assert.deepEqual(s.game.teams.map((t) => t.score), [0, 200, 0]);
  assert.equal(s.game.q.phase, 'reveal', 'no steal after a successful bluff');
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: a failed bluff gives nothing to the bluffing team', async () => {
  const { page, context, errors } = await open();
  await setup(page);
  const qq = await openQuestion(page, { diff: 1 });
  await useSabotage(page, 1, 'lie');
  await page.click('#go');
  await choose(page, qq.correct);
  assert.deepEqual((await state(page)).game.teams.map((t) => t.score), [100, 0]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: rush halves the remaining time', async () => {
  const { page, context, errors } = await open();
  await setup(page, { time: 30 });
  await openQuestion(page);
  await useSabotage(page, 1, 'rush');
  assert.equal((await q(page)).timeLeft, 15);
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: freeze stops the answering team from using help cards', async () => {
  const { page, context, errors } = await open();
  await setup(page);
  await openQuestion(page);
  await useSabotage(page, 1, 'freeze');
  await page.click('[data-act="sheet-mine"]');
  assert.equal(await page.locator('#sheet [data-act="use"]').count(), 0);
  assert.match(await page.textContent('#sheet'), /جمّد/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: scramble moves the answers around every 3 seconds', async () => {
  const { page, context, errors } = await open();
  await setup(page);
  await openQuestion(page);
  await useSabotage(page, 1, 'scramble');
  const order = () => page.$$eval('#answers [data-act="opt"]', (els) => els.map((e) => e.dataset.id).join());
  const first = await order();
  await page.clock.runFor(3200);
  const second = await order();
  assert.notEqual(second, first);
  const qq = await q(page);
  await choose(page, qq.correct);
  assert.equal((await state(page)).game.teams[0].score, 100, 'the right answer still counts after moving');
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: fog blurs the answers and clears after 10 seconds', async () => {
  const { page, context, errors } = await open();
  await setup(page, { time: 30 });
  await openQuestion(page);
  await useSabotage(page, 1, 'fog');
  assert.equal(await page.getAttribute('#answers', 'class').then((c) => c.includes('is-fog')), true);
  const blur = await page.$eval('#answers .pill span', (e) => getComputedStyle(e).filter);
  assert.match(blur, /blur\((6|7)/);
  await page.clock.runFor(10400);
  assert.equal(await page.getAttribute('#answers', 'class').then((c) => c.includes('is-fog')), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: steal lets another team answer a missed question and take its points', async () => {
  const { page, context, errors } = await open();
  await setup(page, { teams: 3 });
  const qq = await openQuestion(page, { diff: 3 });
  await choose(page, wrongOf(qq));
  assert.equal((await q(page)).phase, 'stealOffer');
  assert.equal(await page.locator('[data-act="steal"]').count(), 2, 'both other teams can steal');
  await page.click('[data-act="steal"][data-id="2"]');
  await choose(page, qq.correct);
  assert.deepEqual((await state(page)).game.teams.map((t) => t.score), [0, 0, 300]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('shield: blocks new sabotage and cancels bluff, scramble and fog already used', async () => {
  const { page, context, errors } = await open();
  await setup(page, { teams: 3 });
  const qq = await openQuestion(page, { diff: 1 });
  await useSabotage(page, 1, 'lie');
  await page.click('#go');
  await useSabotage(page, 2, 'fog');
  await useSabotage(page, 1, 'scramble');
  await useHelp(page, 'shield');
  const s1 = await q(page);
  assert.equal(s1.scrambleOff, true);
  assert.equal(s1.fogLeft, 0);
  await page.click('[data-act="sheet-theirs"]');
  assert.equal(await page.locator('#sheet [data-act="use"]:not([disabled])').count(), 0, 'no sabotage allowed');
  await page.click('#sheet [data-act="close"]');
  await choose(page, wrongOf(qq));
  const s = await state(page);
  assert.deepEqual(s.game.teams.map((t) => t.score), [0, 0, 0], 'the cancelled bluff earns nothing');
  assert.equal(s.game.q.phase, 'reveal', 'no steal against a shielded team');
  assert.deepEqual(errors, []);
  await context.close();
});

test('each card can be used only once per game', async () => {
  const { page, context, errors } = await open();
  await setup(page, { teams: 2 });
  let qq = await openQuestion(page);
  await useHelp(page, 'double');
  await choose(page, qq.correct);
  await page.click('#go');
  qq = await openQuestion(page); // team 2
  await choose(page, qq.correct);
  await page.click('#go');
  if ((await state(page)).screen === 'round') await page.click('#go');
  await openQuestion(page); // team 1 again
  await page.click('[data-act="sheet-mine"]');
  assert.equal(await page.locator('#sheet [data-act="use"][data-id="double"]').count(), 0);
  assert.match(await page.textContent('#sheet'), /استُخدمت/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('messages from one turn do not carry over to the next team', async () => {
  const { page, context, errors } = await open();
  await setup(page);
  const qq = await openQuestion(page);
  await useSabotage(page, 1, 'fog');
  assert.equal(await page.getAttribute('#toast', 'class').then((c) => c.includes('on')), true);
  await choose(page, qq.correct);
  await page.click('#go');
  assert.equal(await page.getAttribute('#toast', 'class').then((c) => c.includes('on')), false);
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------- timer ---------- */
test('timer: running out of time counts as a miss', async () => {
  const { page, context, errors } = await open();
  await setup(page, { time: 15, cards: [] });
  await openQuestion(page);
  await page.clock.runFor(16000);
  const s = await state(page);
  assert.equal(s.game.q.outcome, 'timeout');
  assert.equal(s.game.q.phase, 'reveal');
  assert.match(await page.textContent('.eyebrow'), /انتهى الوقت/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('timer: pauses while a card list or the menu is open', async () => {
  const { page, context, errors } = await open();
  await setup(page, { time: 30 });
  await openQuestion(page);
  await page.click('[data-act="sheet-mine"]');
  await page.clock.runFor(8000);
  await page.click('#sheet [data-act="close"]');
  assert.equal(Math.ceil((await q(page)).timeLeft), 30);
  await page.click('#burger');
  await page.clock.runFor(8000);
  await page.keyboard.press('Escape');
  await page.clock.runFor(1000);
  assert.equal(Math.ceil((await q(page)).timeLeft), 29);
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------- robustness ---------- */
test('refreshing the page mid-question keeps the question, scores and time', async () => {
  const { page, context, errors } = await open();
  await setup(page, { time: 30 });
  let qq = await openQuestion(page);
  await choose(page, qq.correct);
  await page.click('#go');
  qq = await openQuestion(page);
  await page.clock.runFor(10000);
  await page.reload();
  const s = await state(page);
  assert.equal(s.screen, 'question');
  assert.equal(s.game.q.id, qq.id);
  assert.equal(s.game.teams[0].score, 100);
  assert.ok(Math.abs(s.game.q.timeLeft - 20) <= 1, `time left ${s.game.q.timeLeft}`);
  assert.equal(await page.textContent('.title'), qq.text);
  assert.deepEqual(errors, []);
  await context.close();
});

test('team names are shown as plain text, never as page code', async () => {
  const { page, context, errors } = await open();
  await setup(page, { names: ['<b>x</b>', 'فريق "٢"'] });
  assert.equal(await page.locator('#scores b').count(), 0);
  assert.match(await page.textContent('#scores'), /<b>x<\/b>/);
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------- layout ---------- */
for (const width of [320, 390, 1440]) {
  test(`layout at ${width}px: no sideways scrolling and nothing overlaps`, async () => {
    const { page, context, errors } = await open({ viewport: { width, height: width < 800 ? 760 : 900 } });
    const problems = [];
    const check = async (label) => {
      const r = await page.evaluate(() => {
        const box = (sel) => { const e = document.querySelector(sel); if (!e || e.hidden || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return b.width ? b : null; };
        const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const pairs = [['.back', '.halo'], ['.clock', '.halo'], ['.burger', '.logo'], ['.toplink', '.logo']];
        return {
          scroll: document.documentElement.scrollWidth > window.innerWidth,
          overlaps: pairs.filter(([a, b]) => hit(box(a), box(b))).map((p) => p.join(' / '))
        };
      });
      if (r.scroll) problems.push(`${label}: page scrolls sideways`);
      r.overlaps.forEach((o) => problems.push(`${label}: ${o} overlap`));
    };
    await check('categories');
    await setup(page, { teams: 5, rounds: 4, names: ['فريق الصقور الذهبية', 'الفهود', 'النجوم', 'الشهب', 'الموج'], cats: ['general', 'geo', 'islamic', 'arabic', 'gulf'] });
    await check('choose category');
    const qq = await openQuestion(page, { cat: 'arabic', diff: 3 });
    await check('question');
    await page.click('[data-act="sheet-theirs"]');
    await check('sabotage list');
    await page.click('#sheet [data-act="close"]');
    await choose(page, wrongOf(qq));
    await check('steal offer');
    await page.click('#go');
    await check('answer shown');
    assert.deepEqual(problems, []);
    assert.deepEqual(errors, []);
    await context.close();
  });
}
