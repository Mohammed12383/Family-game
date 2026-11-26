/*
  Builds questions.pdf from assets/questions.js — every question with its four answers,
  the right answer highlighted. Run after adding questions:  npm run pdf
*/
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'questions.pdf');
const NAME = 'مسابقة الزنبقات الجميلات';

const sandbox = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'assets/questions.js'), 'utf8'))(sandbox);
const CATS = sandbox.LAMMA_DATA;

const DIGITS = '٠١٢٣٤٥٦٧٨٩';
const ar = (v) => String(v).replace(/[0-9]/g, (d) => DIGITS[d]);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LEVELS = [{ d: 1, name: 'سهل', pts: 100 }, { d: 2, name: 'متوسط', pts: 200 }, { d: 3, name: 'صعب', pts: 300 }];
const total = CATS.reduce((n, c) => n + c.q.length, 0);
const qWord = (n) => (n <= 10 ? `${ar(n)} أسئلة` : `${ar(n)} سؤالاً`);
const cWord = (n) => (n <= 10 ? `${ar(n)} فئات` : `${ar(n)} فئة`);

function questionHtml(row, n) {
  const [, text, correct, ...wrong] = row;
  /* fixed order on paper: right answer placed among the others by question number, so it isn't always first */
  const opts = wrong.slice();
  opts.splice(n % 4, 0, correct);
  return `<li class="q">
    <p class="q-text"><span class="q-n">${ar(n)}</span>${esc(text)}</p>
    <div class="opts">${opts.map((o) => `<span class="opt${o === correct ? ' is-right' : ''}" dir="auto">${o === correct ? '<i>✓</i>' : ''}${esc(o)}</span>`).join('')}</div>
  </li>`;
}

function categoryHtml(cat, ci) {
  let n = 0;
  const groups = LEVELS.map((lv) => {
    const rows = cat.q.filter((r) => r[0] === lv.d);
    if (!rows.length) return '';
    return `<section class="level">
      <h3><b>${lv.name}</b> · ${ar(lv.pts)} نقطة</h3>
      <ol class="qs">${rows.map((r) => questionHtml(r, ++n)).join('')}</ol>
    </section>`;
  }).join('');
  return `<article class="cat">
    <p class="eyebrow">الفئة ${ar(ci + 1)} من ${ar(CATS.length)} · ${qWord(cat.q.length)}</p>
    <h2>${esc(cat.name)}</h2>
    ${groups}
  </article>`;
}

const html = `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600&display=swap">
<style>
  :root { --ink: #1f2225; --ink-2: #4f5458; --ink-3: #8a8f94; --hair: #d9d2cb; --orange: #f7951d; --orange-deep: #b9650a; --good: #2f7a55; }
  @page { size: A4; margin: 16mm 16mm 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "IBM Plex Sans Arabic", "DejaVu Sans", Tahoma, sans-serif; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .cover { height: 255mm; display: flex; flex-direction: column; justify-content: center; text-align: center; break-after: page; }
  .cover .eyebrow { font-size: 13pt; }
  .cover h1 { margin: 6mm 0 0; font-size: 34pt; font-weight: 300; line-height: 1.3; }
  .cover h1 b { font-weight: 600; }
  .cover .sub { margin: 5mm 0 0; font-size: 13pt; color: var(--ink-2); }
  .rule { width: 40mm; height: 2px; margin: 12mm auto; background: var(--orange); }
  .toc { list-style: none; margin: 0 auto; padding: 0; width: 120mm; display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 10mm; text-align: start; font-size: 12pt; }
  .toc li { display: flex; justify-content: space-between; border-bottom: 1px solid var(--hair); padding-bottom: 2mm; }
  .toc span { color: var(--ink-3); font-size: 10pt; }
  .key { margin: 14mm auto 0; display: flex; gap: 6mm; justify-content: center; align-items: center; font-size: 10pt; color: var(--ink-2); }

  .eyebrow { margin: 0; font-size: 10pt; color: var(--ink-3); }
  .cat { break-before: page; }
  .cat h2 { margin: 1mm 0 0; font-size: 24pt; font-weight: 300; line-height: 1.3; padding-bottom: 4mm; border-bottom: 2px solid var(--orange); }
  .level h3 { margin: 7mm 0 3mm; font-size: 11pt; font-weight: 400; color: var(--ink-3); break-after: avoid; }
  .level h3 b { color: var(--orange-deep); font-weight: 600; }
  .qs { list-style: none; margin: 0; padding: 0; display: grid; gap: 4.2mm; }
  .q { break-inside: avoid; }
  .q-text { margin: 0 0 2mm; font-size: 12pt; font-weight: 500; line-height: 1.6; display: flex; gap: 3mm; }
  .q-n { flex: none; width: 7mm; height: 7mm; border-radius: 50%; display: inline-grid; place-items: center; font-size: 9pt; font-weight: 500; background: #f3eee9; color: var(--ink-2); margin-top: .6mm; }
  .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 1.6mm 3mm; padding-inline-start: 10mm; }
  .opt { min-height: 7.5mm; padding: 1mm 4mm; border: 1px solid var(--hair); border-radius: 999px; font-size: 10pt; line-height: 1.5; display: flex; align-items: center; justify-content: center; text-align: center; gap: 1.6mm; color: var(--ink-2); }
  .opt.is-right { background: var(--ink); border-color: var(--ink); color: #fff; font-weight: 500; }
  .opt i { font-style: normal; color: var(--orange); }
  .swatch { display: inline-flex; gap: 2mm; align-items: center; }
</style></head>
<body>
  <section class="cover">
    <p class="eyebrow">بنك الأسئلة</p>
    <h1>${NAME.split(' ')[0]}<br><b>${NAME.split(' ').slice(1).join(' ')}</b></h1>
    <p class="sub">${cWord(CATS.length)} · ${qWord(total)} · لكل سؤال أربع إجابات</p>
    <div class="rule"></div>
    <ol class="toc">${CATS.map((c) => `<li>${esc(c.name)}<span>${ar(c.q.length)}</span></li>`).join('')}</ol>
    <div class="key">
      <span class="swatch"><span class="opt is-right"><i>✓</i>الإجابة الصحيحة</span></span>
      <span>سهل ١٠٠ · متوسط ٢٠٠ · صعب ٣٠٠ نقطة</span>
    </div>
  </section>
  ${CATS.map(categoryHtml).join('')}
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: OUT,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-size:8px;color:#8a8f94;text-align:center;font-family:'DejaVu Sans',sans-serif" dir="rtl">${NAME} · صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></div>`
  });
  await browser.close();
  console.log(`wrote ${path.relative(ROOT, OUT)} · ${CATS.length} categories · ${total} questions`);
})();
