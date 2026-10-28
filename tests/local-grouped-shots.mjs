// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs UI_TEST_URL=http://127.0.0.1:4182 node tests/local-grouped-shots.mjs
// API calls are intercepted; no production data is read or written.
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']});
try {
  const context = await browser.newContext();
  const writes = [];
  await context.addInitScript(() => sessionStorage.setItem('animation-workspace-key','fixture'));
  await context.route('**/api/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({json:{empty:true}});
    writes.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:4182');
  await page.getByRole('button',{name:'Storyboard import',exact:true}).click();
  const panel = (idx, group, number) => ({_idx:idx, reviewGroup:group, number, include:true, notes:'原画', dialogue:'Hello', description:'Director action'});
  const draft = {version:1,pages:{a:{importId:'a',filename:'a.png',panels:[panel(0,'g1','C001'),panel(1,'g2','C002')]},b:{importId:'b',filename:'b.png',panels:[panel(0,'g1','C001')]}}};
  await page.getByLabel('Restore review draft').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(draft))});
  await page.getByText('Draft restored. Choose a saved page and open it to review.').waitFor();
  const commit = page.getByRole('button',{name:'Import reviewed shots locally',exact:true});
  await commit.click();
  await page.getByText('Imported 2 shots with 3 drawings locally. Cloud workspace unchanged.').waitFor();
  await commit.click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('nuvren-storyboard-shots-v1')).shots);
  const shots = await read();
  assert.equal(shots.length,2);
  assert.deepEqual(shots[0].drawings.map(d=>d.pageId),['a','b']);
  assert.equal(shots[0].duration,null);
  await page.getByText('C001 · 2 drawings',{exact:true}).click();
  assert.equal(await page.getByLabel('Local imported shots').locator('details[open]').getByText(/Notes: 原画/).count(),2);
  await page.getByLabel('Saved review page').selectOption('a');
  await page.getByRole('button',{name:'Open saved review',exact:true}).click();
  await page.getByLabel('Shot number for drawing 2',{exact:true}).fill('C001');
  await commit.click();
  await page.getByText(/Shot number C001 belongs to separate groups/).waitFor();
  assert.deepEqual(await read(),shots);
  await page.getByLabel('Restore review draft').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":9}')});
  await page.getByText('Invalid review draft. Existing review retained.').waitFor();
  assert.deepEqual(await read(),shots);
  assert.deepEqual(writes,[]);
  console.log('PASS: restore, grouped import, cross-page drawings, gallery, idempotency, duplicate rejection, invalid-file protection, zero cloud writes');
} finally { await browser.close(); }
