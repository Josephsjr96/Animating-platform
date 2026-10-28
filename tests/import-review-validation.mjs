import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try {
  const page = await browser.newPage();
  await page.route('http://review.test/**', route => route.fulfill({contentType:'text/html',body:'<div id="importWizard"></div>'}));
  await page.goto('http://review.test/');
  await page.addScriptTag({content:await readFile(new URL('../static/app.js',import.meta.url),'utf8')});
  await page.evaluate(() => {
    window.writes=[];
    API.review=async(id,payload)=>{writes.push(payload);return {ok:true};};
    API.getWorkspace=async()=>({stages:[]});
    API.commit=async()=>({ok:true,added:['shot'],total_shots:1});
    Wizard.mount(document.querySelector('#importWizard'));
    Wizard.state={result:{import_id:'fixture'},showLowOnly:true,panels:[
      {_idx:0,include:true,number:'',duration:null,confidence:.9},
      {_idx:1,include:false,number:'',duration:null,confidence:.9}
    ]};
    document.querySelector('.step-3').hidden=false;
    Wizard._renderReview(document.querySelector('#reviewList'),document.querySelector('#panelCount'));
  });
  await page.locator('#commitBtn').click();
  assert.match(await page.locator('#reviewValidation').innerText(),/Check drawings: 1\./);
  assert.equal(await page.locator('[data-idx="0"] [data-role="duration"]').inputValue(),'');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.role),'number');
  assert.deepEqual(await page.evaluate(()=>writes),[]);
  await page.getByLabel('Cut number for drawing 1',{exact:true}).fill('C001');
  await page.locator('#commitBtn').click();
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.role),'duration');
  const duration=page.getByLabel('Duration in seconds for drawing 1',{exact:true});
  await duration.fill('2.5');
  await duration.fill('');
  assert.equal(await page.evaluate(()=>Wizard.state.panels[0].duration),null);
  await duration.fill('2.5');
  await page.locator('#commitBtn').click();
  await page.locator('.step-4:not([hidden])').waitFor();
  const writes=await page.evaluate(()=>writes);
  assert.equal(writes.length,1);
  assert.equal(writes[0].panels[0].duration,2.5);
  assert.equal(writes[0].panels[1].include,false);
  console.log('PASS: missing fields focus, hidden drawings revealed, blank duration preservation, fractional duration, skipped drawings, validated import');
} finally { await browser.close(); }
