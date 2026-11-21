/* Production planning: existing shot cells + separately identified project tasks.
   Everything persists through the existing workspace save adapter. */
(() => {
  'use strict';
  const palette = ['#80dac5','#8bb7f0','#c5a3ee','#edb774','#ed94af','#9dcc89'];
  const statuses = [['not_started','To do'],['in_progress','In progress'],['done','Done'],['published','Published']];
  const ui = {view:'gantt',team:'',person:'',search:'',group:'team',zoom:28,anchor:''};
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const newId = () => globalThis.crypto?.randomUUID?.() || uid();
  const validColor = value => /^#[0-9a-f]{6}$/i.test(value||'');
  const color = value => validColor(value) ? value : palette[0];
  const nowDate = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const day = value => {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;
    const time=Date.parse(value+'T00:00:00Z');
    return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?Math.floor(time/86400000):null;
  };
  const date = value => new Date(value*86400000).toISOString().slice(0,10);
  const person = id => state.people.find(p=>p.id===id);
  function teams(){
    const custom=Array.isArray(state.productionTeams)?state.productionTeams:[];
    return [...custom.filter(t=>t&&typeof t.id==='string').map(t=>({...t,color:color(t.color)})),
      ...state.stages.map((s,i)=>({id:'stage:'+s.id,name:s.name,color:color(s.color||palette[i%palette.length])}))];
  }
  const team = id => teams().find(t=>t.id===id)||{id:'',name:'No team',color:'#9caeb9'};
  function tasks(){
    const result=[];
    for(const task of Array.isArray(state.productionTasks)?state.productionTasks:[]){
      if(!task||typeof task.id!=='string')continue;
      result.push({id:'task:'+task.id,title:String(task.title||'Untitled task'),data:task,teamId:task.teamId||'',subtitle:'Project task'});
    }
    for(const [key,cell] of Object.entries(state.cells||{})){
      if(!cell||typeof cell!=='object')continue;
      const [sid,eid,stid]=key.split('|'),shot=shotById(sid),stage=stageById(stid);
      const element=eid==='_'?null:shot?.elements?.find(e=>e.id===eid);
      if(!shot||!stage||(eid!=='_'&&!element))continue;
      if(!cell.due&&!cell.start&&!cell.assignee&&!cell.notes&&!cell.title&&(!cell.status||cell.status==='not_started'))continue;
      result.push({id:'cell:'+key,title:String(cell.title||`${shot.number} · ${stage.name}`),data:cell,
        teamId:cell.teamId||'stage:'+stage.id,shot,stage,element,
        subtitle:`${shot.number} · ${element?.name||'Whole shot'} · ${stage.name}`});
    }
    return result;
  }
  function status(task){return statuses.some(([id])=>id===task.data.status)?task.data.status:'not_started';}
  function setStatus(task,value){task.data.status=value;task.data.completedAt=isCompleteStatus(value)?(task.data.completedAt||new Date().toISOString()):null;}
  function save(){saveState();render();}
  function announce(message){document.querySelector('.planner-notice')?.remove();const el=document.createElement('div');el.className='toast planner-notice';el.setAttribute('role','status');el.textContent=message;document.body.append(el);setTimeout(()=>el.remove(),4500);}
  function personOptions(value){return '<option value="">Unassigned</option>'+state.people.map(p=>`<option value="${esc(p.id)}" ${p.id===value?'selected':''}>${esc(p.name)}</option>`).join('')+'<option value="__new__">+ Add person…</option>';}
  function teamOptions(value){return '<option value="">No team</option>'+teams().map(t=>`<option value="${esc(t.id)}" ${t.id===value?'selected':''}>${esc(t.name)}</option>`).join('');}
  function modal(title,contents,button,submit){
    const dialog=document.createElement('dialog');dialog.className='planner-dialog';
    dialog.innerHTML=`<form><h3>${esc(title)}</h3>${contents}<p role="alert" class="planner-error"></p><div class="actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">${esc(button)}</button></div></form>`;
    dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>dialog.remove());
    dialog.querySelector('form').onsubmit=e=>{e.preventDefault();try{if(submit(new FormData(e.target),dialog)!==false)dialog.close();}catch(error){dialog.querySelector('[role=alert]').textContent=error.message;}};
    document.body.append(dialog);dialog.showModal();return dialog;
  }
  function addPerson(callback){
    modal('Add a person','<label>Name<input name="name" maxlength="80" required autofocus></label>','Add person',form=>{
      const name=String(form.get('name')).trim();if(!name)throw Error('Enter a name.');
      const p={id:newId(),name,color:palette[state.people.length%palette.length]};state.people.push(p);callback(p.id);save();
    });
  }
  function editTask(task, creating=false){
    const data=task.data;
    const dialog=modal(creating?'New task':'Edit task',`<label>Task title<input name="title" value="${esc(task.title)}" required maxlength="200" autofocus></label>
      <div class="planner-fields"><label>Team<select name="team" aria-label="Team">${teamOptions(task.teamId)}</select></label><label>Assignee<select name="assignee" aria-label="Assignee">${personOptions(data.assignee).replace('<option value="__new__">+ Add person…</option>','')}</select></label>
      <label>Start date<input type="date" name="start" value="${esc(data.start||data.due||'')}"></label><label>Due date<input type="date" name="due" value="${esc(data.due||'')}"></label></div>
      <label>Status<select name="status" aria-label="Status">${statuses.map(([id,name])=>`<option value="${id}" ${status(task)===id?'selected':''}>${name}</option>`).join('')}</select></label>
      <label>Notes<textarea name="notes" rows="3" maxlength="4000">${esc(data.notes||'')}</textarea></label>`,creating?'Create task':'Save task',form=>{
        const title=String(form.get('title')).trim(),start=String(form.get('start')),due=String(form.get('due'));
        if(!title)throw Error('Enter a task title.');
        if((start&&day(start)===null)||(due&&day(due)===null))throw Error('Enter valid dates.');
        if(start&&due&&day(start)>day(due))throw Error('Due date must be on or after the start date.');
        Object.assign(data,{title,start,due,teamId:String(form.get('team')),assignee:String(form.get('assignee'))||null,notes:String(form.get('notes'))});
        setStatus(task,String(form.get('status')));
        if(creating){
          if(!Array.isArray(state.productionTasks))state.productionTasks=[];
          state.productionTasks.push(data);
          ui.search='';if(ui.team)ui.team=data.teamId;
          if(ui.person)ui.person=data.assignee||'__none__';
          if(data.start||data.due)ui.anchor=data.start||data.due;
        }
        save();if(creating)announce('Task created.');
      });
    dialog.setAttribute('aria-label',creating?'New task':'Edit task');
  }
  function newTask(options={}){
    const due=options.due??nowDate();
    const data={id:newId(),title:'',teamId:options.teamId??ui.team,
      assignee:ui.person==='__none__'?null:ui.person||null,
      start:due,due,status:options.status||'not_started',notes:'',completedAt:null};
    editTask({id:'task:'+data.id,title:'',data,teamId:data.teamId,subtitle:'Project task'},true);
  }
  function manageTeams(){
    modal('Team colors',`<p>Production stages already have colors. Add any other team here.</p><div class="planner-team-list">${teams().map(t=>`<label><span>${esc(t.name)}</span><input type="color" aria-label="Color for ${esc(t.name)}" data-team="${esc(t.id)}" value="${t.color}"></label>`).join('')}</div>
      <div class="planner-fields"><label>New team name<input name="name" maxlength="80" placeholder="e.g. Background team"></label><label>New team color<input type="color" name="color" value="${palette[teams().length%palette.length]}"></label></div>`,'Save teams',(form,dialog)=>{
        dialog.querySelectorAll('[data-team]').forEach(input=>{
          const id=input.dataset.team;
          if(id.startsWith('stage:')){const stage=stageById(id.slice(6));if(stage)stage.color=input.value;}
          else{const existing=(state.productionTeams||[]).find(t=>t.id===id);if(existing)existing.color=input.value;}
        });
        const name=String(form.get('name')).trim();
        if(name){if(!Array.isArray(state.productionTeams))state.productionTeams=[];const t={id:newId(),name,color:color(form.get('color'))};state.productionTeams.push(t);ui.team=t.id;}
        save();
      });
  }
  function createTask(title,options={}){
    title=String(title).trim();if(!title)return false;
    if(!Array.isArray(state.productionTasks))state.productionTasks=[];
    const due=options.due??nowDate();
    const data={id:newId(),title:title.slice(0,200),teamId:options.teamId??ui.team,
      assignee:options.assignee??(ui.person==='__none__'?null:ui.person||null),
      start:due,due,status:options.status||'not_started',notes:'',completedAt:isCompleteStatus(options.status)?new Date().toISOString():null};
    state.productionTasks.push(data);ui.search='';if(due)ui.anchor=due;save();announce('Task created.');return true;
  }
  function quickForm(container,options={}){
    const form=document.createElement('form');form.className='planner-quick';
    form.innerHTML=`<input name="title" aria-label="${esc(options.label||'New task title')}" placeholder="${esc(options.placeholder||'+ What needs to happen?')}" maxlength="200"><button class="primary" type="submit">Add task</button>`;
    form.onsubmit=e=>{e.preventDefault();if(!form.elements.title.value.trim()){newTask(options);return;}if(createTask(form.elements.title.value,options)){document.querySelector('[aria-label="New task title"]')?.focus();}};
    container.append(form);return form;
  }
  function updateAssignee(task,value){if(value==='__new__'){addPerson(id=>{task.data.assignee=id;});return;}task.data.assignee=value||null;save();}
  function taskCard(task){
    const el=document.createElement('article');el.className='planner-card';el.dataset.taskId=task.id;el.draggable=true;el.style.setProperty('--team-color',team(task.teamId).color);
    const overdue=day(task.data.due)!==null&&day(task.data.due)<day(nowDate())&&!isCompleteStatus(status(task));
    el.innerHTML=`<div class="planner-card-top"><span class="planner-team-tag">${esc(team(task.teamId).name)}</span>${overdue?'<span class="planner-overdue">Overdue</span>':''}</div>
      <button class="planner-card-title" type="button">${esc(task.title)}</button><small>${esc(task.subtitle)}</small>
      <div class="planner-card-controls"><select aria-label="Assign ${esc(task.title)}">${personOptions(task.data.assignee)}</select>
      <input type="date" aria-label="Due date for ${esc(task.title)}" value="${esc(task.data.due||'')}"></div>
      <div class="planner-card-controls"><select aria-label="Team for ${esc(task.title)}">${teamOptions(task.teamId)}</select><select aria-label="Status for ${esc(task.title)}">${statuses.map(([id,name])=>`<option value="${id}" ${status(task)===id?'selected':''}>${name}</option>`).join('')}</select></div>`;
    el.querySelector('.planner-card-title').onclick=()=>editTask(task);
    const selects=el.querySelectorAll('select');selects[0].onchange=e=>updateAssignee(task,e.target.value);
    selects[1].onchange=e=>{task.data.teamId=e.target.value;save();};
    selects[2].onchange=e=>{setStatus(task,e.target.value);save();};
    el.querySelector('input').onchange=e=>{
      if(e.target.value&&day(task.data.start)!==null&&day(e.target.value)<day(task.data.start)){e.target.value=task.data.due||'';announce('Due date cannot be before the start date.');return;}
      task.data.due=e.target.value;save();
    };
    el.ondragstart=e=>{e.dataTransfer.setData('application/x-frame-task',task.id);e.dataTransfer.effectAllowed='move';};
    return el;
  }
  function dropTarget(el,apply){
    el.ondragover=e=>{if([...e.dataTransfer.types].includes('application/x-frame-task')){e.preventDefault();el.classList.add('planner-drop-target');e.dataTransfer.dropEffect='move';}};
    el.ondragleave=()=>el.classList.remove('planner-drop-target');
    el.ondrop=e=>{e.preventDefault();e.stopPropagation();el.classList.remove('planner-drop-target');const id=e.dataTransfer.getData('application/x-frame-task');const task=tasks().find(t=>t.id===id);if(task)apply(task,e);};
  }
  function renderBoard(root,items){
    const board=document.createElement('section');board.className='planner-board';board.setAttribute('aria-label','Task board');
    for(const [id,label] of statuses){
      const subset=items.filter(t=>status(t)===id),column=document.createElement('section');column.className='planner-column';column.dataset.status=id;
      column.innerHTML=`<h3><span class="planner-status-dot" data-status="${id}"></span>${label}<span>${subset.length}</span></h3>`;
      quickForm(column,{status:id,label:`New ${label.toLowerCase()} task`,due:''});
      const list=document.createElement('div');list.className='planner-card-list';subset.forEach(t=>list.append(taskCard(t)));column.append(list);
      if(!subset.length){const p=document.createElement('p');p.className='planner-empty-column';p.textContent='Drop a task here or add one above.';list.append(p);}
      dropTarget(column,task=>{setStatus(task,id);save();});board.append(column);
    }
    root.append(board);
  }
  function schedule(task,target,options){
    const start=day(task.data.start||task.data.due),end=day(task.data.due||task.data.start);
    const length=start===null||end===null?0:Math.max(0,end-start);
    task.data.start=target;task.data.due=date(day(target)+length);
    if(options.teamId!==undefined)task.data.teamId=options.teamId;
    save();
  }
  function renderGanttBoard(root,items){
    const scheduled=items.filter(t=>day(t.data.due||t.data.start)!==null);
    const earliest=scheduled.map(t=>day(t.data.start||t.data.due));
    let anchor=day(ui.anchor);if(anchor===null)anchor=earliest.length?Math.min(...earliest):day(nowDate());
    const start=anchor-((new Date(anchor*86400000).getUTCDay()+6)%7),total=ui.zoom;
    const nav=document.createElement('div');nav.className='planner-range';
    nav.innerHTML=`<button data-prev aria-label="Previous date range">←</button><button data-today>Today</button><button data-next aria-label="Next date range">→</button><strong>${date(start)} — ${date(start+total-1)}</strong><select aria-label="Timeline zoom"><option value="28">4 weeks · daily</option><option value="84">12 weeks · daily</option></select><span class="spacer"></span><small>Click an empty day to add · Drag a bar to reschedule</small>`;
    nav.querySelector('[data-prev]').onclick=()=>{ui.anchor=date(start-total);render();};nav.querySelector('[data-next]').onclick=()=>{ui.anchor=date(start+total);render();};
    nav.querySelector('[data-today]').onclick=()=>{ui.anchor=nowDate();render();};const zoom=nav.querySelector('select');zoom.value=String(ui.zoom);zoom.onchange=()=>{ui.zoom=Number(zoom.value);render();};root.append(nav);
    const scroll=document.createElement('div');scroll.className='planner-gantt-scroll timeline-scroll';
    const board=document.createElement('div');board.className='planner-gantt';board.style.setProperty('--planner-days',total);board.style.setProperty('--planner-grid-width',total*38+'px');
    const head=document.createElement('div');head.className='planner-gantt-row planner-gantt-head';
    head.innerHTML=`<div class="planner-row-label timeline-label">${ui.group==='shot'?'SHOT':ui.group==='stage'?'PRODUCTION STAGE':'TEAM / TASK'}</div><div class="planner-day-axis">${Array.from({length:total},(_,i)=>{const d=new Date((start+i)*86400000);return `<div class="${[0,6].includes(d.getUTCDay())?'weekend':''} ${date(start+i)===nowDate()?'is-today':''}"><small>${d.toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'})}</small><b>${d.getUTCDate()}</b></div>`;}).join('')}</div>`;board.append(head);
    let groups;
    if(ui.group==='shot')groups=state.shots.map(s=>({id:s.id,name:s.number,items:items.filter(t=>t.shot?.id===s.id)})).concat([{id:'project',name:'Project tasks',items:items.filter(t=>!t.shot)}]);
    else if(ui.group==='stage')groups=state.stages.map(s=>({id:s.id,name:s.name,items:items.filter(t=>t.stage?.id===s.id)})).concat([{id:'project',name:'Project tasks',items:items.filter(t=>!t.stage)}]);
    else groups=[...teams().filter(t=>!ui.team||t.id===ui.team).map(t=>({...t,items:items.filter(task=>task.teamId===t.id)})),{id:'',name:'No team',color:'#9caeb9',items:items.filter(t=>!teams().some(team=>team.id===t.teamId))}];
    groups=groups.filter(g=>g.items.length||ui.group==='team');
    if(!groups.length)groups=[{id:'',name:'Project tasks',items:[]}];
    for(const group of groups){
      const groupRow=document.createElement('div');groupRow.className='planner-gantt-group';groupRow.textContent=group.name;groupRow.style.borderLeftColor=color(group.color||team(group.items[0]?.teamId).color);board.append(groupRow);
      const entries=group.items.length?group.items:[null];
      for(const task of entries){
        const row=document.createElement('div');row.className='planner-gantt-row';row.dataset.taskId=task?.id||'';
        const label=document.createElement('div');label.className='planner-row-label';
        if(task){label.innerHTML=`<button class="planner-row-title">${esc(task.title)}</button><select aria-label="Assign ${esc(task.title)}">${personOptions(task.data.assignee)}</select>`;label.querySelector('button').onclick=()=>editTask(task);label.querySelector('select').onchange=e=>updateAssignee(task,e.target.value);}
        else{label.innerHTML='<button type="button" class="planner-row-title">+ Add task</button>';label.querySelector('button').onclick=()=>newTask({teamId:ui.group==='team'?group.id:ui.team});}
        row.append(label);const track=document.createElement('div');track.className='planner-bar-track';
        const options=ui.group==='team'?{teamId:group.id}:{};
        dropTarget(track,(t,event)=>{const index=Math.max(0,Math.min(total-1,Math.floor((event.clientX-track.getBoundingClientRect().left)/38)));schedule(t,date(start+index),options);});
        for(let i=0;i<total;i++){
          const target=date(start+i),cell=document.createElement('button');cell.className='planner-day-slot';cell.type='button';cell.setAttribute('aria-label',`Add task for ${group.name} on ${target}`);
          cell.onclick=()=>newTask({due:target,teamId:options.teamId??ui.team});
          dropTarget(cell,t=>schedule(t,target,options));track.append(cell);
        }
        if(task){
          const a=day(task.data.start||task.data.due),b=day(task.data.due||task.data.start);
          if(a!==null&&b!==null&&b>=start&&a<start+total){
            const bar=document.createElement('button');bar.className='planner-gantt-bar timeline-task';bar.dataset.taskId=task.id;
            bar.style.left=Math.max(0,a-start)*38+'px';bar.style.width=Math.max(30,(Math.min(start+total-1,b)-Math.max(start,a)+1)*38-4)+'px';
            bar.style.setProperty('--team-color',team(task.teamId).color);bar.dataset.status=status(task);
            bar.textContent=`${isCompleteStatus(status(task))?'✓ ':''}${task.title}`;
            bar.title=`${task.title} · ${team(task.teamId).name} · ${task.data.start||task.data.due} → ${task.data.due||task.data.start}`;
            bar.setAttribute('aria-label',`Edit ${task.title}`);bar.onclick=()=>editTask(task);bar.draggable=true;
            bar.ondragstart=e=>{e.dataTransfer.setData('application/x-frame-task',task.id);e.dataTransfer.effectAllowed='move';};track.append(bar);
          }else if(a===null){const badge=document.createElement('button');badge.className='planner-unscheduled';badge.textContent='Set dates';badge.onclick=()=>editTask(task);track.append(badge);}
        }
        row.append(track);board.append(row);
      }
    }
    scroll.append(board);root.append(scroll);
    const outside=scheduled.filter(t=>day(t.data.due||t.data.start)<start||day(t.data.start||t.data.due)>=start+total).length;
    if(outside){const note=document.createElement('p');note.className='muted';note.textContent=`${outside} scheduled task(s) outside this date range. Use the arrows or Board view.`;root.append(note);}
  }
  renderGantt=function(root){
    const all=tasks(),items=all.filter(t=>(!ui.team||t.teamId===ui.team)&&(!ui.person||(ui.person==='__none__'?!t.data.assignee:t.data.assignee===ui.person))&&`${t.title} ${t.subtitle} ${person(t.data.assignee)?.name||''}`.toLowerCase().includes(ui.search.toLowerCase()));
    const panel=document.createElement('section');panel.className='task-planner';
    panel.innerHTML=`<div class="planner-top"><div><span class="eyebrow">ONE SHARED PLAN</span><h3>Less chasing. More creating.</h3><p>Plan by date. Move work forward. Give every task an owner.</p></div><button data-teams>● Team colors</button></div>
      <div class="planner-stats"><span><b>${items.length}</b> tasks</span><span><b>${items.filter(t=>isCompleteStatus(status(t))).length}</b> completed</span><span><b>${items.filter(t=>!t.data.assignee).length}</b> unassigned</span><span><b>${items.filter(t=>day(t.data.due)!==null&&day(t.data.due)<day(nowDate())&&!isCompleteStatus(status(t))).length}</b> overdue</span></div>
      <div class="planner-toolbar"><div class="planner-switch"><button data-view="gantt" class="${ui.view==='gantt'?'active':''}">Gantt</button><button data-view="board" class="${ui.view==='board'?'active':''}">Board</button></div>
      <input aria-label="Search tasks" placeholder="Search tasks or people…" value="${esc(ui.search)}"><select aria-label="Filter task team"><option value="">All teams</option>${teams().map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>
      <select aria-label="Filter task assignee"><option value="">Everyone</option><option value="__none__">Unassigned</option>${state.people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
      <select aria-label="Group timeline"><option value="team">By team</option><option value="stage">By production stage</option><option value="shot">By shot</option></select></div>`;
    root.append(panel);panel.querySelector('[data-teams]').onclick=manageTeams;
    panel.querySelectorAll('[data-view]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.view===ui.view));b.onclick=()=>{ui.view=b.dataset.view;render();};});
    const search=panel.querySelector('[aria-label="Search tasks"]');search.oninput=()=>{const position=search.selectionStart;ui.search=search.value;render();const next=document.querySelector('[aria-label="Search tasks"]');next.focus();next.setSelectionRange(position,position);};
    for(const [label,key] of [['Filter task team','team'],['Filter task assignee','person'],['Group timeline','group']]){const select=panel.querySelector(`[aria-label="${label}"]`);select.value=ui[key];select.onchange=()=>{ui[key]=select.value;render();};}
    const quick=quickForm(panel);quick.classList.add('planner-quick-global');
    quick.onsubmit=e=>{e.preventDefault();if(!quick.elements.title.value.trim()){newTask({teamId:ui.team});return;}createTask(quick.elements.title.value,{teamId:quick.dataset.team??ui.team,due:quick.dataset.due??nowDate()});document.querySelector('[aria-label="New task title"]')?.focus();};
    if(ui.view==='board')renderBoard(panel,items);else renderGanttBoard(panel,items);
  };
  document.addEventListener('workspace-ready',()=>{if(new URLSearchParams(location.search).get('view')==='gantt'){currentTab='gantt';render();}});
})();
