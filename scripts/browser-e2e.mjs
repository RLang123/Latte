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
  await clickFind(runnerPage, 'KR'); await expectText(guidePage, 'Choose how to meet.'); await expectText(runnerPage, 'Choose how to meet.'); await guidePage.getByRole('button', { name: /BLIND MAZE/ }).click(); await runnerPage.getByRole('button', { name: /BLIND MAZE/ }).click(); await expectText(guidePage, 'YOU ARE THE GUIDE'); await expectText(runnerPage, 'YOU ARE THE RUNNER'); await expectText(guidePage, 'Light the way.'); await expectText(runnerPage, 'Follow what you feel.');
  await screenshot(guidePage, `${prefix}-guide`); await screenshot(runnerPage, `${prefix}-runner`);
  const guideVisible = await guidePage.locator('.cell:not(.hidden)').count(), runnerVisible = await runnerPage.locator('.cell:not(.hidden)').count(), total = await guidePage.locator('.cell').count();
  if (guideVisible !== total || runnerVisible >= guideVisible || runnerVisible < 1) throw new Error(`Visibility mismatch: guide=${guideVisible}, runner=${runnerVisible}, total=${total}`);
  for (const [index, direction] of ['up', 'down', 'left', 'right'].entries()) { await guidePage.locator('.game-controls .controls button').nth(index).click(); await runnerPage.locator('.light-signal').waitFor({ state: 'visible' }); await runnerPage.locator('.light-signal').waitFor({ state: 'hidden' }); }
  const route = await routeFromGuideDOM(guidePage); if (!route.length) throw new Error('Could not derive route from Guide DOM');
  for (const key of route) { await runnerPage.keyboard.press(key); await runnerPage.waitForTimeout(90); }
  await expectText(guidePage, 'YOU UNDERSTOOD'); await expectText(runnerPage, 'YOU UNDERSTOOD'); await expectText(guidePage, 'United States'); await expectText(guidePage, 'South Korea'); await expectText(guidePage, /km/); await screenshot(guidePage, `${prefix}-success`);
  await guidePage.getByRole('button', { name: 'Thank you' }).click(); await expectText(guidePage, 'Sent: ✦ Thank you');
  await runnerPage.close(); await expectText(guidePage, 'The other human left.'); await guidePage.getByRole('button', { name: 'FIND ANOTHER HUMAN' }).click(); await expectText(guidePage, 'Finding another human');
  const three = await context(`${prefix}-replay`, viewport); await three.p.goto(baseURL); await clickFind(three.p, 'JP'); await expectText(guidePage, 'Choose how to meet.'); await three.p.getByRole('button', { name: /BLIND MAZE/ }).click(); await guidePage.getByRole('button', { name: /BLIND MAZE/ }).click(); await expectText(guidePage, 'YOU ARE THE'); await expectText(three.p, 'YOU ARE THE');
  await guidePage.close(); await three.c.close(); await one.c.close().catch(() => {}); await two.c.close().catch(() => {}); return { routeLength: route.length, guideVisible, runnerVisible, total };
}
async function drawStroke(page) {
  const box = await page.locator('canvas').boundingBox(); if (!box) throw new Error('Drawing canvas not visible');
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .35); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .65, { steps: 8 }); await page.mouse.move(box.x + box.width * .75, box.y + box.height * .35, { steps: 8 }); await page.mouse.up();
}
async function runDraw(viewport, prefix) {
  const one = await context(`${prefix}-draw-one`, viewport), two = await context(`${prefix}-draw-two`, viewport), p1 = one.p, p2 = two.p;
  await p1.goto(baseURL); await p2.goto(baseURL); await clickFind(p1, 'US'); await expectText(p1, 'Finding another human'); await clickFind(p2, 'KR');
  await expectText(p1, 'Choose how to meet.'); await p1.getByRole('button', { name: /SAME WORD, TWO WORLDS/ }).click(); await p2.getByRole('button', { name: /SAME WORD, TWO WORLDS/ }).click();
  await p1.locator('.draw-intro').waitFor({ state: 'visible' }); await p2.locator('.draw-intro').waitFor({ state: 'visible' }); await p1.locator('.draw-stage').waitFor({ state: 'visible', timeout: 10000 }); await p2.locator('.draw-stage').waitFor({ state: 'visible', timeout: 10000 });
  const topic = await p1.locator('.draw-heading h1').textContent(); if (topic !== await p2.locator('.draw-heading h1').textContent()) throw new Error('Draw topics differ'); await screenshot(p1, `${prefix}-draw`);
  await drawStroke(p1); const strokeSize = await p1.locator('canvas').evaluate(c => { const ctx = c.getContext('2d'); const pixels = ctx.getImageData(0, 0, c.width, c.height).data; let bright = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 150 && pixels[i + 1] > 150) bright++; return { data: c.toDataURL().length, bright }; }); if (strokeSize.data < 10000 || strokeSize.bright < 100) throw new Error(`Canvas stroke was not recorded (${JSON.stringify(strokeSize)})`); await p1.getByRole('button', { name: /REVEAL WHEN READY/ }).click(); await p1.getByRole('button', { name: 'KEEP DRAWING' }).click(); await p1.getByRole('button', { name: /REVEAL WHEN READY/ }).click(); await p1.getByRole('button', { name: 'SUBMIT DRAWING' }).click(); await expectText(p1, 'DRAWING SENT');
  await drawStroke(p2); await p2.getByRole('button', { name: /REVEAL WHEN READY/ }).click(); await p2.getByRole('button', { name: 'SUBMIT DRAWING' }).click(); await p1.locator('.draw-result').waitFor({ state: 'visible', timeout: 10000 }); await p2.locator('.draw-result').waitFor({ state: 'visible', timeout: 10000 }); await expectText(p1, 'THE SAME WORD'); await expectText(p1, 'APPROXIMATE'); const imageInfo = await p1.locator('.revealed-image img').evaluateAll(imgs => imgs.map(img => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); const data = ctx.getImageData(0, 0, c.width, c.height).data; let bright = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] > 150) bright++; return { src: img.src.length, width: img.naturalWidth, height: img.naturalHeight, bright }; })); if (imageInfo.some(x => x.width === 0 || x.height === 0 || x.bright < 100)) throw new Error(`Submitted drawing image is blank or failed to decode: ${JSON.stringify(imageInfo)}`); await screenshot(p1, `${prefix}-draw-success`);
  await p1.getByRole('button', { name: 'React ✦' }).click(); await p2.locator('.received-reaction').waitFor({ state: 'visible' }); const download = p1.waitForEvent('download'); await p1.getByRole('button', { name: 'SAVE BOTH WORLDS' }).click(); if (!(await download).suggestedFilename().includes('same-word-two-worlds')) throw new Error('Drawing result download missing'); await p1.getByRole('button', { name: 'DRAW AGAIN' }).click(); await p1.locator('.draw-stage').waitFor({ state: 'visible', timeout: 10000 }); await p2.locator('.draw-stage').waitFor({ state: 'visible', timeout: 10000 });
  await p2.close(); await expectText(p1, 'The other human left.'); await p1.close(); await one.c.close().catch(() => {}); await two.c.close().catch(() => {}); return { topic, canvas: true };
}
async function runWorld(viewport, prefix) {
  const one = await context(`${prefix}-world-one`, viewport), two = await context(`${prefix}-world-two`, viewport), p1 = one.p, p2 = two.p;
  await p1.goto(baseURL); await p2.goto(baseURL); await clickFind(p1, 'US'); await clickFind(p2, 'KR'); await expectText(p1, 'Choose how to meet.');
  await p1.getByRole('button', { name: /PLAY ACROSS THE WORLD/ }).click(); await p2.getByRole('button', { name: /PLAY ACROSS THE WORLD/ }).click(); await expectText(p1, 'Where should we travel?');
  await p1.getByRole('button', { name: 'AFRICA' }).click(); await p2.getByRole('button', { name: 'EAST ASIA' }).click(); await expectText(p1, 'THE WORLD CHOOSES'); await expectText(p2, 'THE WORLD CHOOSES'); await expectText(p1, 'YOUR CHOICE'); await screenshot(p1, `${prefix}-world-vote-result`);
  await p1.waitForTimeout(3200); const gameTitle = (await p1.locator('.world-game-card h2').textContent())?.trim(); if (!gameTitle || gameTitle !== (await p2.locator('.world-game-card h2').textContent())?.trim()) throw new Error('World game mismatch'); await p1.getByRole('button', { name: /I AM READY|WAITING FOR/ }).click(); await p2.getByRole('button', { name: /I AM READY|WAITING FOR/ }).click(); await expectText(p1, gameTitle); await expectText(p1, /Your turn|Their turn/); await screenshot(p1, `${prefix}-world-game`);
  const active = p1.locator('button.primary').filter({ hasText: /THROW THE STICKS/ }); if (await active.count()) { await active.first().click(); } else { const power = p1.getByRole('button', { name: /POWER/ }); if (await power.count()) await power.first().click(); else { const pit = p1.locator('.oware-board button:not(:disabled)').first(); if (await pit.count()) await pit.click(); } }
  await p1.close(); await p2.close(); await one.c.close().catch(() => {}); await two.c.close().catch(() => {}); return { world: true };
}
const desktop = await run({ width: 1280, height: 900 }, 'desktop');
const mobile = await run({ width: 390, height: 844 }, 'mobile');
const desktopDraw = await runDraw({ width: 1280, height: 900 }, 'desktop');
const mobileDraw = await runDraw({ width: 390, height: 844 }, 'mobile');
const desktopWorld = await runWorld({ width: 1280, height: 900 }, 'desktop');
const mobileWorld = await runWorld({ width: 390, height: 844 }, 'mobile');
await fs.writeFile(`${artifacts}/browser-logs.json`, JSON.stringify(logs, null, 2));
if (logs.pageErrors.length || logs.failedRequests.length || logs.console.some(x => x.type === 'error')) throw new Error(`Browser errors found; inspect ${artifacts}/browser-logs.json`);
console.log(JSON.stringify({ desktop, mobile, desktopDraw, mobileDraw, desktopWorld, mobileWorld, artifacts, browserErrors: logs.pageErrors.length, failedRequests: logs.failedRequests.length }, null, 2)); await browser.close();
