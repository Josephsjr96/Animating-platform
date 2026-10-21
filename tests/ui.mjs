// Run with: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/ui.mjs
// All API traffic is intercepted. No requests reach the production Worker.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();const errors=[];const checks=[];const calls=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
let workspace=null;let scans=0;
await context.route('**/api/**',async route=>{
  const request=route.request();const path=new URL(request.url()).pathname;
  calls.push({method:request.method(),path});
  let data={};
  if(path==='/api/workspace'){
    if(request.method()==='POST'){workspace=request.postDataJSON();data={ok:true};}
    else data=workspace||{empty:true};
  }else if(path==='/api/import/scan'){
    scans++;data={import_id:'test-import-'+scans,panel_count:1,source:'test fixture',panels:[{number:'TEST'+scans,description:'Director review',dialogue:'',duration:4,confidence:.9,notes:'',thumbnail_b64:''}]};
  }else if(path.endsWith('/review'))data={ok:true};
  else if(path.endsWith('/commit'))data={ok:true,added:['test'],total_shots:workspace.shots.length+1,workspace};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
await page.addInitScript(()=>sessionStorage.setItem('animation-workspace-key','test-key'));
await mkdir('screenshots',{recursive:true});
try{
  await page.goto(process.env.UI_TEST_URL||'http://127.0.0.1:4182',{waitUntil:'networkidle'});
  await page.waitForSelector('#shotTable');await page.waitForSelector('#splash',{state:'detached'});
  check('Shot list is the default view',await page.getByRole('heading',{name:'Every frame starts here.'}).isVisible());
  check('No startup JavaScript errors',errors.length===0);
  check('Desktop has no document overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'screenshots/studio-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'+ 3 elements',exact:true}).first().click();
  check('Existing shot elements expand on demand',await page.locator('#shotTable tbody tr:visible').count()>await page.locator('#shotTable .shotnum:visible').count());
  await page.getByRole('button',{name:'− 3 elements',exact:true}).click();
  await page.getByRole('button',{name:'⇅ Unlock shot order',exact:true}).click();
  await page.getByRole('button',{name:'Move SH010',exact:true}).focus();
  await page.keyboard.press('Alt+ArrowDown');
  check('Shot order can be changed with the keyboard',await page.evaluate(()=>state.shots[1].number==='SH010'));
  await page.keyboard.press('Alt+ArrowUp');
  check('Reordering preserves shot records and restores order',await page.evaluate(()=>state.shots[0].number==='SH010'));
  await page.getByRole('button',{name:'⇅ Lock shot order',exact:true}).click();
  check('Lock hides reorder controls',await page.locator('.order-handle').count()===0);
  const initial=await page.evaluate(()=>state.shots.length);
  await page.getByRole('textbox',{name:'Search shots',exact:true}).fill('SH010');
  check('Search filters shot groups',await page.locator('#shotTable .shotnum:visible').count()===1);
  await page.getByRole('textbox',{name:'Search shots',exact:true}).fill('no matching shot');
  check('Search empty state is visible',await page.getByRole('heading',{name:'No shots in this view.'}).isVisible());
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.getByRole('button',{name:'+ Add shots',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Number of shots'}).fill('20');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  check('Bulk creation adds 20 shots',await page.evaluate(()=>state.shots.length)===initial+20);
  check('New shots have no default elements',await page.evaluate(()=>state.shots.slice(-20).every(s=>s.elements.length===0)));
  await page.getByRole('checkbox',{name:'Select SH010',exact:true}).check();
  await page.locator('[data-bulk=done]').click();
  check('Bulk status updates shot and element cells',await page.evaluate(()=>state.stages.every(st=>getCell(state.shots[0].id,null,st.id).status==='done'&&state.shots[0].elements.every(e=>getCell(state.shots[0].id,e.id,st.id).status==='done'))));
  await page.evaluate(()=>{const shot=state.shots.at(-1);getCell(shot.id,null,state.stages[0].id).due=iso(today());});
  check('Whole-shot dates are included in scheduling',await page.evaluate(()=>calendarEvents().some(e=>e.shot.id===state.shots.at(-1).id)));
  const cell=page.locator('#shotTable .cell').first();await cell.focus();await page.keyboard.press('Enter');
  check('Task editor supports keyboard',await page.getByRole('dialog',{name:'Edit production task'}).isVisible());
  await page.keyboard.press('Escape');
  check('Escape closes task editor',await page.locator('.popover').count()===0);
  await page.getByRole('button',{name:/Compact rows/}).click();
  check('Compact density toggles',await page.locator('.compact').count()===1);
  const thumb=page.getByRole('button',{name:'Upload thumbnail for SH010'});
  const picker=page.waitForEvent('filechooser');await thumb.click();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  await (await picker).setFiles({name:'thumbnail.png',mimeType:'image/png',buffer:png});
  await page.waitForFunction(()=>state.shots[0].thumbnail.startsWith('data:image/png'));
  check('Independent thumbnail upload saves image',await page.locator('#shotTable .thumb img').first().isVisible());
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
  await page.getByRole('button',{name:'Week',exact:true}).click();
  check('Week mode shows seven days',await page.locator('.schedule-day').count()===7);
  await page.getByRole('button',{name:'Day',exact:true}).click();
  check('Day mode shows one day',await page.locator('.schedule-day').count()===1);
  await page.getByRole('button',{name:'Year',exact:true}).click();
  check('Year mode shows twelve navigable months',await page.locator('.month-card').count()===12);
  await page.locator('.month-card').first().click();
  check('Month navigation opens original calendar',await page.locator('.cal .day').count()===42);
  await page.screenshot({path:'screenshots/studio-calendar.png',fullPage:true});
  await page.getByRole('button',{name:'Timeline',exact:true}).click();
  check('Timeline displays scheduled tasks',await page.locator('.timeline-task').count()>0);
  await page.getByRole('combobox',{name:'Group timeline'}).selectOption('shot');
  check('Timeline can group by shot',await page.locator('.timeline-label').first().textContent()==='SHOT');
  await page.screenshot({path:'screenshots/studio-timeline.png',fullPage:true});
  await page.getByRole('button',{name:'Storyboard import',exact:true}).click();
  check('Original single-page scanner still exists',await page.locator('#scanBtn').count()===1);
  await page.locator('#file').setInputFiles({name:'single-page.png',mimeType:'image/png',buffer:png});
  await page.locator('#scanBtn').click();
  await page.waitForSelector('.step-3:not([hidden])');
  check('Original single-page scan reaches editable review',await page.locator('.review-card [data-role=number]').inputValue()==='TEST1');
  await page.getByRole('button',{name:'Shot list',exact:true}).click();
  await page.getByRole('button',{name:'Storyboard import',exact:true}).click();
  await page.locator('.scan-queue summary').click();
  await page.getByLabel('Storyboard page queue').setInputFiles(Array.from({length:10},(_,i)=>({name:`page-${i+1}.png`,mimeType:'image/png',buffer:png})));
  await page.getByRole('button',{name:'Scan queued pages',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.queue-item button').length===10);
  check('Ten-page batch submits each page via existing API',scans===11);
  await page.getByRole('button',{name:'Review page →',exact:true}).first().click();
  check('Batch result opens original review flow',await page.locator('.step-3').isVisible()&&await page.locator('.review-card').count()===1);
  await page.getByRole('button',{name:'Import to shot list →',exact:true}).click();
  await page.waitForSelector('.step-4:not([hidden])');
  check('Existing review and commit endpoints are reused',calls.some(c=>c.path==='/api/import/test-import-2/review')&&calls.some(c=>c.path==='/api/import/test-import-2/commit'));
  check('Imported queue page cannot be committed twice',await page.getByRole('button',{name:'Imported ✓'}).isDisabled());
  await page.getByRole('button',{name:'Review page →',exact:true}).first().click();
  await page.screenshot({path:'screenshots/studio-import.png',fullPage:true});
  for(const width of [390,768,1024]){
    await page.setViewportSize({width,height:900});
    for(const tab of ['Shot list','Calendar','Timeline','Storyboard import','Workspace settings']){
      await page.getByRole('button',{name:tab,exact:true}).click();
      check(`${width}px ${tab} has no document overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    await page.getByRole('button',{name:'Shot list',exact:true}).click();
    if(width===390){
      const target=page.locator('.cell').first();await target.focus();await page.keyboard.press('Enter');
      const bounds=await page.locator('.popover').boundingBox();check('Mobile editor fits viewport',bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=900);await page.keyboard.press('Escape');
    }
    await page.screenshot({path:`screenshots/studio-${width}.png`,fullPage:true});
  }
  check('No JavaScript errors across all interactions',errors.length===0);
  await writeFile('screenshots/validation.json',JSON.stringify({checks,errors,apiCalls:calls.length,productionRequests:0},null,2));
  console.log(`${checks.length} checks passed. All API requests were mocked.`);
}finally{await browser.close();}
