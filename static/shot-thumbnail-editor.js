/* Shot-list thumbnail crops retain their source so later edits can restore it. */
(() => {
  'use strict';
  function open({shot,source,onSave,onReplace}) {
    if(document.querySelector('.shot-thumbnail-editor[open]'))return;
    const dialog=document.createElement('dialog');
    dialog.className='shot-thumbnail-editor';
    dialog.setAttribute('aria-labelledby','shotThumbnailTitle');
    dialog.innerHTML='<div class="thumbnail-editor-header"><h3 id="shotThumbnailTitle"></h3><button type="button" data-enlarge aria-pressed="false">Enlarge window</button></div><p>Drag to select a crop. Drag its corner to resize, or choose Move crop to reposition it.</p><div class="thumbnail-editor-tools"><button type="button" data-mode="draw" aria-pressed="true">Select crop</button><button type="button" data-mode="move" aria-pressed="false">Move crop</button><button type="button" data-reset>Restore original</button><button type="button" data-replace>Replace image</button></div><div class="thumbnail-editor-viewport"><canvas aria-label="Thumbnail crop selection"></canvas></div><form><div class="crop-coordinates"></div><p role="status" aria-live="polite">Opening image…</p><div class="actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary" disabled>Save thumbnail</button></div></form>';
    dialog.querySelector('h3').textContent=`Thumbnail · ${shot.number}`;
    const canvas=dialog.querySelector('canvas'),ctx=canvas.getContext('2d');
    const status=dialog.querySelector('[role=status]'),save=dialog.querySelector('[type=submit]');
    const image=new Image(),inputs={};
    const viewport=dialog.querySelector('.thumbnail-editor-viewport');
    function fit(){if(ready)canvas.style.width=Math.min(viewport.clientWidth,image.naturalWidth/image.naturalHeight*innerHeight*(dialog.classList.contains('enlarged')?.65:.45))+'px';}
    const resize=new ResizeObserver(fit);resize.observe(viewport);
    window.addEventListener('resize',fit);
    let box,drag,mode='draw',ready=false,busy=false;
    let cleaned=false;
    function cleanup(){if(cleaned)return;cleaned=true;resize.disconnect();window.removeEventListener('resize',fit);image.onload=image.onerror=null;image.src='';dialog.remove();}
    function close(){dialog.close();cleanup();}
    const valid=b=>b&&['x','y','w','h'].every(k=>Number.isInteger(b[k]))&&b.x>=0&&b.y>=0&&b.w>0&&b.h>0&&b.x+b.w<=image.naturalWidth&&b.y+b.h<=image.naturalHeight;
    const setMode=value=>{mode=value;canvas.style.cursor=value==='draw'?'crosshair':'move';dialog.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===value)));};
    function draw(updateInputs=true) {
      if(!ready)return;
      const sx=canvas.width/image.naturalWidth,sy=canvas.height/image.naturalHeight;
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      ctx.fillStyle='#050b1199';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.clearRect(box.x*sx,box.y*sy,box.w*sx,box.h*sy);
      ctx.drawImage(image,box.x,box.y,box.w,box.h,box.x*sx,box.y*sy,box.w*sx,box.h*sy);
      ctx.strokeStyle='#80dac5';ctx.lineWidth=2;ctx.strokeRect(box.x*sx,box.y*sy,box.w*sx,box.h*sy);
      ctx.fillStyle='#80dac5';ctx.fillRect((box.x+box.w)*sx-6,(box.y+box.h)*sy-6,12,12);
      if(updateInputs)for(const key of Object.keys(inputs))inputs[key].value=box[key];
      status.textContent=`Crop: ${box.w} × ${box.h} pixels. Original: ${image.naturalWidth} × ${image.naturalHeight} pixels.`;
      save.disabled=false;
    }
    for(const key of ['x','y','w','h']){
      const label=document.createElement('label');label.textContent={x:'Left',y:'Top',w:'Width',h:'Height'}[key]+' (px)';
      const input=document.createElement('input');input.type='number';input.step='1';input.required=true;input.min=key==='w'||key==='h'?'1':'0';input.disabled=true;input.setAttribute('aria-label',label.textContent);
      inputs[key]=input;label.append(input);dialog.querySelector('.crop-coordinates').append(label);
      input.oninput=()=>{
        const next=Object.fromEntries(Object.entries(inputs).map(([k,f])=>[k,Number(f.value)]));
        if(!Object.values(inputs).every(f=>f.value!=='')||!valid(next)){save.disabled=true;status.textContent='Keep the crop inside the original image, with a width and height greater than zero.';return;}
        box=next;draw(false);
      };
    }
    dialog.querySelector('[data-enlarge]').onclick=e=>{
      const enlarged=dialog.classList.toggle('enlarged');e.currentTarget.textContent=enlarged?'Normal window':'Enlarge window';e.currentTarget.setAttribute('aria-pressed',String(enlarged));fit();
    };
    dialog.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
    dialog.querySelector('[data-reset]').onclick=()=>{if(ready){box={x:0,y:0,w:image.naturalWidth,h:image.naturalHeight};draw();setMode('draw');}};
    dialog.querySelector('[data-replace]').onclick=()=>{close();onReplace();};
    dialog.querySelector('[data-cancel]').onclick=close;
    const point=e=>{const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(image.naturalWidth,Math.round((e.clientX-r.left)*image.naturalWidth/r.width))),y:Math.max(0,Math.min(image.naturalHeight,Math.round((e.clientY-r.top)*image.naturalHeight/r.height)))};};
    canvas.onpointerdown=e=>{
      if(!ready||e.button!==0)return;
      const p=point(e),r=canvas.getBoundingClientRect();
      const corner=Math.abs(p.x-box.x-box.w)<12*image.naturalWidth/r.width&&Math.abs(p.y-box.y-box.h)<12*image.naturalHeight/r.height;
      if(mode==='move'&&!corner&&(p.x<box.x||p.x>box.x+box.w||p.y<box.y||p.y>box.y+box.h))return;
      drag={point:p,box:{...box},kind:corner?'resize':mode};canvas.setPointerCapture(e.pointerId);e.preventDefault();
    };
    canvas.onpointermove=e=>{
      if(!drag)return;const p=point(e),b=drag.box,dx=p.x-drag.point.x,dy=p.y-drag.point.y;
      if(drag.kind==='resize')box={...b,w:Math.max(1,Math.min(image.naturalWidth-b.x,b.w+dx)),h:Math.max(1,Math.min(image.naturalHeight-b.y,b.h+dy))};
      else if(drag.kind==='move')box={...b,x:Math.max(0,Math.min(image.naturalWidth-b.w,b.x+dx)),y:Math.max(0,Math.min(image.naturalHeight-b.h,b.y+dy))};
      else box={x:Math.min(p.x,drag.point.x,image.naturalWidth-1),y:Math.min(p.y,drag.point.y,image.naturalHeight-1),w:Math.max(1,Math.abs(dx)),h:Math.max(1,Math.abs(dy))};
      draw();
    };
    canvas.onpointerup=canvas.onpointercancel=()=>{if(drag?.kind==='draw')setMode('move');drag=null;};
    dialog.querySelector('form').onsubmit=async e=>{
      e.preventDefault();if(!ready||busy||save.disabled||!valid(box))return;
      try{
        const output=document.createElement('canvas'),scale=Math.min(1,960/Math.max(box.w,box.h));
        output.width=Math.max(1,Math.round(box.w*scale));output.height=Math.max(1,Math.round(box.h*scale));
        output.getContext('2d').drawImage(image,box.x,box.y,box.w,box.h,0,0,output.width,output.height);
        const data=output.toDataURL('image/png');busy=true;save.disabled=true;dialog.inert=true;
        await onSave(data,{...box},source);close();
      }catch{status.textContent='This image could not be saved. Use Replace image to upload a local copy.';}
      finally{busy=false;dialog.inert=false;save.disabled=!ready;}
    };
    image.onload=()=>{
      if(!dialog.isConnected)return;
      const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      box=valid(shot.thumbnail_crop)?{...shot.thumbnail_crop}:{x:0,y:0,w:image.naturalWidth,h:image.naturalHeight};
      ready=true;Object.values(inputs).forEach(i=>i.disabled=false);draw();setMode('draw');fit();
    };
    image.onerror=()=>{status.textContent='This image could not be opened for cropping. Use Replace image to upload a local copy.';};
    dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
    dialog.addEventListener('close',cleanup,{once:true});
    document.body.append(dialog);dialog.showModal();
    if(/^https?:/i.test(source))image.crossOrigin='anonymous';
    image.src=source;
  }
  window.ShotThumbnailEditor={open};
})();
