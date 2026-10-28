/* Crop correction uses the original upload, before review/import. */
(() => {
  'use strict';
  const render = Wizard._renderReview.bind(Wizard);
  Wizard._renderReview = function(list, counter) {
    render(list, counter);
    list.querySelectorAll('.review-card').forEach(card => {
      const panel = this.state.panels.find(p => p._idx === Number(card.dataset.idx));
      if (!panel) return;
      const tools = document.createElement('div'); tools.className = 'crop-review-tools';
      const label = document.createElement('small');
      label.textContent = panel.bbox_source === 'detected_border' ? 'Border-detected crop — verify' : panel.bbox_source === 'manual' ? 'Manually adjusted crop' : 'Estimated crop — verify boundaries';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Edit thumbnail';
      button.setAttribute('aria-label',`Edit thumbnail for drawing ${panel._idx + 1}`);
      button.disabled = !this.state.file;
      if (button.disabled) button.title = 'Rescan the original page to adjust its crops.';
      button.onclick = () => edit(panel).catch(e => alert('Cannot open crop editor: ' + e.message));
      tools.append(label,button); card.querySelector('.fields').append(tools);
    });
  };
  async function edit(panel) {
    const image = await createImageBitmap(Wizard.state.file);
    const dialog = document.createElement('dialog'); dialog.className = 'crop-editor';
    dialog.innerHTML = '<form><h3>Edit drawing thumbnail</h3><p>Move the crop box or drag its lower-right corner. The original page stays unchanged.</p><canvas aria-label="Original storyboard with crop boundaries"></canvas><div class="crop-coordinates"></div><p role="status"></p><div class="thumbnail-edit-buttons"><button type="button" data-edit="left">Rotate left</button><button type="button" data-edit="right">Rotate right</button><button type="button" data-edit="flipX" aria-pressed="false">Flip horizontal</button><button type="button" data-edit="flipY" aria-pressed="false">Flip vertical</button><button type="button" data-edit="reset">Restore original</button></div><div class="thumbnail-adjustments"></div><p>Thumbnail preview</p><img class="thumbnail-edit-preview" alt="Edited thumbnail preview"><div class="actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">Save thumbnail</button></div></form>';
    const canvas = dialog.querySelector('canvas'), factor = Math.min(1,1100/Math.max(image.width,image.height));
    canvas.width = Math.max(1,Math.round(image.width*factor)); canvas.height = Math.max(1,Math.round(image.height*factor));
    const valid = b => ['x','y','w','h'].every(k=>Number.isInteger(b[k])) && b.x>=0 && b.y>=0 && b.w>0 && b.h>0 && b.x+b.w<=image.width && b.y+b.h<=image.height;
    let box = panel.bbox && valid(panel.bbox) ? {...panel.bbox} : {x:0,y:0,w:image.width,h:image.height};
    const originalBox = panel.original_bbox && valid(panel.original_bbox) ? {...panel.original_bbox} : {...box};
    const originalSource = panel.original_bbox_source || panel.bbox_source || 'model_estimate';
    const defaults = {rotation:0,flipX:false,flipY:false,brightness:100,contrast:100,saturation:100};
    let edits = {...defaults,...panel.thumbnail_edits};
    const inputs = {}, status = dialog.querySelector('[role=status]'), save = dialog.querySelector('[type=submit]');
    const sliders = {};
    for(const key of ['brightness','contrast','saturation']){
      const label=document.createElement('label');label.textContent=key[0].toUpperCase()+key.slice(1);
      const input=document.createElement('input');input.type='range';input.min=key==='saturation'?'0':'50';input.max=key==='saturation'?'200':'150';input.value=edits[key];input.setAttribute('aria-label',label.textContent);
      const value=document.createElement('output');value.textContent=edits[key]+'%';sliders[key]={input,value};
      input.oninput=()=>{edits[key]=Number(input.value);value.textContent=input.value+'%';preview();};label.append(input,value);dialog.querySelector('.thumbnail-adjustments').append(label);
    }
    dialog.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>{
      const action=button.dataset.edit;
      if(action==='left')edits.rotation=(edits.rotation+270)%360;
      else if(action==='right')edits.rotation=(edits.rotation+90)%360;
      else if(action==='reset'){box={...originalBox};edits={...defaults};for(const [key,slider] of Object.entries(sliders)){slider.input.value=edits[key];slider.value.textContent=edits[key]+'%';}draw();}
      else edits[action]=!edits[action];
      for(const key of ['flipX','flipY'])dialog.querySelector(`[data-edit=${key}]`).setAttribute('aria-pressed',String(!!edits[key]));
      preview();
    });
    for(const key of ['flipX','flipY'])dialog.querySelector(`[data-edit=${key}]`).setAttribute('aria-pressed',String(!!edits[key]));
    function preview(){dialog.querySelector('.thumbnail-edit-preview').src='data:image/png;base64,'+StoryboardGeometry.crop(image,box,edits);}
    for (const key of ['x','y','w','h']) {
      const label = document.createElement('label'); label.textContent = {x:'Left',y:'Top',w:'Width',h:'Height'}[key]+' (px)';
      const input = document.createElement('input'); input.type='number'; input.step='1'; input.required=true; input.min=key==='w'||key==='h'?'1':'0'; input.setAttribute('aria-label',label.textContent);
      inputs[key]=input; label.append(input); dialog.querySelector('.crop-coordinates').append(label);
      input.oninput = () => {
        const next=Object.fromEntries(Object.entries(inputs).map(([k,field])=>[k,Number(field.value)]));
        if(!Object.values(inputs).every(field=>field.value!=='')||!valid(next)){status.textContent='Keep the rectangle within the original image.';save.disabled=true;return;}
        box=next;draw(false);
      };
    }
    function draw(update=true) {
      const ctx=canvas.getContext('2d'),sx=canvas.width/image.width,sy=canvas.height/image.height;
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for(const other of Wizard.state.panels){if(other===panel||!other.bbox)continue;const b=other.bbox;ctx.strokeStyle='#00a5b5';ctx.lineWidth=1;ctx.strokeRect(b.x*sx,b.y*sy,b.w*sx,b.h*sy);}
      ctx.strokeStyle='#ff0055';ctx.lineWidth=2;ctx.strokeRect(box.x*sx,box.y*sy,box.w*sx,box.h*sy);ctx.fillStyle='#ff0055';ctx.fillRect((box.x+box.w)*sx-6,(box.y+box.h)*sy-6,12,12);
      if(update)for(const key of Object.keys(inputs))inputs[key].value=box[key];
      status.textContent=`Original image: ${image.width} × ${image.height} pixels.`;save.disabled=false;
      preview();
    }
    let drag;
    const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*image.width/r.width,y:(e.clientY-r.top)*image.height/r.height};};
    canvas.onpointerdown=e=>{const p=point(e),r=canvas.getBoundingClientRect(),corner=Math.abs(p.x-box.x-box.w)<16*image.width/r.width&&Math.abs(p.y-box.y-box.h)<16*image.height/r.height;if(!corner&&(p.x<box.x||p.x>box.x+box.w||p.y<box.y||p.y>box.y+box.h))return;drag={point:p,box:{...box},corner};canvas.setPointerCapture(e.pointerId);};
    canvas.onpointermove=e=>{if(!drag)return;const p=point(e),dx=Math.round(p.x-drag.point.x),dy=Math.round(p.y-drag.point.y),b=drag.box;box=drag.corner?{...b,w:Math.max(1,Math.min(image.width-b.x,b.w+dx)),h:Math.max(1,Math.min(image.height-b.y,b.h+dy))}:{...b,x:Math.max(0,Math.min(image.width-b.w,b.x+dx)),y:Math.max(0,Math.min(image.height-b.h,b.y+dy))};draw();};
    canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;};
    dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
    dialog.querySelector('form').onsubmit=e=>{
      e.preventDefault();if(!valid(box))return;
      panel.original_bbox={...originalBox};panel.original_bbox_source=originalSource;panel.bbox={...box};panel.bbox_source=JSON.stringify(box)===JSON.stringify(originalBox)?originalSource:'manual';panel.thumbnail_edits={...edits};panel.thumbnail_b64=StoryboardGeometry.crop(image,box,edits);panel._clientCrop=true;
      document.dispatchEvent(new CustomEvent('storyboard-crop-updated',{detail:{importId:Wizard.state.result?.import_id,index:panel._idx,panel}}));
      dialog.close();Wizard._renderReview(document.querySelector('#reviewList'),document.querySelector('#panelCount'));
    };
    dialog.addEventListener('close',()=>{image.close();dialog.remove();},{once:true});
    document.body.append(dialog);draw();dialog.showModal();
  }
})();
