/* UI extensions only. The original API client, importer, persistence and server are retained. */
(() => {
  'use strict';
  const original = {render, renderShotList, renderCalendar, renderImport, openCellEditor, calendarEvents};
  const ui = {search:'', filter:'all', compact:false, expanded:new Set(), selected:new Set(), calendarMode:'month', queue:[], scanning:false, orderLocked:true, timelineGroup:'stage'};
  function thumbnailSource(value) {
    if (typeof value !== 'string') return '';
    const source = value.trim();
    if (!source) return '';
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(source)) return source;
    if (/^https?:\/\//i.test(source)) return source;
    const raw = source.replace(/\s/g, '');
    return /^[A-Za-z0-9+/]+={0,2}$/.test(raw) ? 'data:image/png;base64,' + raw : '';
  }
  function showThumbnail(container, value, label) {
    const source = thumbnailSource(value);
    container.replaceChildren();
    if (!source) return;
    const image = document.createElement('img');
    image.alt = label;
    image.src = source;
    image.onerror = () => {
      image.remove();
      container.dataset.imageError = 'true';
      container.title = 'Thumbnail could not load. Upload a replacement image.';
    };
    container.append(image);
  }
  // Cloud scans may return artwork coordinates without encoded crop pixels.
  // Use the uploaded image for those crops; detection still belongs to the scanner.
  const scanResults = new Map();
  const reviewedPanels = new Map();
  const scanPage = API.scan.bind(API);
  API.scan = async function(file, onProgress) {
    const result = await scanPage(file, onProgress);
    if (!Array.isArray(result.panels)) return result;
    const missing = result.panels.filter(p => !thumbnailSource(p.thumbnail_b64 || p.thumbnail));
    if (missing.length) {
      let image;
      try {
        image = await createImageBitmap(file);
        for (const panel of missing) {
          const box = panel.bbox;
          if (!box || !['x','y','w','h'].every(k => typeof box[k] === 'number' && Number.isFinite(box[k])) || box.w <= 0 || box.h <= 0) continue;
          const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
          const right = Math.min(image.width, Math.ceil(box.x + box.w));
          const bottom = Math.min(image.height, Math.ceil(box.y + box.h));
          const width = right - x, height = bottom - y;
          if (width <= 0 || height <= 0) continue;
          const scale = Math.min(1, 320 / Math.max(width, height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
          panel.thumbnail_b64 = canvas.toDataURL('image/png').split(',')[1];
          panel._clientCrop = true;
        }
      } catch (error) {
        console.warn('[storyboard] Could not build preview crops:', error.message);
      } finally { image?.close(); }
    }
    scanResults.set(result.import_id, result.panels);
    if (scanResults.size > 30) {
      const oldest = scanResults.keys().next().value;
      scanResults.delete(oldest);reviewedPanels.delete(oldest);
    }
    return result;
  };
  const reviewPage = API.review.bind(API);
  API.review = async function(id, payload) {
    const result = await reviewPage(id, payload);
    const originals = scanResults.get(id);
    if (result.ok && originals && Array.isArray(payload.panels)) {
      reviewedPanels.set(id, payload.panels.map((p, i) => p.include === false ? null : originals[i]).filter(Boolean));
    }
    return result;
  };
  const commitPage = API.commit.bind(API);
  API.commit = async function(id, options) {
    const wasInert = document.body.inert;
    document.body.inert = true;
    try {
      const result = await commitPage(id, options);
      const panels = reviewedPanels.get(id);
      if (!result.ok || !panels?.some(p => p._clientCrop) || !Array.isArray(result.added) || result.added.length !== panels.length) return result;
      // Retain generated crops in the existing shot.thumbnail field. No new API
      // fields are sent to scan/review/commit and no Worker change is required.
      let workspace;
      try { workspace = result.workspace || await API.getWorkspace(); }
      catch { toast('Shots imported. Thumbnail sync could not finish; keep this page open.');return result; }
      if (!Array.isArray(workspace.shots)) return result;
      let changed = false;
      panels.forEach((panel, i) => {
        const shot = workspace.shots.find(s => s.id === result.added[i]);
        if (shot && panel._clientCrop && !thumbnailSource(shot.thumbnail || shot.thumbnail_b64)) {
          shot.thumbnail = panel.thumbnail_b64;changed = true;
        }
      });
      if (changed) {
        state = workspace;
        result.workspace = workspace;
        if (!await saveState(workspace)) toast('Shots imported. Thumbnails are in the local backup until cloud saving is restored.');
      }
      return result;
    } finally { document.body.inert = wasInert; }
  };
  const titles = {
    shotlist:['THE PRODUCTION FLOOR','Every frame starts here.','Shape the story, track the details, and keep your team moving together.','01 / SHOT LIST'],
    calendar:['THE BIG PICTURE','Make room for the story.','A shared rhythm for your production. Every task date, in one place.','02 / SCHEDULE'],
    gantt:['THE BIG PICTURE','See how it all connects.','From the first drawing to the final frame. Your shot dates become a production timeline.','02 / TIMELINE'],
    import:['FROM PAPER TO PIPELINE','Bring your story on board.','Scan, review, then import. You stay in control of every shot and every detail.','03 / STORYBOARD'],
    settings:['YOUR WORKSPACE','A pipeline that fits your team.','Manage your project, people, and production stages in one place.','04 / SETTINGS'],
    dashboard:['PRODUCTION INSIGHTS','A little perspective.','Progress and forecasts for when you need the bigger picture.','05 / INSIGHTS'],
    milestones:['PRODUCTION INSIGHTS','Find your production rhythm.','Weekly targets and actual progress, together.','06 / MILESTONES']
  };
  function toast(message) {
    document.querySelector('.toast')?.remove();
    const el=document.createElement('div');el.className='toast';el.setAttribute('role','status');el.textContent=message;document.body.append(el);
    setTimeout(()=>el.remove(),4500);
  }
  function switchTab(tab) {
    currentTab=tab;closeEditor();render();
    document.querySelectorAll('#tabs button').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-current',b.dataset.tab===tab?'page':'false');});
  }
  function dialog(title, description, fields, onSave) {
    const el=document.createElement('dialog');
    el.innerHTML=`<form><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${fields}<div class="actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">Create</button></div></form>`;
    el.querySelector('[data-cancel]').onclick=()=>el.close();
    el.addEventListener('close',()=>el.remove());
    el.querySelector('form').onsubmit=e=>{e.preventDefault();if(onSave(new FormData(e.target))!==false)el.close();};
    document.body.append(el);el.showModal();
  }
  function shell() {
    const header=document.querySelector('body > header');
    header.querySelector('h1').innerHTML='<span class="brand-mark" aria-hidden="true">◫</span> Frame / Studio';
    header.querySelector('h1').insertAdjacentHTML('afterend','<div class="brand-sub">Production workspace</div>');
    const nav=document.getElementById('tabs');
    const labels=[['shotlist','▤','Shot list'],['calendar','▦','Calendar'],['gantt','☷','Timeline'],['import','⊞','Storyboard import'],['settings','⚙','Workspace settings']];
    nav.innerHTML='<div class="nav-caption">WORKSPACE</div>'+labels.map(([tab,icon,label])=>`<button data-tab="${tab}" aria-current="${tab==='shotlist'?'page':'false'}" class="${tab==='shotlist'?'active':''}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`).join('');
    nav.querySelectorAll('button').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
    header.insertAdjacentHTML('beforeend','<div class="sidebar-footer"><span class="avatar">PS</span><div>Production studio<small>A place for your next story</small></div></div>');
    const bar=document.createElement('div');bar.className='workspace-topbar';
    bar.innerHTML='<div class="topbar-path"><span>Workspace</span><span aria-hidden="true">/</span><strong id="studioProject"></strong></div><div class="topbar-actions"><span class="muted"><i class="studio-dot"></i>Creative work, in motion</span><button id="studioInsights" title="Open production insights">Insights ↗</button></div>';
    header.after(bar);bar.querySelector('button').onclick=()=>switchTab('dashboard');
    const view=document.getElementById('view');view.setAttribute('aria-label','Production workspace');
  }
  render = function() {
    original.render();
    document.getElementById('studioProject').textContent=state.project.name||'Untitled production';
    const view=document.getElementById('view');const t=titles[currentTab]||titles.shotlist;
    const heading=document.createElement('section');heading.className='page-heading';
    heading.innerHTML=`<div><div class="eyebrow">${t[0]}</div><h2>${t[1]}</h2><p>${t[2]}</p></div><span class="page-index">${t[3]}</span>`;
    view.prepend(heading);
    document.querySelectorAll('#tabs button').forEach(b=>{b.classList.toggle('active',b.dataset.tab===currentTab);b.setAttribute('aria-current',b.dataset.tab===currentTab?'page':'false');});
    // Label the original form controls without changing their save handlers.
    view.querySelectorAll('input:not([aria-label]),textarea:not([aria-label]),select:not([aria-label])').forEach(el=>el.setAttribute('aria-label',el.dataset.field||el.dataset.pf||el.dataset.sf||el.getAttribute('placeholder')||el.id||el.type));
  };
  function summary() {
    const progress=Math.round(overallCompletion()*100);
    return `<section class="production-summary" aria-label="Production at a glance"><div class="summary-item"><div class="label">YOUR PRODUCTION</div><div class="value">${escapeHtml(state.project.name)}</div><div class="sub">A story in the making</div><div class="summary-progress"><i style="width:${progress}%"></i></div></div><div class="summary-item"><div class="label">SHOTS IN THE STORY</div><div class="value">${String(state.shots.length).padStart(2,'0')}</div><div class="sub">Every shot, accounted for</div></div><div class="summary-item"><div class="label">SCREEN TIME</div><div class="value">${totalSeconds()}<span style="font-size:12px;color:var(--muted)"> sec</span></div><div class="sub">Across your whole shot list</div></div><div class="summary-item"><div class="label">PIPELINE PROGRESS</div><div class="value">${progress}<span style="font-size:12px;color:var(--muted)"> %</span></div><div class="sub">${state.stages.length} production stages</div></div></section>`;
  }
  function addShots() {
    dialog('Build your next sequence.','Add one shot or a whole sequence. New shots start with no predefined elements.',
      `<label>Number of shots<input name="count" type="number" min="1" max="200" value="1" required></label><label>First shot number<input name="start" type="number" min="1" max="999999" value="${Math.max(0,...state.shots.map(s=>Number(String(s.number).replace(/\D/g,''))||0))+10}" required></label><label>Insert position<select name="after"><option value="">At the end</option>${state.shots.map(s=>`<option value="${escapeAttr(s.id)}">After ${escapeHtml(s.number)}</option>`).join('')}</select></label>`,
      data=>{
        const count=Number(data.get('count')),start=Number(data.get('start'));const shots=[];
        const numbers=new Set(state.shots.map(s=>s.number));
        for(let i=0;i<count;i++){const number='SH'+String(start+i*10).padStart(3,'0');if(numbers.has(number)){toast(`Shot ${number} already exists. Choose another starting number.`);return false;}shots.push({id:uid(),number,description:'',notes:'',dialogue:'',duration:4,order:0,thumbnail:'',elements:[]});}
        const after=data.get('after');const at=after?state.shots.findIndex(s=>s.id===after)+1:state.shots.length;
        state.shots.splice(at,0,...shots);state.shots.forEach((s,i)=>s.order=i);saveState();render();toast(`Added ${count} ${count===1?'shot':'shots'}.`);
      });
  }
  function uploadThumbnail(shot) {
    const file=document.createElement('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';
    file.onchange=()=>{
      const selected=file.files[0];if(!selected)return;
      if(!['image/png','image/jpeg','image/webp'].includes(selected.type)){toast('Choose a PNG, JPEG or WebP image.');return;}
      if(selected.size>10*1024*1024){toast('Choose an image smaller than 10 MB.');return;}
      const reader=new FileReader();reader.onload=()=>{
        const image=new Image();image.onload=()=>{
          const scale=Math.min(1,960/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
          shot.thumbnail=canvas.toDataURL('image/png');saveState();render();toast(`Thumbnail added to ${shot.number}.`);
        };image.onerror=()=>toast('This image could not be opened.');image.src=reader.result;
      };reader.readAsDataURL(selected);
    };file.click();
  }
  renderShotList = function(root) {
    root.insertAdjacentHTML('beforeend',summary());
    original.renderShotList(root);
    const wrap=root.lastElementChild;
    wrap.classList.toggle('compact',ui.compact);
    wrap.insertAdjacentHTML('afterbegin','<div class="view-switch"><button class="active" aria-current="true">▤ &nbsp; Production sheet</button><div class="spacer"></div><span class="muted">A clear view of every moving part</span></div>');
    const add=wrap.querySelector('#addShot');add.textContent='+ Add shots';add.onclick=addShots;
    const stage=wrap.querySelector('#addStage');stage.textContent='+ Add stage';
    stage.onclick=()=>dialog('Make space for a new stage.','Stages use the existing production pipeline and can be renamed in Workspace settings.', '<label>Stage name<input name="name" required maxlength="80" placeholder="e.g. Background painting"></label>',data=>{const name=String(data.get('name')).trim();if(!name)return false;state.stages.push({id:uid(),name,weight:1});saveState();render();});
    const toolbar=wrap.querySelector('.toolbar');
    const lock=document.createElement('button');lock.className='ghost';lock.textContent=ui.orderLocked?'⇅ Unlock shot order':'⇅ Lock shot order';lock.setAttribute('aria-pressed',String(ui.orderLocked));lock.onclick=()=>{ui.orderLocked=!ui.orderLocked;render();};toolbar.insertBefore(lock,toolbar.querySelector('.spacer'));
    const controls=document.createElement('div');controls.className='shot-controls';
    controls.innerHTML=`<label class="shot-search"><span aria-hidden="true">⌕</span><input aria-label="Search shots" placeholder="Search shots, dialogue, or notes…" value="${escapeAttr(ui.search)}"></label><select aria-label="Filter shots by status"><option value="all">All statuses</option><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="published">Published</option></select><div class="spacer"></div><button class="density-button" aria-pressed="${ui.compact}">☷ &nbsp; ${ui.compact?'Comfortable rows':'Compact rows'}</button>`;
    toolbar.after(controls);
    const batch=document.createElement('div');batch.className='batch-bar';batch.hidden=true;batch.innerHTML='<strong data-selected></strong><span>Set all stage cells to</span><button data-bulk="not_started">Not started</button><button data-bulk="in_progress">In progress</button><button data-bulk="done">Done</button><button data-bulk="published">Published</button><button data-clear>Clear selection</button>';controls.after(batch);
    const shotRows=[];const rows=[...wrap.querySelectorAll('#shotTable tbody > tr')];
    let group=null;
    for(const row of rows){
      const number=row.querySelector('.shotnum');
      if(number){
        const shot=state.shots[shotRows.length];group={shot,rows:[]};shotRows.push(group);
        const selector=document.createElement('label');selector.className='row-selector';selector.innerHTML=`<input type="checkbox" aria-label="Select ${escapeAttr(shot.number)}" ${ui.selected.has(shot.id)?'checked':''}>`;
        number.before(selector);selector.querySelector('input').onchange=e=>{e.target.checked?ui.selected.add(shot.id):ui.selected.delete(shot.id);updateSelection();};
        number.contentEditable='true';number.setAttribute('role','textbox');number.setAttribute('aria-label',`Shot number ${shot.number}`);number.setAttribute('spellcheck','false');
        number.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();number.blur();}};
        number.onblur=()=>{const value=number.textContent.trim();if(!value||state.shots.some(s=>s!==shot&&s.number===value)){number.textContent=shot.number;toast('Choose a unique shot number.');return;}shot.number=value;saveState();};
        if(!ui.orderLocked){
          const handle=document.createElement('button');handle.className='order-handle';handle.textContent='⠿';handle.draggable=true;handle.title='Drag to reorder, or use Alt + Arrow Up / Down';handle.setAttribute('aria-label',`Move ${shot.number}`);number.before(handle);
          const move=at=>{const from=state.shots.indexOf(shot);state.shots.splice(from,1);state.shots.splice(Math.max(0,Math.min(at,state.shots.length)),0,shot);state.shots.forEach((s,i)=>s.order=i);saveState();render();};
          handle.ondragstart=e=>{e.dataTransfer.setData('text/x-shot-id',shot.id);e.dataTransfer.effectAllowed='move';};
          row.ondragover=e=>{if(e.dataTransfer.types.includes('text/x-shot-id')){e.preventDefault();row.classList.add('drop-target');}};
          row.ondragleave=()=>row.classList.remove('drop-target');
          row.ondrop=e=>{e.preventDefault();const id=e.dataTransfer.getData('text/x-shot-id');const source=shotById(id);if(!source||source===shot)return;const at=state.shots.indexOf(shot);state.shots.splice(state.shots.indexOf(source),1);state.shots.splice(at,0,source);state.shots.forEach((s,i)=>s.order=i);saveState();render();};
          handle.onkeydown=e=>{if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();move(state.shots.indexOf(shot)+(e.key==='ArrowUp'?-1:1));document.querySelector(`[aria-label="Move ${CSS.escape(shot.number)}"]`)?.focus();}};
        }
        const thumb=row.querySelector('.thumb');
        showThumbnail(thumb,shot.thumbnail||shot.thumbnail_b64,`Storyboard thumbnail for ${shot.number}`);
        thumb.tabIndex=0;thumb.setAttribute('role','button');thumb.setAttribute('aria-label',`Upload thumbnail for ${shot.number}`);thumb.onclick=()=>uploadThumbnail(shot);thumb.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();uploadThumbnail(shot);}};
        const dialogue=row.querySelector('[data-field=dialogue]');const text=document.createElement('textarea');for(const a of dialogue.attributes)if(a.name!=='value')text.setAttribute(a.name,a.value);text.value=shot.dialogue||'';text.placeholder='Add dialogue…';text.setAttribute('aria-label',`Dialogue for ${shot.number}`);text.onchange=()=>{shot.dialogue=text.value;saveState();};dialogue.replaceWith(text);
        row.querySelectorAll('[data-field]').forEach(input=>input.setAttribute('aria-label',`${input.dataset.field} for ${shot.number}`));
        const duration=row.querySelector('[data-field=duration]');duration.min='0.1';duration.step='0.1';duration.onchange=()=>{if(Number(duration.value)>0){shot.duration=Number(duration.value);saveState();render();}else{duration.value=shot.duration;toast('Duration must be greater than zero.');}};
      }
      if(group)group.rows.push(row);
    }
    wrap.querySelectorAll('.cell').forEach(cell=>{
      const [sid,eid,stid]=cell.dataset.key.split('|');cell.dataset.status=getCell(sid,eid==='_'?null:eid,stid).status;cell.tabIndex=0;cell.setAttribute('role','button');cell.setAttribute('aria-label',`${shotById(sid).number}, ${stageById(stid).name}, ${cell.dataset.status.replaceAll('_',' ')}`);
      cell.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const rect=cell.getBoundingClientRect();openCellEditor(cell.dataset.key,rect.left,rect.top);}};
    });
    shotRows.forEach(g=>{
      const button=document.createElement('button');button.className='element-toggle';button.setAttribute('aria-expanded',String(ui.expanded.has(g.shot.id)));
      button.textContent=(ui.expanded.has(g.shot.id)?'−':'+')+' '+g.shot.elements.length+' elements';
      button.onclick=()=>{ui.expanded.has(g.shot.id)?ui.expanded.delete(g.shot.id):ui.expanded.add(g.shot.id);render();};
      g.rows[0].querySelector('.sticky-col').append(button);
    });
    const count=document.createElement('div');count.className='table-caption';count.innerHTML='<span data-visible-count></span><span>Click a cell to update · Select shots for bulk status · Scroll to explore stages →</span>';wrap.append(count);
    const empty=document.createElement('div');empty.className='empty-state';empty.hidden=true;empty.innerHTML='<h3>No shots in this view.</h3><p>Try a different search or status, or add your first sequence.</p><button>Clear filters</button>';wrap.append(empty);empty.querySelector('button').onclick=()=>{ui.search='';ui.filter='all';render();};
    const search=controls.querySelector('input');const filter=controls.querySelector('select');filter.value=ui.filter;
    function applyFilters(){
      let visible=0;const query=ui.search.toLocaleLowerCase();
      shotRows.forEach(({shot,rows})=>{
        const text=[shot.number,shot.description,shot.notes,shot.dialogue,...shot.elements.map(e=>e.name)].join(' ').toLocaleLowerCase();
        const status=ui.filter==='all'||state.stages.some(st=>getCell(shot.id,null,st.id).status===ui.filter||shot.elements.some(e=>getCell(shot.id,e.id,st.id).status===ui.filter));
        const show=text.includes(query)&&status;rows.forEach((row,i)=>row.hidden=!show||(i>0&&!ui.expanded.has(shot.id)));if(show)visible++;
      });
      count.querySelector('[data-visible-count]').textContent=`${visible} of ${state.shots.length} shots · ${state.stages.length} stages`;
      empty.hidden=visible>0;
    }
    search.oninput=()=>{ui.search=search.value;applyFilters();};filter.onchange=()=>{ui.filter=filter.value;applyFilters();};
    controls.querySelector('button').onclick=()=>{ui.compact=!ui.compact;render();};
    const selectAll=document.createElement('input');selectAll.type='checkbox';selectAll.setAttribute('aria-label','Select all visible shots');wrap.querySelector('#shotTable thead th').prepend(selectAll,document.createTextNode(' '));
    selectAll.onchange=()=>{shotRows.filter(g=>!g.rows[0].hidden).forEach(g=>selectAll.checked?ui.selected.add(g.shot.id):ui.selected.delete(g.shot.id));updateSelection();};
    function updateSelection(){
      ui.selected=new Set([...ui.selected].filter(id=>state.shots.some(s=>s.id===id)));
      batch.hidden=!ui.selected.size;batch.querySelector('[data-selected]').textContent=`${ui.selected.size} selected`;
      shotRows.forEach(g=>{g.rows.forEach(row=>row.classList.toggle('selected',ui.selected.has(g.shot.id)));g.rows[0].querySelector('input[type=checkbox]').checked=ui.selected.has(g.shot.id);});
      const visible=shotRows.filter(g=>!g.rows[0].hidden);const n=visible.filter(g=>ui.selected.has(g.shot.id)).length;selectAll.checked=visible.length>0&&n===visible.length;selectAll.indeterminate=n>0&&n<visible.length;
    }
    batch.querySelector('[data-clear]').onclick=()=>{ui.selected.clear();updateSelection();};
    batch.querySelectorAll('[data-bulk]').forEach(b=>b.onclick=()=>{
      state.shots.filter(s=>ui.selected.has(s.id)).forEach(shot=>{
        [null,...shot.elements].forEach(element=>state.stages.forEach(st=>{const cell=getCell(shot.id,element?.id||null,st.id);cell.status=b.dataset.bulk;cell.completedAt=isCompleteStatus(cell.status)?(cell.completedAt||new Date().toISOString()):null;}));
      });saveState();render();toast('Selected shots updated.');
    });
    applyFilters();updateSelection();
  };
  // Include dates placed on a whole shot as well as the original element dates.
  // This changes only the derived frontend view, not stored cells or API payloads.
  calendarEvents=function(){
    const events=original.calendarEvents();
    state.shots.forEach(shot=>state.stages.forEach(stage=>{const cell=getCell(shot.id,null,stage.id);if(cell.due)events.push({date:cell.due,shot,element:{id:null,name:'Whole shot'},stage,cell,person:personById(cell.assignee)});}));
    return events;
  };
  renderGantt=function(root){
    const events=calendarEvents();
    const container=document.createElement('div');
    container.innerHTML=`<div class="toolbar"><select aria-label="Group timeline"><option value="stage">By production stage</option><option value="shot">By shot</option></select><div class="spacer"></div><span class="muted">${events.length} scheduled tasks · dates from your shot list</span></div><div class="timeline-scroll"><div class="studio-timeline"></div></div>`;
    root.append(container);const select=container.querySelector('select');select.value=ui.timelineGroup;select.onchange=()=>{ui.timelineGroup=select.value;render();};
    const board=container.querySelector('.studio-timeline');
    if(!events.length){board.innerHTML='<div class="empty-state"><h3>Your timeline starts with a date.</h3><p>Add due dates to shot-list cells to see your schedule here.</p></div>';return;}
    const dates=events.map(e=>new Date(e.date+'T12:00:00').getTime());const projectStart=new Date(state.project.start+'T12:00:00').getTime();const projectEnd=new Date(state.project.deadline+'T12:00:00').getTime();
    const first=startOfWeek(new Date(Math.min(...dates,...(Number.isFinite(projectStart)?[projectStart]:[]))));const last=addDays(new Date(Math.max(...dates,...(Number.isFinite(projectEnd)?[projectEnd]:[]))),7);
    const total=Math.max(1,Math.ceil((last-first)/86400000));const weeks=Math.ceil(total/7);const left=date=>(new Date(date+'T12:00:00')-first)/86400000/total*100;
    const axis=document.createElement('div');axis.className='timeline-row timeline-head';axis.innerHTML='<div class="timeline-label">'+(ui.timelineGroup==='stage'?'PRODUCTION STAGE':'SHOT')+'</div><div class="timeline-weeks">'+Array.from({length:weeks},(_,i)=>`<span>${addDays(first,i*7).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>`).join('')+'</div>';board.append(axis);
    const groups=ui.timelineGroup==='stage'?state.stages:state.shots;
    groups.forEach(group=>{
      const tasks=events.filter(e=>(ui.timelineGroup==='stage'?e.stage.id:e.shot.id)===group.id);if(!tasks.length)return;
      const row=document.createElement('div');row.className='timeline-row';const completed=tasks.filter(e=>isCompleteStatus(e.cell.status)).length;
      row.innerHTML=`<div class="timeline-label"><strong>${escapeHtml(group.name||group.number)}</strong><small>${completed} / ${tasks.length} tasks done</small></div><div class="timeline-track"></div>`;
      const track=row.querySelector('.timeline-track');const min=Math.min(...tasks.map(e=>left(e.date))),max=Math.max(...tasks.map(e=>left(e.date)));
      const span=document.createElement('div');span.className='timeline-span';span.style.left=min+'%';span.style.width=Math.max(1,max-min)+'%';track.append(span);
      tasks.forEach(e=>{const dot=document.createElement('button');dot.className='timeline-task';dot.style.left=left(e.date)+'%';dot.style.background=e.person?.color||'var(--accent)';dot.title=`${e.shot.number} · ${e.stage.name} · ${fmtDate(e.date)}${e.person?' · '+e.person.name:''}`;dot.setAttribute('aria-label',dot.title);dot.onclick=()=>{ui.search='';ui.filter='all';if(e.element?.id)ui.expanded.add(e.shot.id);switchTab('shotlist');const cell=[...document.querySelectorAll('.cell')].find(c=>c.dataset.key===cellKey(e.shot.id,e.element.id,e.stage.id));if(cell){cell.scrollIntoView({block:'center',inline:'center'});cell.focus();}};track.append(dot);});
      const todayLeft=(today()-first)/86400000/total*100;if(todayLeft>=0&&todayLeft<=100){const marker=document.createElement('i');marker.className='timeline-today';marker.style.left=todayLeft+'%';track.append(marker);}board.append(row);
    });
  };
  openCellEditor=function(key,x,y){
    original.openCellEditor(key,x,y);
    const pop=document.querySelector('.popover');if(!pop)return;
    pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Edit production task');
    const rect=pop.getBoundingClientRect();pop.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';pop.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';
    pop.querySelector('#statusRow button')?.focus();
  };
  renderCalendar=function(root){
    const tabs=document.createElement('div');tabs.className='view-switch';tabs.innerHTML=['year','month','week','day'].map(mode=>`<button data-mode="${mode}" class="${ui.calendarMode===mode?'active':''}" aria-pressed="${ui.calendarMode===mode}">${mode[0].toUpperCase()+mode.slice(1)}</button>`).join('')+'<div class="spacer"></div><button data-timeline>Open timeline ↗</button>';
    root.append(tabs);tabs.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{ui.calendarMode=b.dataset.mode;render();});tabs.querySelector('[data-timeline]').onclick=()=>switchTab('gantt');
    if(ui.calendarMode==='month'){
      original.renderCalendar(root);const cal=root.querySelector('.cal');const scroll=document.createElement('div');scroll.className='calendar-scroll';cal.before(scroll);scroll.append(cal);
      const button=document.createElement('button');button.textContent='Today';button.onclick=()=>{calMonth=today();render();};root.querySelector('.toolbar').append(button);return;
    }
    const events=calendarEvents();const container=document.createElement('div');root.append(container);
    const toolbar=document.createElement('div');toolbar.className='toolbar';toolbar.innerHTML=`<button aria-label="Previous period">‹</button><strong>${ui.calendarMode==='year'?calMonth.getFullYear():fmtDate(calMonth)}</strong><button aria-label="Next period">›</button><div class="spacer"></div><button>Today</button>`;container.append(toolbar);
    const buttons=toolbar.querySelectorAll('button');const shift=direction=>{if(ui.calendarMode==='year')calMonth=new Date(calMonth.getFullYear()+direction,calMonth.getMonth(),1);else calMonth=addDays(calMonth,direction*(ui.calendarMode==='week'?7:1));render();};buttons[0].onclick=()=>shift(-1);buttons[1].onclick=()=>shift(1);buttons[2].onclick=()=>{calMonth=today();render();};
    if(ui.calendarMode==='year'){
      const grid=document.createElement('div');grid.className='year-grid';
      for(let i=0;i<12;i++){const d=new Date(calMonth.getFullYear(),i,1);const n=events.filter(e=>e.date.slice(0,7)===iso(d).slice(0,7)).length;const button=document.createElement('button');button.className='month-card';button.innerHTML=`<b>${d.toLocaleDateString('en-GB',{month:'long'})}</b><span>${n} scheduled ${n===1?'task':'tasks'} ↗</span>`;button.onclick=()=>{calMonth=d;ui.calendarMode='month';render();};grid.append(button);}container.append(grid);return;
    }
    const list=document.createElement('div');list.className='schedule-list';const start=ui.calendarMode==='week'?startOfWeek(calMonth):calMonth;
    for(let i=0;i<(ui.calendarMode==='week'?7:1);i++){
      const d=addDays(start,i);const day=events.filter(e=>e.date===iso(d));const section=document.createElement('section');section.className='schedule-day';section.innerHTML=`<h3>${d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}</h3>`;
      if(!day.length)section.insertAdjacentHTML('beforeend','<span class="muted">No tasks scheduled. Add a due date to any shot-list cell.</span>');
      day.forEach(e=>{const button=document.createElement('button');button.className='evt';button.style.borderLeftColor=e.person?.color||'var(--accent)';button.textContent=`${e.shot.number} · ${e.stage.name}${e.person?' · '+e.person.name:''}`;button.onclick=()=>{ui.search='';ui.filter='all';if(e.element?.id)ui.expanded.add(e.shot.id);switchTab('shotlist');const cell=[...document.querySelectorAll('.cell')].find(c=>c.dataset.key===cellKey(e.shot.id,e.element?.id,e.stage.id));if(cell){cell.scrollIntoView({block:'center',inline:'center'});cell.focus();}};section.append(button);});list.append(section);
    }container.append(list);
  };
  // Batch scanning reuses the existing one-file scan API and original review/commit wizard.
  // Requests run one at a time, so the live worker sees exactly the existing request shape.
  renderImport=function(root){
    const batch=document.createElement('details');batch.className='scan-queue';batch.innerHTML='<summary>Working with a whole storyboard? Add a page queue.</summary><p>Choose up to 20 images. Pages scan one at a time, then open each result in the existing review flow. Nothing is imported until you review and confirm it.</p><div class="queue-actions"><input type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Storyboard page queue"><button class="primary" data-scan>Scan queued pages</button></div><div class="queue-list" aria-live="polite"></div>';
    original.renderImport(root);root.prepend(batch);
    const list=batch.querySelector('.queue-list');const run=batch.querySelector('[data-scan]');const files=batch.querySelector('input');
    if(ui.queue.length)batch.open=true;
    function draw(){
      run.disabled=ui.scanning||!ui.queue.some(q=>q.status==='queued'||q.status==='failed');files.disabled=ui.scanning;
      list.innerHTML='';ui.queue.forEach(q=>{
        const row=document.createElement('div');row.className='queue-item';const label=document.createElement('span');label.textContent=q.file.name;const status=document.createElement('small');status.textContent=q.message||q.status;label.append(status);row.append(label);
        if(q.result){const button=document.createElement('button');button.textContent=q.status==='imported'?'Imported ✓':'Review page →';button.disabled=q.status==='imported'||ui.scanning;button.onclick=()=>openResult(q);row.append(button);}list.append(row);
      });
    }
    files.onchange=()=>{
      const picked=[...files.files];if(picked.length+ui.queue.length>20){toast('Queue up to 20 pages at a time.');files.value='';return;}
      if(picked.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>15*1024*1024)){toast('Use PNG, JPEG or WebP images smaller than 15 MB.');files.value='';return;}
      ui.queue.push(...picked.map(file=>({file,status:'queued'})));draw();
    };
    run.onclick=async()=>{
      ui.scanning=true;draw();
      try{for(const q of ui.queue.filter(q=>q.status==='queued'||q.status==='failed')){
        q.status='scanning';q.message='Uploading and scanning…';draw();
        try{q.result=await API.scan(q.file);if(q.result.error||!Array.isArray(q.result.panels))throw new Error(q.result.error||'Invalid scanner response');q.status='ready';q.message=`${q.result.panels.length} panels · ready for review`;}
        catch(error){q.status='failed';q.message=error.message;}
        draw();
      }}finally{ui.scanning=false;draw();}
    };
    function openResult(q){
      const wizardRoot=root.querySelector('#importWizard');Wizard.mount(wizardRoot);
      Wizard.state={file:q.file,result:q.result,panels:q.result.panels.map((p,i)=>({...p,include:true,_idx:i})),showLowOnly:false};
      Wizard._renderReview(wizardRoot.querySelector('#reviewList'),wizardRoot.querySelector('#panelCount'));
      wizardRoot.querySelectorAll('.step').forEach(el=>el.classList.toggle('active',el.dataset.step==='3'));
      wizardRoot.querySelectorAll('.panel').forEach((el,i)=>el.hidden=i!==2);
      wizardRoot.scrollIntoView({block:'start'});
      const done=wizardRoot.querySelector('.step-4');
      const observer=new MutationObserver(()=>{if(!done.hidden){q.status='imported';q.message='Imported through the original review flow';draw();observer.disconnect();}});
      observer.observe(done,{attributes:true,attributeFilter:['hidden']});
    }
    draw();
  };
  const renderReview=Wizard._renderReview.bind(Wizard);
  Wizard._renderReview=function(list,counter){
    renderReview(list,counter);
    list.querySelectorAll('.review-card').forEach(card=>{
      const panel=Wizard.state.panels.find(p=>p._idx===Number(card.dataset.idx));
      const value=panel?.thumbnail_b64||panel?.thumbnail;
      if(!value)return;
      showThumbnail(card.querySelector('.thumb'),value,`Storyboard panel ${panel.number||Number(card.dataset.idx)+1}`);
    });
  };
  const mountWizard=Wizard.mount.bind(Wizard);
  Wizard.mount=function(root){
    mountWizard(root);
    const imported=root?.querySelector('.step-4');
    if(!imported)return;
    const sync=new MutationObserver(()=>{
      if(!imported.hidden){
        try{const cached=JSON.parse(localStorage.getItem(LS_KEY));if(cached&&Array.isArray(cached.shots))state=cached;}catch{}
        sync.disconnect();
      }
    });
    sync.observe(imported,{attributes:true,attributeFilter:['hidden']});
  };
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')closeEditor();
    if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();if(state){switchTab('shotlist');document.querySelector('[aria-label="Search shots"]')?.focus();}}
  });
  currentTab='shotlist';shell();
})();
