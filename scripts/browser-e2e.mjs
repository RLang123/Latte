import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.BROWSER_URL || 'http://127.0.0.1:3000';
const artifacts = 'test-artifacts/browser';
await fs.rm(artifacts, { recursive: true, force: true });
await fs.mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const logs = { console: [], pageErrors: [], failedRequests: [], webSockets: [] };
const redact = url => url.replace(/([?&]token=)[^&]+/g, '$1<redacted>');
const attachLogs = (page, name) => { page.on('console', m => logs.console.push({ name, type: m.type(), text: m.text() })); page.on('pageerror', e => logs.pageErrors.push({ name, text: e.message })); page.on('requestfailed', r => logs.failedRequests.push({ name, url: redact(r.url()), error: r.failure()?.errorText })); page.on('websocket', ws => { const entry = { name, url: redact(ws.url()), closed: false }; logs.webSockets.push(entry); ws.on('close', () => { entry.closed = true; }); }); };
const context = async (name, viewport) => { const c = await browser.newContext({ viewport }); const p = await c.newPage(); attachLogs(p, name); return { c, p }; };
const clickFind = async (p, code) => { await p.locator('select').selectOption(code); await p.getByRole('button', { name: /FIND A HUMAN/ }).click(); };
const expectText = async (p, text) => p.getByText(text, { exact: false }).waitFor({ state: 'visible', timeout: 10000 });
const screenshot = async (p, name) => p.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
const routeFromGuideDOM = p => p.evaluate(() => {
  const all = [...document.querySelectorAll('.cell')], width = 13;
  const walls = all.map(el => { const s = el.getAttribute('style') || ''; return { n: !s.includes('border-top-color: transparent'), e: !s.includes('border-right-color: transparent'), s: !s.includes('border-bottom-color: transparent'), w: !s.includes('border-left-color: transparent') }; });
  const q = [[{ x: 0, y: 0 }, []]], seen = new Set(['0,0']), dirs = [['ArrowUp', 0, -1, 'n'], ['ArrowRight', 1, 0, 'e'], ['ArrowDown', 0, 1, 's'], ['ArrowLeft', -1, 0, 'w']];
  while (q.length) { const [pos, path] = q.shift(); if (pos.x === 12 && pos.y === 8) return path; for (const [key, dx, dy, wall] of dirs) { if (walls[pos.y * width + pos.x][wall]) continue; const n = { x: pos.x + dx, y: pos.y + dy }, k = `${n.x},${n.y}`; if (n.x >= 0 && n.y >= 0 && n.x < width && n.y < 9 && !seen.has(k)) { seen.add(k); q.push([n, [...path, key]]); } } } return [];
});
async function run(viewport, prefix) {
  const one = await context(`${prefix}-one`, viewport), two = await context(`${prefix}-two`, viewport), guidePage = one.p, runnerPage = two.p;
  await guidePage.goto(baseURL); await runnerPage.goto(baseURL); await screenshot(guidePage, `${prefix}-landing`);
  await clickFind(guidePage, 'US'); await expectText(guidePage, 'Finding another human'); await screenshot(guidePage, `${prefix}-matchmaking`);
  await clickFind(runnerPage, 'KR'); await expectText(guidePage, 'YOU ARE THE GUIDE'); await expectText(runnerPage, 'YOU ARE THE RUNNER'); await expectText(guidePage, 'Light the way.'); await expectText(runnerPage, 'Follow what you feel.');
  await screenshot(guidePage, `${prefix}-guide`); await screenshot(runnerPage, `${prefix}-runner`);
  const guideVisible = await guidePage.locator('.cell:not(.hidden)').count(), runnerVisible = await runnerPage.locator('.cell:not(.hidden)').count(), total = await guidePage.locator('.cell').count();
  if (guideVisible !== total || runnerVisible >= guideVisible || runnerVisible < 1) throw new Error(`Visibility mismatch: guide=${guideVisible}, runner=${runnerVisible}, total=${total}`);
  for (const [index, direction] of ['up', 'down', 'left', 'right'].entries()) { await guidePage.locator('.game-controls .controls button').nth(index).click(); await runnerPage.locator('.light-signal').waitFor({ state: 'visible' }); await runnerPage.locator('.light-signal').waitFor({ state: 'hidden' }); }
  const route = await routeFromGuideDOM(guidePage); if (!route.length) throw new Error('Could not derive route from Guide DOM');
  for (const key of route) { await runnerPage.keyboard.press(key); await runnerPage.waitForTimeout(90); }
  await expectText(guidePage, 'YOU UNDERSTOOD'); await expectText(runnerPage, 'YOU UNDERSTOOD'); await expectText(guidePage, 'United States'); await expectText(guidePage, 'South Korea'); await expectText(guidePage, /km/); await screenshot(guidePage, `${prefix}-success`);
  await guidePage.getByRole('button', { name: 'Thank you' }).click(); await expectText(guidePage, 'Sent: ✦ Thank you');
  await runnerPage.close(); await expectText(guidePage, 'The other human left.'); await guidePage.getByRole('button', { name: 'FIND ANOTHER HUMAN' }).click(); await expectText(guidePage, 'Finding another human');
  const three = await context(`${prefix}-replay`, viewport); await three.p.goto(baseURL); await clickFind(three.p, 'JP'); await expectText(guidePage, 'YOU ARE THE'); await expectText(three.p, 'YOU ARE THE');
  await guidePage.close(); await three.c.close(); await one.c.close().catch(() => {}); await two.c.close().catch(() => {}); return { routeLength: route.length, guideVisible, runnerVisible, total };
}
const desktop = await run({ width: 1280, height: 900 }, 'desktop');
const mobile = await run({ width: 390, height: 844 }, 'mobile');
await fs.writeFile(`${artifacts}/browser-logs.json`, JSON.stringify(logs, null, 2));
if (logs.pageErrors.length || logs.failedRequests.length || logs.console.some(x => x.type === 'error')) throw new Error(`Browser errors found; inspect ${artifacts}/browser-logs.json`);
console.log(JSON.stringify({ desktop, mobile, artifacts, browserErrors: logs.pageErrors.length, failedRequests: logs.failedRequests.length }, null, 2)); await browser.close();
