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
for(const count of [1,5,10,20,50]){
 const {width,height,data}=page(count),frames=detectPixels(width,height,data);
 assert.equal(frames.length,count);
 for(let i=0;i<count;i++)assert.deepEqual(frames[i],{x:50,y:15+i*70,w:261,h:61});
}
const blank=new Uint8ClampedArray(490*743*4).fill(255);
assert.deepEqual(detectPixels(490,743,blank),[]);
// Horizontal text/rules without full side borders must not become frames.
for(const y of [25,100,175])for(let x=40;x<310;x++){const i=(y*490+x)*4;blank[i]=blank[i+1]=blank[i+2]=0;}
assert.deepEqual(detectPixels(490,743,blank),[]);
console.log('PASS: exact inner-border pixels, 1/5/10/20/50 frames, blank pages, rejection of borderless rules');
