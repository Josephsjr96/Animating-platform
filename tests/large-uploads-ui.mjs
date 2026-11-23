import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>sessionStorage.setItem('animation-workspace-key','fixture'));
 const original=Buffer.alloc(16*1024*1024+1,73);
 Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64').copy(original);
 let scans=0;
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/workspace'){
   assert.equal(request.method(),'GET','No workspace writes during this test');
   return route.fulfill({json:{empty:true}});
  }
  assert.equal(path,'/api/import/scan');
  const form=await new Response(request.postDataBuffer(),{headers:{'content-type':request.headers()['content-type']}}).formData();
  assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()),original,'Browser must upload the original file');
  scans++;
  return route.fulfill({json:{import_id:'large-'+scans,panels:[{bbox:{x:0,y:0,w:1,h:1},number:'C001',duration:null,confidence:0}],panel_count:1}});
 });
 await page.goto(process.env.UI_TEST_URL||'http://127.0.0.1:4182');
 await page.getByRole('button',{name:'Storyboard import',exact:true}).click();
 const fixture={name:'large.png',mimeType:'image/png',buffer:original};
 await page.locator('#file').setInputFiles(fixture);
 await page.locator('#scanBtn').click();
 await page.waitForSelector('.step-3:not([hidden])');
 assert.equal(scans,1);
 await page.locator('.scan-queue summary').click();
 await page.getByLabel('Storyboard page queue').setInputFiles(fixture);
 assert.equal(await page.locator('.queue-item').count(),1,'Large file enters queue');
 await page.getByRole('button',{name:'Scan queued pages',exact:true}).click();
 await page.getByText('1 panels · ready for review',{exact:true}).waitFor();
 assert.equal(scans,2);assert.deepEqual(errors,[]);
 console.log('PASS: single-page and queued uploads above 16 MiB preserve original bytes in browser requests. All API traffic mocked.');
}finally{await browser.close();}
