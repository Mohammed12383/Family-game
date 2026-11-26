/*
  Automated tests for مسابقة الزنبقات الجميلات.
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
  base = process.env.GAME_URL || `http://localhost:${server.address().port}/index.html`;
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

async function setRounds(page, n) {
  for (let k = 0; k < 250; k++) {
    const cur = (await state(page)).settings.rounds;
    if (cur === n) return;
    await page.click(cur < n ? '[data-act="rounds-inc"]' : '[data-act="rounds-dec"]');
  }
  throw new Error(`could not set rounds to ${n}`);
}

async function setup(page, { cats = ['general', 'geo', 'islamic'], teams = 2, names, time = 30, rounds = 4, cards = ALL_CARDS } = {}) {
  for (const c of cats) await page.click(`[data-act="cat"][data-id="${c}"]`);
  await page.click('#go');
  await page.click(`[data-act="teams"][data-id="${teams}"]`);
  await page.click('#go');
  if (names) for (let i = 0; i < names.length; i++) await page.fill(`#team-name-${i}`, names[i]);
  await page.click('#go');
  await page.click(`[data-act="time"][data-id="${time}"]`);
  await page.click('#go');
  await setRounds(page, rounds);
  await page.click('#go');
  for (const id of ALL_CARDS) {
    const on = (await page.getAttribute(`[data-act="card-toggle"][data-id="${id}"]`, 'aria-pressed')) === 'true';
    if (on !== cards.includes(id)) await page.click(`[data-act="card-toggle"][data-id="${id}"]`);
  }
  await page.click('#go');
}

/* picks a question; unless `prep` is set, it also skips the sabotage step (nobody sabotages) so the question shows */
async function openQuestion(page, { cat, diff = 1, prep = false } = {}) {
  await page.click(cat ? `[data-act="pick-cat"][data-id="${cat}"]` : '[data-act="pick-cat"]:not([disabled])');
  await page.click(`[data-act="pick-diff"][data-id="${diff}"]`);
  await page.click('#go');
  if (!prep && (await q(page)).phase === 'prep') await page.click('#go');
  return q(page);
}
const startQuestion = (page) => page.click('#go');

/* waits on real time (the page clock is fake) for something the browser does on its own, like full screen */
async function until(page, fn, arg) {
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(fn, arg)) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

async function choose(page, i) {
  await page.click(`#opt-${i}`);
  await page.click('#go');
}

async function useHelp(page, id) {
  await page.click('[data-act="sheet-mine"]');
  await page.click(`[data-act="use"][data-id="${id}"]`);
}

/* on the step before the question; with many teams the saboteur is picked first */
async function useSabotage(page, team, id) {
  const pick = page.locator(`[data-act="sabo-team"][data-id="${team}"]`);
  if (await pick.count()) await pick.click();
  await page.click(`#view [data-act="use"][data-id="${id}"][data-team="${team}"]`);
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

test('question bank: the right answer never gives itself away by being longer than the wrong ones', () => {
  const sandbox = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'assets/questions.js'), 'utf8'))(sandbox);
  const words = (s) => s.trim().split(/\s+/).length;
  const giveaways = [];
  for (const cat of sandbox.LAMMA_DATA) {
    for (const [, text, right, ...wrong] of cat.q) {
      const longest = Math.max(...wrong.map((s) => s.length));
      const mostWords = Math.max(...wrong.map(words));
      if ((right.length > longest * 1.4 && right.length - longest >= 5) || words(right) > mostWords + 1) {
        giveaways.push(`${cat.name}: ${text} → ${right}`);
      }
    }
  }
  assert.deepEqual(giveaways, [], 'make the wrong answers as long and detailed as the right one');
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

