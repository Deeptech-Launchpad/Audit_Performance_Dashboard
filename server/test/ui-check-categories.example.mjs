// Browser check of the Category Performance page with Playwright, using the Chrome installed on the PC (no browser download).
// NOT part of `npm test` (it needs the website running and a Playwright library). Run it like this:
//   1. in any folder:  npm install playwright-core
//   2. copy this file there, then (PowerShell):
//        $env:AUDIT_USER = 'your-username'; $env:AUDIT_PASS = 'your-password'; node ui-check-categories.example.mjs
//   Optional: AUDIT_URL (default http://localhost:3000), CHROME_PATH.
// It checks: nothing half-painted or covered, cards never overlap, search / sort / drawer / tabs, dark mode,
// a 390px phone width, "reduce motion", and that the browser console stays clean. Screenshots go to ./shots/.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.AUDIT_URL || 'http://localhost:3000';
const USER = process.env.AUDIT_USER; const PASS = process.env.AUDIT_PASS;
if (!USER || !PASS) { console.error('Set AUDIT_USER and AUDIT_PASS first (never write the password into this file).'); process.exit(2); }
const OUT = './shots/'; fs.mkdirSync(OUT, { recursive: true });
const results = []; const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1524, height: 780 }, deviceScaleFactor: 1.25 });
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASS }, headers: { 'x-requested-with': 'audit-app' } });
ok('signed in', login.ok(), `status ${login.status()}`);

const page = await ctx.newPage(); const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text().slice(0, 160)}`); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message.slice(0, 160)));
page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

await page.goto(`${BASE}/categories`);
await page.waitForSelector('.cat-card', { timeout: 15000 });
await page.waitForTimeout(2200);
const n = await page.locator('.cat-card').count();
ok('category cards are on the page', n > 0, `found ${n}`);

const state = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.cat-card')];
  const hidden = cards.filter((c) => { const s = getComputedStyle(c); return s.opacity !== '1' || s.visibility === 'hidden' || c.getBoundingClientRect().width < 50; }).length;
  const f = getComputedStyle(document.querySelector('.filters'));
  const heavy = [...document.querySelectorAll('.page *')].filter((e) => { const s = getComputedStyle(e); return s.backdropFilter && s.backdropFilter !== 'none'; }).length;
  return { hidden, backdrop: f.backdropFilter, heavy, scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
});
ok('every card finished animating and is visible', state.hidden === 0, `${state.hidden} hidden`);
ok('filter bar has no blur layer (can leave unpainted patches in Chrome)', state.backdrop === 'none' && state.heavy === 0);
ok('no sideways scrolling', state.scrollW <= state.innerW + 20, `${state.scrollW}/${state.innerW}`);

let covered = 0, overlap = 0; const total = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < total; y += 420) {
  await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const fb = document.querySelector('.filters').getBoundingClientRect().bottom; let cov = 0;
    const cards = [...document.querySelectorAll('.cat-card')].map((c) => ({ c, r: c.getBoundingClientRect() }));
    for (const { c, r } of cards) { if (r.bottom < fb + 20 || r.top > innerHeight - 20) continue; const top = document.elementFromPoint(r.left + r.width / 2, Math.min(Math.max(r.top + r.height / 2, fb + 6), innerHeight - 6)); if (!top || !c.contains(top)) cov++; }
    let ov = 0; for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) { const a = cards[i].r, b = cards[j].r; if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) ov++; }
    return { cov, ov };
  });
  covered += r.cov; overlap += r.ov;
}
ok('cards are on top wherever they are on screen while scrolling', covered === 0, `${covered} covered`);
ok('cards never overlap each other', overlap === 0, `${overlap} overlaps`);
await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${OUT}full-page.png`, fullPage: true });

await page.fill('input[aria-label="Find a category"]', 'zzzz'); await page.waitForTimeout(300);
ok('search with no match shows a message', (await page.locator('.empty').count()) === 1);
await page.fill('input[aria-label="Find a category"]', ''); await page.waitForTimeout(300);
await page.selectOption('#cs', 'az'); await page.waitForTimeout(300);
const names = await page.locator('.cat-card h3').allInnerTexts();
ok('A to Z sort is alphabetical', JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b))));
await page.locator('.cat-more').first().click(); await page.waitForSelector('.drawer'); await page.waitForTimeout(400);
ok('"See everyone" opens the drawer with people', (await page.locator('.drawer tbody tr').count()) > 0);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('Esc closes the drawer', (await page.locator('.drawer').count()) === 0);
await page.getByRole('tab', { name: 'By person' }).click(); await page.waitForTimeout(800);
ok('By person tab shows people cards', (await page.locator('.cat-card.person').count()) > 0);
await page.getByRole('tab', { name: 'Overview grid' }).click(); await page.waitForTimeout(600);
ok('Overview grid shows rows', (await page.locator('.grid-tbl tbody tr').count()) > 0);

await page.getByRole('tab', { name: 'By category' }).click();
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}dark.png` });
await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(700);
const mob = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
ok('phone width (390px): no sideways scroll', mob.sw <= mob.iw + 2, `${mob.sw}/${mob.iw}`);
await page.screenshot({ path: `${OUT}phone.png` });
await page.setViewportSize({ width: 1524, height: 780 });
await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload(); await page.waitForSelector('.cat-card'); await page.waitForTimeout(400);
ok('with "reduce motion" everything shows immediately', await page.evaluate(() => [...document.querySelectorAll('.cat-card')].every((c) => getComputedStyle(c).opacity === '1')));
ok('no browser console errors or failed requests', problems.length === 0, problems.slice(0, 4).join(' ; '));
await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
