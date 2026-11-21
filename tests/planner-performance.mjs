import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});let writes=0;
 await page.route('**/api/**',r=>{if(r.request().method()==='POST')writes++;return r.fulfill({json:r.request().method()==='POST'?{ok:true}:{project:{name:'Benchmark'},shots:[],people:[],stages:[],cells:{}}})});
 await page.addInitScript(()=>sessionStorage.setItem('animation-workspace-key','benchmark'));
 await page.goto(process.env.UI_TEST_URL||'http://127.0.0.1:4182/?view=gantt');await page.waitForSelector('.task-planner');
 const metrics=await page.evaluate(()=>{
  state.people=Array.from({length:30},(_,i)=>({id:'p'+i,name:'Person '+i,color:'#80dac5'}));
  state.productionTeams=Array.from({length:6},(_,i)=>({id:'t'+i,name:'Team '+i,color:'#80dac5'}));
  state.productionTasks=Array.from({length:1000},(_,i)=>({id:'benchmark'+i,title:'Production task '+i,teamId:'t'+i%6,assignee:'p'+i%30,start:'2026-11-20',due:'2026-11-24',status:['not_started','in_progress','done','published'][i%4]}));
  const started=performance.now();currentTab='gantt';render();document.body.offsetHeight;
  return {renderMs:performance.now()-started,nodes:document.querySelectorAll('*').length,dayButtons:document.querySelectorAll('.planner-day-slot').length,rows:document.querySelectorAll('.planner-gantt-row').length};
 });
 assert.ok(metrics.nodes<10000);assert.ok(metrics.rows<60);assert.equal(metrics.dayButtons,0);
 await page.getByRole('button',{name:'Next tasks',exact:true}).click();assert.match(await page.locator('.planner-pager').textContent(),/51–100 of 1000/);
 await page.getByLabel('New task title',{exact:true}).fill('Draft kept');
 await page.getByLabel('Filter task team',{exact:true}).selectOption('t3');assert.equal(await page.getByLabel('New task title',{exact:true}).inputValue(),'Draft kept');
 const search=page.getByLabel('Search tasks',{exact:true});await search.evaluate(el=>window.savedSearchInput=el);await search.fill('Production task 999');
 await page.waitForFunction(()=>document.querySelector('.planner-stats b').textContent==='1');
 assert.ok(await search.evaluate(el=>el===window.savedSearchInput&&document.activeElement===el));
 assert.equal(await page.getByLabel('Team for Production task 999',{exact:true}).inputValue(),'t3');assert.equal(writes,0);
 await search.fill('');await page.waitForFunction(()=>document.querySelector('.planner-stats b').textContent!=='1');
 await page.getByLabel('Filter task team',{exact:true}).selectOption('');
 await page.getByRole('button',{name:'Board',exact:true}).click();assert.equal(await page.locator('.planner-card').count(),100);
 await page.locator('.planner-column').first().getByRole('button',{name:/Show more/}).click();assert.equal(await page.locator('.planner-card').count(),125);
 assert.equal(await page.evaluate(()=>state.productionTasks.length),1000);
 console.log('PASS bounded rendering, pagination, draft preservation, focused search across all tasks, board load more; APIs mocked.');console.log(JSON.stringify(metrics));
}finally{await browser.close()}
