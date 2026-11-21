import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage();let release;const gate=new Promise(resolve=>release=resolve);const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 let workspace={project:{name:'Slow cloud',start:'2026-11-01',deadline:'2026-12-31'},people:[],shots:[],stages:[],cells:{}};
 await page.route('**/api/**',async route=>{if(route.request().method()==='GET'){await gate;await route.fulfill({json:workspace})}else{workspace=route.request().postDataJSON();await route.fulfill({json:{ok:true}})}});
 await page.addInitScript(()=>{sessionStorage.setItem('animation-workspace-key','test');Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true})});
 await page.goto('http://127.0.0.1:4182/?view=gantt',{waitUntil:'domcontentloaded'});
 assert.equal(await page.locator('.task-planner').count(),0);
 release();await page.waitForSelector('.task-planner');
 await page.getByLabel('New task title',{exact:true}).fill('First task in empty workspace');
 await page.locator('.planner-quick-global button').click();
 await page.waitForFunction(()=>state.productionTasks?.length===1);
 assert.equal(await page.locator('.planner-gantt-bar').count(),1);
 await page.reload();await page.waitForSelector('.task-planner');
 assert.equal(await page.locator('.planner-gantt-bar').count(),1);
 assert.deepEqual(errors,[]);
 console.log('PASS delayed cloud load cannot expose a temporary planner; empty workspace can create tasks without randomUUID; direct-link reload retains the task');
}finally{await browser.close()}
