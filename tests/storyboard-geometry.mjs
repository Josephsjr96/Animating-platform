import assert from 'node:assert/strict';
import '../static/storyboard-geometry.js';
const {detectPixels}=globalThis.StoryboardGeometry;
function page(count){
 const width=490,height=count*70+20,data=new Uint8ClampedArray(width*height*4).fill(255);
 const black=(x,y)=>{const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;};
 for(let i=0;i<count;i++)for(let y=10+i*70;y<=80+i*70;y++)for(let x=45;x<=315;x++){
  if(y<=14+i*70||y>=76+i*70||x<=49||x>=311)black(x,y);
 }
 return {width,height,data};
}
for(const count of [1,5,7,10,20,50]){
 const {width,height,data}=page(count),frames=detectPixels(width,height,data);
 assert.equal(frames.length,count);
 for(let i=0;i<count;i++)assert.deepEqual(frames[i],{x:50,y:15+i*70,w:261,h:61});
}
// A nearby unrelated horizontal rule must not hide the third frame.
const interrupted=page(7);
for(let x=35;x<=325;x++){
 const i=((10+2*70+30)*interrupted.width+x)*4;
 interrupted.data[i]=interrupted.data[i+1]=interrupted.data[i+2]=0;
}
const recovered=detectPixels(interrupted.width,interrupted.height,interrupted.data);
assert.equal(recovered.length,7);
assert.deepEqual(recovered[2],{x:50,y:155,w:261,h:61});
// Frames may span almost the entire source width.
const wide=page(7),wideData=new Uint8ClampedArray(280*wide.height*4).fill(255);
for(let y=0;y<wide.height;y++)wideData.set(wide.data.subarray((y*490+40)*4,(y*490+320)*4),y*280*4);
assert.equal(detectPixels(280,wide.height,wideData).length,7);
const blank=new Uint8ClampedArray(490*743*4).fill(255);
assert.deepEqual(detectPixels(490,743,blank),[]);
// Horizontal text/rules without full side borders must not become frames.
for(const y of [25,100,175])for(let x=40;x<310;x++){const i=(y*490+x)*4;blank[i]=blank[i+1]=blank[i+2]=0;}
assert.deepEqual(detectPixels(490,743,blank),[]);
console.log('PASS: exact inner-border pixels, 1/5/7/10/20/50 frames, seven-frame distractor and wide-page regressions, blank pages, rejection of borderless rules');