test('setup: the most rounds is the questions available divided by the teams', async () => {
  const { page, context, errors } = await open();
  for (const c of ['general', 'geo', 'islamic']) await page.click(`[data-act="cat"][data-id="${c}"]`); // 45 questions
  await page.click('#go');
  await page.click('[data-act="teams"][data-id="5"]');
  for (let i = 0; i < 3; i++) await page.click('#go');
  // 45 questions / 5 teams = 9 rounds at most
  assert.equal(await page.textContent('[data-act="rounds"][data-id="9"]'), 'كل الأسئلة · ٩');
  await page.click('[data-act="rounds"][data-id="9"]');
  assert.equal((await state(page)).settings.rounds, 9);
  assert.equal(await page.isDisabled('#rounds-inc'), true, 'cannot go past the maximum');
  assert.equal(await page.isDisabled('#rounds-dec'), false);
  await page.click('#rounds-dec');
  assert.equal((await state(page)).settings.rounds, 8);
  assert.equal(await page.isDisabled('#go'), false);
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
test('sabotage: chosen before the question appears, and the clock waits until the question starts', async () => {
  const { page, context, errors } = await open();
  await setup(page, { time: 30 });
  const qq = await openQuestion(page, { prep: true });
  assert.equal(qq.phase, 'prep');
  assert.notEqual(await page.textContent('.title'), qq.text, 'the question is still hidden');
  assert.equal(await page.locator('#answers').count(), 0, 'no answers on show yet');
  assert.equal(await page.locator('#view [data-act="use"][data-team="1"]:not([disabled])').count(), 5, 'bluff, rush, freeze, scramble, fog');
  assert.equal(await page.locator('#view [data-act="use"][data-team="0"]').count(), 0, 'the answering team cannot sabotage itself');
  await page.clock.runFor(20000);
  assert.equal((await q(page)).timeLeft, 30, 'no time passes while the others decide');
  await page.reload();
  assert.equal((await q(page)).phase, 'prep', 'a refresh keeps the sabotage step');
  await useSabotage(page, 1, 'freeze');
  assert.match(await page.textContent('.tags'), /تجميد/);
  await startQuestion(page);
  assert.equal(await page.textContent('.title'), qq.text);
  assert.equal(await page.locator('[data-act="use"][data-team]').count(), 0, 'no sabotage once the question is showing');
  assert.equal(await page.locator('[data-act="sheet-theirs"]').count(), 0, 'no sabotage button on the question');
  await page.clock.runFor(5000);
  const t = (await q(page)).timeLeft; // the saved clock lags by up to a second
  assert.ok(Math.abs(t - 25) <= 1, `the clock runs once the question shows, got ${t}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: the step is skipped when no other team has a sabotage card', async () => {
  const { page, context, errors } = await open();
  await setup(page, { cards: ['time', 'double', 'steal'] });
  await page.click('[data-act="pick-cat"]:not([disabled])');
  await page.click('[data-act="pick-diff"][data-id="1"]');
  assert.equal(await page.textContent('#goLabel'), 'اعرض السؤال');
  await page.click('#go');
  const qq = await q(page);
  assert.equal(qq.phase, 'answer', 'straight to the question');
  assert.equal(await page.textContent('.title'), qq.text);
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: a successful bluff gives the bluffing team the points; they see the question and answer before it appears', async () => {
  const { page, context, errors } = await open();
  await setup(page, { teams: 3, time: 30 });
  const qq = await openQuestion(page, { diff: 2, prep: true });
  await useSabotage(page, 1, 'lie');
  assert.equal(await page.isVisible('#peek'), true);
  await page.clock.runFor(6000);
  assert.equal((await q(page)).timeLeft, 30, 'the clock has not started during the bluff');
  const peek = await page.locator('#peek').boundingBox();
  await page.mouse.move(peek.x + peek.width / 2, peek.y + peek.height / 2);
  await page.mouse.down();
  assert.equal((await page.textContent('#peek .peek-a')).trim(), qq.options[qq.correct]);
  assert.equal((await page.textContent('#peek .peek-q')).trim(), qq.text);
  assert.equal(await page.isVisible('#peek .peek-show'), true, 'question and answer show while held');
  await page.mouse.up();
  assert.equal(await page.isVisible('#peek .peek-show'), false, 'they hide on release');
  await page.click('#go');
  assert.equal((await q(page)).phase, 'prep', 'back to the sabotage step so others can still sabotage');
  await startQuestion(page);
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
  const qq = await openQuestion(page, { diff: 1, prep: true });
  await useSabotage(page, 1, 'lie');
  await page.click('#go');
  await startQuestion(page);
  await choose(page, qq.correct);
  assert.deepEqual((await state(page)).game.teams.map((t) => t.score), [100, 0]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: rush makes the team start with half the time', async () => {
  const { page, context, errors } = await open();
  await setup(page, { time: 30 });
  await openQuestion(page, { prep: true });
  await useSabotage(page, 1, 'rush');
  assert.equal((await q(page)).timeLeft, 15);
  await startQuestion(page);
  await page.clock.runFor(3000);
  const t = (await q(page)).timeLeft; // the saved clock lags by up to a second
  assert.ok(Math.abs(t - 12) <= 1, `expected about 12s, got ${t}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: freeze stops the answering team from using help cards', async () => {
  const { page, context, errors } = await open();
  await setup(page);
  await openQuestion(page, { prep: true });
  await useSabotage(page, 1, 'freeze');
  await startQuestion(page);
  await page.click('[data-act="sheet-mine"]');
  assert.equal(await page.locator('#sheet [data-act="use"]').count(), 0);
  assert.match(await page.textContent('#sheet'), /جمّد/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('sabotage: scramble moves the answers around every 3 seconds', async () => {
  const { page, context, errors } = await open();
  await setup(page);
  await openQuestion(page, { prep: true });
  await useSabotage(page, 1, 'scramble');
  await startQuestion(page);
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

test('sabotage: fog blurs the answers once the question shows and clears after 10 seconds', async () => {
  const { page, context, errors } = await open();
  await setup(page, { time: 30 });
  await openQuestion(page, { prep: true });
  await useSabotage(page, 1, 'fog');
  await page.clock.runFor(8000); // waiting on the sabotage step must not use up the fog
  await startQuestion(page);
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

test('shield: cancels the bluff, scramble and fog used before the question, and stops a steal', async () => {
  const { page, context, errors } = await open();
  await setup(page, { teams: 3 });
  const qq = await openQuestion(page, { diff: 1, prep: true });
  await useSabotage(page, 1, 'lie');
  await page.click('#go');
  await useSabotage(page, 2, 'fog');
  await useSabotage(page, 1, 'scramble');
  await startQuestion(page);
  await useHelp(page, 'shield');
  const s1 = await q(page);
  assert.equal(s1.scrambleOff, true);
  assert.equal(s1.fogLeft, 0);
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
  const qq = await openQuestion(page, { prep: true });
  await useSabotage(page, 1, 'fog');
  assert.equal(await page.getAttribute('#toast', 'class').then((c) => c.includes('on')), true);
  await startQuestion(page);
  await choose(page, qq.correct);
  await page.click('#go');
  assert.equal(await page.getAttribute('#toast', 'class').then((c) => c.includes('on')), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('how-to-play links to the questions PDF, and the PDF is there', { skip: !!process.env.GAME_URL && 'the preview page has no download link' }, async () => {
  const { page, context, errors } = await open();
  await page.click('.toplink');
  const href = await page.getAttribute('#sheet a[href$=".pdf"]', 'href');
  assert.equal(href, 'questions.pdf');
  const res = await page.request.get(new URL(href, base).href);
  assert.equal(res.status(), 200);
  assert.equal((await res.body()).subarray(0, 4).toString(), '%PDF');
  assert.deepEqual(errors, []);
  await context.close();
});

test('full screen: the button at the top switches full screen on and off, and the menu has it too', async () => {
  const { page, context, errors } = await open();
  assert.equal(await page.isVisible('#fs'), true);
  assert.equal(await page.getAttribute('#fs', 'aria-label'), 'ملء الشاشة');
  const pressed = (v) => until(page, (on) => !!document.fullscreenElement === on && document.getElementById('fs').getAttribute('aria-pressed') === String(on), v);
  await page.click('#fs');
  assert.equal(await pressed(true), true, 'goes full screen and the button shows it');
  assert.equal(await page.getAttribute('#fs', 'aria-label'), 'الخروج من ملء الشاشة');
  await page.click('#fs');
  assert.equal(await pressed(false), true, 'leaves full screen and the button shows it');
  assert.equal(await page.getAttribute('#fs', 'aria-label'), 'ملء الشاشة');
  await page.click('#burger');
  await page.click('#menu [data-act="fullscreen"]');
  assert.equal(await until(page, () => !!document.fullscreenElement), true, 'the menu item works too');
  assert.deepEqual(errors, []);
  await context.close();
});

test('screen fit: a laptop window scales the game down, a TV scales it up, a phone keeps its own layout', async () => {
  const sizes = [
    { w: 1440, h: 765, ui: 0.82, why: 'a 2880x1800 laptop at 200% Windows scaling' },
    { w: 1920, h: 1080, ui: 1.1, why: 'a TV in full screen' },
    { w: 390, h: 844, ui: 1, why: 'a phone' }
  ];
  for (const s of sizes) {
    const { page, context, errors } = await open({ viewport: { width: s.w, height: s.h } });
    const ui = Number(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui')));
    assert.equal(ui, s.ui, s.why);
    const pillH = (await page.locator('[data-act="cat"]').first().boundingBox()).height;
    const base = s.w <= 640 ? 46 : 50;
    assert.ok(Math.abs(pillH - base * s.ui) < 2, `${s.why}: buttons are ${pillH}px tall`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${s.why}: no sideways scrolling`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('display size: the menu − and + make the game smaller or bigger, and each device remembers it', async () => {
  const { page, context, errors } = await open({ viewport: { width: 1440, height: 765 } });
  const ui = async () => Number(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui')));
  const pillH = async () => (await page.locator('[data-act="cat"]').first().boundingBox()).height;
  assert.equal(await ui(), 0.82, 'starts at the automatic size');
  const before = await pillH();
  await page.click('#burger');
  assert.match(await page.textContent('#size-val'), /١٠٠٪/);
  await page.click('#size-down');
  await page.click('#size-down');
  assert.equal(await page.isVisible('#menu'), true, 'the menu stays open while adjusting');
  assert.match(await page.textContent('#size-val'), /٨٠٪/);
  assert.equal(await ui(), 0.66);
  assert.ok((await pillH()) < before * 0.85, 'the buttons got smaller');
  await page.reload();
  assert.equal(await ui(), 0.66, 'the size is remembered after a refresh');
  assert.equal((await state(page)).size, 0.8);
  await page.click('#burger');
  for (let i = 0; i < 10; i++) if (await page.isEnabled('#size-up')) await page.click('#size-up');
  assert.match(await page.textContent('#size-val'), /١٥٠٪/);
  assert.equal(await page.isDisabled('#size-up'), true, 'stops at the biggest size');
  assert.equal(await ui(), 1.23);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'no sideways scrolling at the biggest size');
  await page.click('[data-act="new-game"]');
  assert.equal((await state(page)).size, 1.5, 'a new game keeps the size');
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

test('team names: the fields are typeable, typed names are used, empty fields take the suggested name', async () => {
  const { page, context, errors } = await open();
  for (const c of ['general', 'geo', 'islamic']) await page.click(`[data-act="cat"][data-id="${c}"]`);
  await page.click('#go');
  await page.click('[data-act="teams"][data-id="3"]');
  await page.click('#go');
  assert.equal(await page.isEditable('#team-name-0'), true);
  assert.equal(await page.inputValue('#team-name-0'), '', 'field starts empty so typing is obvious');
  assert.equal(await page.getAttribute('#team-name-0', 'placeholder'), 'الصقور');
  await page.click('#team-name-0');
  await page.keyboard.type('عائلة النور');
  await page.click('.field:has(#team-name-2)');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'team-name-2', 'tapping anywhere on the field focuses it');
  await page.keyboard.type('الصقور');
  for (let i = 0; i < 3; i++) await page.click('#go');
  await page.click('#go');
  const s = await state(page);
  assert.deepEqual(s.game.teams.map((t) => t.name), ['عائلة النور', 'الفهود', 'الصقور']);
  assert.match(await page.textContent('#scores'), /عائلة النور/);
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

test('a game saved before the questions changed starts fresh instead of showing an old question', async () => {
  const { page, context, errors } = await open();
  await setup(page);
  await openQuestion(page);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('lamma-family-v1'));
    s.bank = 'old-bank';
    s.game.q.text = 'سؤال قديم محذوف';
    localStorage.setItem('lamma-family-v1', JSON.stringify(s));
  });
  await page.reload();
  const s = await state(page);
  assert.equal(s.screen, 'setup');
  assert.equal(s.game, null);
  assert.deepEqual(s.settings.cats, ['general', 'geo', 'islamic'], 'chosen settings are kept');
  assert.doesNotMatch(await page.textContent('#view'), /سؤال قديم/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('settings saved before the newer sabotage cards existed get them switched on', async () => {
  const { page, context, errors } = await open();
  await page.evaluate(() => {
    localStorage.setItem('lamma-family-v1', JSON.stringify({
      v: 1, screen: 'setup', step: 5, game: null, seen: {}, sound: true,
      settings: { cats: ['general', 'geo', 'islamic'], teams: 2, names: ['أ', 'ب'], time: 30, rounds: 4,
        cards: ['time', 'double', 'fifty', 'life', 'swap', 'shield', 'lie', 'rush', 'steal'] }
    }));
  });
  await page.reload();
  for (const id of ['freeze', 'scramble', 'fog']) {
    assert.equal(await page.getAttribute(`[data-act="card-toggle"][data-id="${id}"]`, 'aria-pressed'), 'true', id);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('big group: 10 teams of 3 play a full round, with the saboteur picked first', async () => {
  const { page, context, errors } = await open();
  await setup(page, { teams: 10, rounds: 3, cats: ['general', 'geo', 'islamic', 'gulf'] });
  let s = await state(page);
  assert.equal(s.game.teams.length, 10);
  assert.equal(s.game.total, 30);
  assert.deepEqual(s.game.teams.map((t) => t.name).slice(-2), ['القمم', 'العواصف'], 'default names for all 10 teams');
  // team 1 answers; team 8 sabotages with rush through the team picker
  let qq = await openQuestion(page, { diff: 1, prep: true });
  assert.equal(await page.locator('#view [data-act="use"]').count(), 0, 'no card list until a team is picked');
  await page.click('[data-act="sabo-team"][data-id="7"]');
  await page.click('#view [data-act="use"][data-id="rush"][data-team="7"]');
  assert.equal((await q(page)).rushBy, 7);
  await startQuestion(page);
  await choose(page, wrongOf(qq));
  assert.equal(await page.locator('[data-act="steal"]').count(), 9, 'all nine other teams can steal');
  await page.click('[data-act="steal"][data-id="9"]');
  await choose(page, qq.correct);
  assert.equal((await state(page)).game.teams[9].score, 100);
  await page.click('#go');
  for (let turn = 1; turn < 10; turn++) {
    qq = await openQuestion(page, { diff: 1 + (turn % 3) });
    await choose(page, qq.correct);
    await page.click('#go');
  }
  s = await state(page);
  assert.equal(s.screen, 'round');
  assert.equal(await page.locator('.board-row').count(), 10);
  assert.deepEqual(errors, []);
  await context.close();
});

test('setup: round choices show the total questions and an estimated play time', async () => {
  const { page, context, errors } = await open();
  for (const c of ['general', 'geo', 'islamic', 'gulf']) await page.click(`[data-act="cat"][data-id="${c}"]`);
  await page.click('#go');
  await page.click('[data-act="teams"][data-id="10"]');
  for (let i = 0; i < 3; i++) await page.click('#go');
  await setRounds(page, 4);
  const note = await page.textContent('.note');
  assert.match(note, /٤٠ سؤالاً/);
  assert.match(note, /٤٠ دقيقة تقريباً/, '40 questions x (30s + 30s) = 40 minutes');
  assert.match(note, /الحد الأقصى ٦ جولات/, '60 questions / 10 teams = 6 rounds');
  await setRounds(page, 6);
  assert.equal(await page.isDisabled('#rounds-inc'), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('two teams with every category can play up to all the questions (97 rounds)', async () => {
  const { page, context, errors } = await open();
  await page.click('[data-act="all-cats"]');
  const pool = (await state(page)).settings.cats.length * 15;
  await page.click('#go');
  await page.click('[data-act="teams"][data-id="2"]');
  for (let i = 0; i < 3; i++) await page.click('#go');
  const max = Math.floor(pool / 2);
  await page.click(`[data-act="rounds"][data-id="${max}"]`);
  assert.match(await page.textContent('.note'), /ساعات/, 'long games show their length in hours');
  await page.click('#go');
  await page.click('#go');
  const s = await state(page);
  assert.equal(s.settings.rounds, max);
  assert.equal(s.game.total, max * 2);
  assert.match(await page.textContent('.eyebrow'), new RegExp(`من ${String(max).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d])}`));
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------- layout ---------- */
for (const width of [320, 360, 390, 1440]) {
  test(`layout at ${width}px: no sideways scrolling and nothing overlaps`, async () => {
    const { page, context, errors } = await open({ viewport: { width, height: width < 800 ? 760 : 900 } });
    const problems = [];
    const check = async (label) => {
      const r = await page.evaluate(() => {
        const box = (sel) => { const e = document.querySelector(sel); if (!e || e.hidden || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return b.width ? b : null; };
        const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const pairs = [['.back', '.halo'], ['.clock', '.halo'], ['.burger', '.logo'], ['.fs', '.logo'], ['.burger', '.fs'], ['.toplink', '.logo']];
        const oneLine = (sel) => {
          const e = document.querySelector(sel);
          const range = document.createRange();
          range.selectNodeContents(e);
          const fs = parseFloat(getComputedStyle(e).fontSize);
          return [...range.getClientRects()].every((x) => x.height < fs * 2) && range.getBoundingClientRect().height < fs * 2;
        };
        return {
          scroll: document.documentElement.scrollWidth > window.innerWidth,
          overlaps: pairs.filter(([a, b]) => hit(box(a), box(b))).map((p) => p.join(' / ')),
          wrapped: ['.logo', '.toplink'].filter((sel) => !oneLine(sel)),
          // the title needs breathing room on both sides, not just "not touching"
          tight: [['.toplink', '.logo'], ['.logo', '.top-start']].filter(([a, b]) => {
            const A = box(a), B = box(b);
            return A && B && Math.max(A.left, B.left) - Math.min(A.right, B.right) < 8;
          }).map((p) => p.join(' / '))
        };
      });
      if (r.scroll) problems.push(`${label}: page scrolls sideways`);
      r.wrapped.forEach((sel) => problems.push(`${label}: ${sel} wraps onto two lines`));
      r.tight.forEach((o) => problems.push(`${label}: ${o} less than 8px apart`));
      r.overlaps.forEach((o) => problems.push(`${label}: ${o} overlap`));
    };
    await check('categories');
    await setup(page, { teams: 10, rounds: 4, names: ['فريق الصقور الذهبية', 'الفهود', 'النجوم', 'الشهب', 'الموج'], cats: ['general', 'geo', 'islamic', 'arabic', 'gulf'] });
    await check('choose category');
    const qq = await openQuestion(page, { cat: 'arabic', diff: 3, prep: true });
    await check('sabotage step');
    await page.click('[data-act="sabo-team"][data-id="9"]');
    await check('sabotage list');
    await startQuestion(page);
    await check('question');
    await choose(page, wrongOf(qq));
    await check('steal offer');
    await page.click('#go');
    await check('answer shown');
    assert.deepEqual(problems, []);
    assert.deepEqual(errors, []);
    await context.close();
  });
}
