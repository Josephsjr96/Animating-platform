/* Production planning: existing shot cells + separately identified project tasks.
   Everything persists through the existing workspace save adapter. */
(() => {
  'use strict';
  const palette = ['#80dac5','#8bb7f0','#c5a3ee','#edb774','#ed94af','#9dcc89'];
  const statuses = [['not_started','To do'],['in_progress','In progress'],['done','Done'],['published','Published']];
  const ui = {view:'gantt',team:'',person:'',search:'',group:'team',zoom:28,anchor:'',page:0,boardLimits:{},revealTaskId:''};
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
  const model={people:new Map(),shots:new Map(),stages:new Map(),elements:new Map(),teams:[],teamMap:new Map(),taskMap:new Map()};
  const weekday=new Intl.DateTimeFormat('en-GB',{weekday:'short',timeZone:'UTC'});
  const person = id => model.people.get(id);
  const teams = () => model.teams;
  function readTeams(){
    const custom=Array.isArray(state.productionTeams)?state.productionTeams:[];
    return [...custom.filter(t=>t&&typeof t.id==='string').map(t=>({...t,color:color(t.color)})),
      ...state.stages.map((s,i)=>({id:'stage:'+s.id,name:s.name,color:color(s.color||palette[i%palette.length])}))];
  }
  function indexWorkspace(){
    model.people=new Map(state.people.map(p=>[p.id,p]));
    model.shots=new Map(state.shots.map(s=>[s.id,s]));
    model.stages=new Map(state.stages.map(s=>[s.id,s]));
    model.elements=new Map(state.shots.map(s=>[s.id,new Map((s.elements||[]).map(e=>[e.id,e]))]));
    model.teams=readTeams();model.teamMap=new Map(model.teams.map(t=>[t.id,t]));
  }
  const team = id => model.teamMap.get(id)||{id:'',name:'No team',color:'#9caeb9'};
  function tasks(){
    const result=[];
    for(const task of Array.isArray(state.productionTasks)?state.productionTasks:[]){
      if(!task||typeof task.id!=='string')continue;
      result.push({id:'task:'+task.id,title:String(task.title||'Untitled task'),data:task,teamId:task.teamId||'',subtitle:'Project task'});
    }
    for(const [key,cell] of Object.entries(state.cells||{})){
      if(!cell||typeof cell!=='object')continue;
      const [sid,eid,stid]=key.split('|'),shot=model.shots.get(sid),stage=model.stages.get(stid);
      const element=eid==='_'?null:model.elements.get(sid)?.get(eid);
      if(!shot||!stage||(eid!=='_'&&!element))continue;
      if(!cell.due&&!cell.start&&!cell.assignee&&!cell.notes&&!cell.title&&(!cell.status||cell.status==='not_started'))continue;
      result.push({id:'cell:'+key,title:String(cell.title||`${shot.number} · ${stage.name}`),data:cell,
        teamId:cell.teamId||'stage:'+stage.id,shot,stage,element,
        subtitle:`${shot.number} · ${element?.name||'Whole shot'} · ${stage.name}`});
    }
    model.taskMap=new Map(result.map(t=>[t.id,t]));return result;
  }
  function status(task){return statuses.some(([id])=>id===task.data.status)?task.data.status:'not_started';}
  function setStatus(task,value){task.data.status=value;task.data.completedAt=isCompleteStatus(value)?(task.data.completedAt||new Date().toISOString()):null;}
  function refresh(){
    const old=document.querySelector('.task-planner');
    if(currentTab!=='gantt'||!old?.isConnected){render();return;}
    const drafts=[...old.querySelectorAll('.planner-quick input')].map(input=>[input.getAttribute('aria-label'),input.value]);
    const scrolls=[...old.querySelectorAll('.planner-gantt-scroll,.planner-board')].map(el=>[el.classList.contains('planner-board')?'.planner-board':'.planner-gantt-scroll',el.scrollLeft,el.scrollTop]);
    const focus=old.contains(document.activeElement)?document.activeElement:null;
    const focusLabel=focus?.getAttribute('aria-label');
    const selection=focus?.tagName==='INPUT'&&focus.type==='text'?[focus.selectionStart,focus.selectionEnd]:null;
    const host=document.createElement('div');renderGantt(host);const replacement=host.firstElementChild;old.replaceWith(replacement);
    for(const [label,value] of drafts){const input=[...replacement.querySelectorAll('.planner-quick input')].find(el=>el.getAttribute('aria-label')===label);if(input)input.value=value;}
    for(const [selector,left,top] of scrolls){const el=replacement.querySelector(selector);if(el){el.scrollLeft=left;el.scrollTop=top;}}
    if(focusLabel){const next=[...replacement.querySelectorAll('[aria-label]')].find(el=>el.getAttribute('aria-label')===focusLabel);if(next){next.focus({preventScroll:true});if(selection)next.setSelectionRange(...selection);}}
  }
  function save(){refresh();saveState();}
  function filteredTasks(){return tasks().filter(t=>(!ui.team||t.teamId===ui.team)&&(!ui.person||(ui.person==='__none__'?!t.data.assignee:t.data.assignee===ui.person))&&`${t.title} ${t.subtitle} ${person(t.data.assignee)?.name||''}`.toLowerCase().includes(ui.search.toLowerCase())).sort((a,b)=>Number(b.id===ui.revealTaskId)-Number(a.id===ui.revealTaskId));}
  function renderResults(panel){
    const items=filteredTasks(),todayNumber=day(nowDate());
    const stats=panel.querySelector('.planner-stats');
    const values=[items.length,items.filter(t=>isCompleteStatus(status(t))).length,items.filter(t=>!t.data.assignee).length,items.filter(t=>day(t.data.due)!==null&&day(t.data.due)<todayNumber&&!isCompleteStatus(status(t))).length];
    stats.querySelectorAll('b').forEach((el,i)=>el.textContent=values[i]);
    const results=panel.querySelector('.planner-results');results.replaceChildren();
    if(ui.view==='board')renderBoard(results,items);else renderGanttBoard(results,items);
  }
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
  function editTask(task, creating=false, options={}){
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
          ui.search='';ui.page=0;ui.revealTaskId='task:'+data.id;if(ui.team)ui.team=data.teamId;
          if(ui.person)ui.person=data.assignee||'__none__';
          if((data.start||data.due)&&!options.keepRange)ui.anchor=data.start||data.due;
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
    editTask({id:'task:'+data.id,title:'',data,teamId:data.teamId,subtitle:'Project task'},true,options);
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
    state.productionTasks.push(data);ui.search='';ui.page=0;ui.revealTaskId='task:'+data.id;if(due)ui.anchor=due;save();announce('Task created.');return true;
  }
  function quickForm(container,options={}){
    const form=document.createElement('form');form.className='planner-quick';
    form.innerHTML=`<input name="title" aria-label="${esc(options.label||'New task title')}" placeholder="${esc(options.placeholder||'+ What needs to happen?')}" maxlength="200"><button class="primary" type="submit">Add task</button>`;
    form.onsubmit=e=>{e.preventDefault();if(!form.elements.title.value.trim()){newTask(options);return;}const title=form.elements.title.value;form.elements.title.value='';if(createTask(title,options)){document.querySelector('[aria-label="New task title"]')?.focus();}};
    container.append(form);return form;
  }
  function updateAssignee(task,value){if(value==='__new__'){addPerson(id=>{task.data.assignee=id;});return;}task.data.assignee=value||null;save();}
  function departmentMembers(task){
    const department=team(task.teamId),counts=new Map();
    for(const entry of model.taskMap.values()){
      if(entry.teamId===task.teamId&&entry.data.assignee&&!isCompleteStatus(status(entry)))counts.set(entry.data.assignee,(counts.get(entry.data.assignee)||0)+1);
    }
    const members=[...counts].map(([id,count])=>({name:person(id)?.name||'Unknown member',count})).sort((a,b)=>a.name.localeCompare(b.name));
    const dialog=modal(`${department.name} · Active members`,
      `<p>Members with unfinished assignments in this department.</p>${members.length?`<ul class="planner-active-members">${members.map(m=>`<li><span>${esc(m.name)}</span><small>${m.count} active task${m.count===1?'':'s'}</small></li>`).join('')}</ul>`:'<p>No active members assigned yet.</p>'}
      <label>Assign ${esc(task.title)}<select aria-label="Assign ${esc(task.title)}" name="assignee">${personOptions(task.data.assignee)}</select></label>`,
      'Save assignment',form=>{updateAssignee(task,String(form.get('assignee')));});
    dialog.setAttribute('aria-label',`${department.name} · Active members`);
  }
  function departmentControl(task){
    const control=document.createElement('div');control.className='planner-department-control';
    control.innerHTML=`<select aria-label="Team for ${esc(task.title)}">${teamOptions(task.teamId)}</select><button type="button" class="planner-members" aria-label="Active members of ${esc(team(task.teamId).name)} for ${esc(task.title)}" title="View active department members">!</button>`;
    control.querySelector('select').onchange=e=>{task.data.teamId=e.target.value;save();};
    control.querySelector('button').onclick=()=>departmentMembers(task);
    return control;
  }
  const taskColor = task => model.teamMap.has(task.teamId)?team(task.teamId).color:color(person(task.data.assignee)?.color||'#9caeb9');
  function taskCard(task){
    const el=document.createElement('article');el.className='planner-card';el.dataset.taskId=task.id;el.draggable=true;el.style.setProperty('--team-color',taskColor(task));
    const overdue=day(task.data.due)!==null&&day(task.data.due)<day(nowDate())&&!isCompleteStatus(status(task));
    el.innerHTML=`<div class="planner-card-top"><span class="planner-team-tag">${esc(team(task.teamId).name)}</span>${overdue?'<span class="planner-overdue">Overdue</span>':''}</div>
      <button class="planner-card-title" type="button">${esc(task.title)}</button><small>${esc(task.subtitle)}</small>
      <div class="planner-card-controls planner-department-slot"></div><div class="planner-card-controls"><input type="date" aria-label="Due date for ${esc(task.title)}" value="${esc(task.data.due||'')}"></div>
      <div class="planner-card-controls"><select aria-label="Status for ${esc(task.title)}">${statuses.map(([id,name])=>`<option value="${id}" ${status(task)===id?'selected':''}>${name}</option>`).join('')}</select></div>`;
    el.querySelector('.planner-card-title').onclick=()=>editTask(task);
    el.querySelector('.planner-department-slot').append(departmentControl(task));
    el.querySelector('[aria-label^="Status for"]').onchange=e=>{setStatus(task,e.target.value);save();};
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
    el.ondrop=e=>{e.preventDefault();e.stopPropagation();el.classList.remove('planner-drop-target');const id=e.dataTransfer.getData('application/x-frame-task');const task=model.taskMap.get(id);if(task)apply(task,e);};
  }
  function renderBoard(root,items){
    const board=document.createElement('section');board.className='planner-board';board.setAttribute('aria-label','Task board');
    for(const [id,label] of statuses){
      const subset=items.filter(t=>status(t)===id),column=document.createElement('section');column.className='planner-column';column.dataset.status=id;
      column.innerHTML=`<h3><span class="planner-status-dot" data-status="${id}"></span>${label}<span>${subset.length}</span></h3>`;
      quickForm(column,{status:id,label:`New ${label.toLowerCase()} task`,due:''});
      const list=document.createElement('div');list.className='planner-card-list';subset.slice(0,ui.boardLimits[id]||25).forEach(t=>list.append(taskCard(t)));column.append(list);
      if(subset.length>(ui.boardLimits[id]||25)){const more=document.createElement('button');more.className='planner-load-more';more.textContent=`Show more (${subset.length-(ui.boardLimits[id]||25)} remaining)`;more.onclick=()=>{ui.boardLimits[id]=(ui.boardLimits[id]||25)+25;refresh();};column.append(more);}
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
    if(!ui.anchor)ui.anchor=date(start);
    const nav=document.createElement('div');nav.className='planner-range';
    nav.innerHTML=`<button data-prev aria-label="Previous date range">←</button><button data-today>Today</button><button data-next aria-label="Next date range">→</button><strong>${date(start)} — ${date(start+total-1)}</strong><select aria-label="Timeline zoom"><option value="28">4 weeks · daily</option><option value="84">12 weeks · daily</option></select><span class="spacer"></span><small>Click an empty day to add · Drag a bar to reschedule</small>`;
    nav.querySelector('[data-prev]').onclick=()=>{ui.anchor=date(start-total);refresh();};nav.querySelector('[data-next]').onclick=()=>{ui.anchor=date(start+total);refresh();};
    nav.querySelector('[data-today]').onclick=()=>{ui.anchor=nowDate();refresh();};const zoom=nav.querySelector('select');zoom.value=String(ui.zoom);zoom.onchange=()=>{ui.zoom=Number(zoom.value);refresh();};root.append(nav);
    const scroll=document.createElement('div');scroll.className='planner-gantt-scroll timeline-scroll';
    const board=document.createElement('div');board.className='planner-gantt';board.style.setProperty('--planner-days',total);board.style.setProperty('--planner-grid-width',total*38+'px');
    const head=document.createElement('div');head.className='planner-gantt-row planner-gantt-head';
    head.innerHTML=`<div class="planner-row-label timeline-label">${ui.group==='shot'?'SHOT':ui.group==='stage'?'PRODUCTION STAGE':'TEAM / TASK'}</div><div class="planner-day-axis">${Array.from({length:total},(_,i)=>{const d=new Date((start+i)*86400000);return `<div class="${[0,6].includes(d.getUTCDay())?'weekend':''} ${date(start+i)===nowDate()?'is-today':''}"><small>${weekday.format(d)}</small><b>${d.getUTCDate()}</b></div>`;}).join('')}</div>`;board.append(head);
    const pageSize=50,pages=Math.max(1,Math.ceil(items.length/pageSize));
    ui.page=Math.max(0,Math.min(ui.page,pages-1));
    const pageItems=items.slice(ui.page*pageSize,(ui.page+1)*pageSize);
    if(pages>1){
      const pager=document.createElement('div');pager.className='planner-pager';
      pager.innerHTML=`<span>Showing ${ui.page*pageSize+1}–${Math.min(items.length,(ui.page+1)*pageSize)} of ${items.length} tasks</span><button data-before>Previous tasks</button><strong>Page ${ui.page+1} / ${pages}</strong><button data-after>Next tasks</button>`;
      pager.querySelector('[data-before]').disabled=ui.page===0;pager.querySelector('[data-after]').disabled=ui.page===pages-1;
      pager.querySelector('[data-before]').onclick=()=>{ui.page--;refresh();};pager.querySelector('[data-after]').onclick=()=>{ui.page++;refresh();};root.append(pager);
    }
    let groups;
    if(ui.group==='shot')groups=state.shots.map(s=>({id:s.id,name:s.number,items:pageItems.filter(t=>t.shot?.id===s.id)})).concat([{id:'project',name:'Project tasks',items:pageItems.filter(t=>!t.shot)}]);
    else if(ui.group==='stage')groups=state.stages.map(s=>({id:s.id,name:s.name,items:pageItems.filter(t=>t.stage?.id===s.id)})).concat([{id:'project',name:'Project tasks',items:pageItems.filter(t=>!t.stage)}]);
    else groups=[...teams().filter(t=>!ui.team||t.id===ui.team).map(t=>({...t,items:pageItems.filter(task=>task.teamId===t.id)})),{id:'',name:'No team',color:'#9caeb9',items:pageItems.filter(t=>!model.teamMap.has(t.teamId))}];
    groups=groups.filter(g=>g.items.length||ui.group==='team');
    if(!groups.length)groups=[{id:'',name:'Project tasks',items:[]}];
    for(const group of groups){
      const groupRow=document.createElement('div');groupRow.className='planner-gantt-group';groupRow.textContent=group.name;groupRow.style.borderLeftColor=color(group.color||team(group.items[0]?.teamId).color);board.append(groupRow);
      const entries=group.items.length?group.items:[null];
      for(const task of entries){
        const row=document.createElement('div');row.className='planner-gantt-row';row.dataset.taskId=task?.id||'';
        const label=document.createElement('div');label.className='planner-row-label';
        if(task){label.innerHTML=`<button class="planner-row-title">${esc(task.title)}</button>`;label.querySelector('button').onclick=()=>editTask(task);label.append(departmentControl(task));}
        else{label.innerHTML='<button type="button" class="planner-row-title">+ Add task</button>';label.querySelector('button').onclick=()=>newTask({teamId:ui.group==='team'?group.id:ui.team});}
        row.append(label);const track=document.createElement('div');track.className='planner-bar-track';
        const options=ui.group==='team'?{teamId:group.id}:ui.group==='stage'&&model.stages.has(group.id)?{teamId:'stage:'+group.id}:task?{teamId:task.teamId}:{};
        dropTarget(track,(t,event)=>{const index=Math.max(0,Math.min(total-1,Math.floor((event.clientX-track.getBoundingClientRect().left)/38)));schedule(t,date(start+index),options);});
        const addAt=index=>newTask({due:date(start+index),teamId:options.teamId??ui.team,keepRange:true});
        const surface=document.createElement('button');surface.type='button';surface.className='planner-date-surface';
        surface.setAttribute('aria-label',`Add dated task for ${group.name}${task?' / '+task.title:''}`);
        surface.setAttribute('aria-description','Use left and right arrow keys to choose a day, then Enter to add a task.');
        surface.dataset.firstDate=date(start);surface.dataset.days=String(total);
        let selectedDay=0;
        surface.onclick=event=>addAt(event.detail===0?selectedDay:Math.max(0,Math.min(total-1,Math.floor((event.clientX-track.getBoundingClientRect().left)/38))));
        surface.onkeydown=event=>{
          if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();selectedDay=Math.max(0,Math.min(total-1,selectedDay+(event.key==='ArrowRight'?1:-1)));track.style.setProperty('--selected-day',selectedDay);surface.setAttribute('aria-description',`Selected ${date(start+selectedDay)}. Press Enter to add a task.`);}
          if(event.key==='Enter'||event.key===' '){event.preventDefault();addAt(selectedDay);}
        };
        track.append(surface);
        if(task){
          const a=day(task.data.start||task.data.due),b=day(task.data.due||task.data.start);
          if(a!==null&&b!==null&&b>=start&&a<start+total){
            const fillStart=Math.max(0,a-start)*38,fillEnd=(Math.min(start+total-1,b)-start+1)*38;
            surface.style.setProperty('--task-fill-background',`linear-gradient(90deg,transparent ${fillStart}px,${taskColor(task)}33 ${fillStart}px,${taskColor(task)}33 ${fillEnd}px,transparent ${fillEnd}px)`);
            const bar=document.createElement('button');bar.className='planner-gantt-bar timeline-task';bar.dataset.taskId=task.id;
            bar.style.left=Math.max(0,a-start)*38+'px';bar.style.width=Math.max(30,(Math.min(start+total-1,b)-Math.max(start,a)+1)*38-4)+'px';
            bar.style.setProperty('--team-color',taskColor(task));bar.dataset.status=status(task);
            bar.textContent=`${isCompleteStatus(status(task))?'✓ ':''}${task.title}`;
            bar.title=`${task.title} · ${team(task.teamId).name} · ${task.data.start||task.data.due} → ${task.data.due||task.data.start}`;
            bar.setAttribute('aria-label',`Edit ${task.title}`);bar.onclick=event=>{event.stopPropagation();editTask(task);};bar.draggable=true;
            bar.ondragstart=e=>{e.dataTransfer.setData('application/x-frame-task',task.id);e.dataTransfer.effectAllowed='move';};track.append(bar);
          }else if(a===null){const badge=document.createElement('button');badge.className='planner-unscheduled';badge.textContent='Set dates';badge.onclick=event=>{event.stopPropagation();editTask(task);};track.append(badge);}
        }
        row.append(track);board.append(row);
      }
    }
    scroll.append(board);root.append(scroll);
    const outside=scheduled.filter(t=>day(t.data.due||t.data.start)<start||day(t.data.start||t.data.due)>=start+total).length;
    if(outside){const note=document.createElement('p');note.className='muted';note.textContent=`${outside} scheduled task(s) outside this date range. Use the arrows or Board view.`;root.append(note);}
  }
  renderGantt=function(root){
    indexWorkspace();
    const items=filteredTasks();
    const panel=document.createElement('section');panel.className='task-planner';
    panel.innerHTML=`<div class="planner-top"><div><span class="eyebrow">ONE SHARED PLAN</span><h3>Less chasing. More creating.</h3><p>Plan by date. Move work forward. Give every task an owner.</p></div><button data-teams>● Team colors</button></div>
      <div class="planner-stats"><span><b>${items.length}</b> tasks</span><span><b>${items.filter(t=>isCompleteStatus(status(t))).length}</b> completed</span><span><b>${items.filter(t=>!t.data.assignee).length}</b> unassigned</span><span><b>${items.filter(t=>day(t.data.due)!==null&&day(t.data.due)<day(nowDate())&&!isCompleteStatus(status(t))).length}</b> overdue</span></div>
      <div class="planner-toolbar"><div class="planner-switch"><button data-view="gantt" class="${ui.view==='gantt'?'active':''}">Gantt</button><button data-view="board" class="${ui.view==='board'?'active':''}">Board</button></div>
      <input aria-label="Search tasks" placeholder="Search tasks or people…" value="${esc(ui.search)}"><select aria-label="Filter task team"><option value="">All teams</option>${teams().map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>
      <select aria-label="Filter task assignee"><option value="">Everyone</option><option value="__none__">Unassigned</option>${state.people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
      <select aria-label="Group timeline"><option value="team">By team</option><option value="stage">By production stage</option><option value="shot">By shot</option></select></div>`;
    root.append(panel);panel.querySelector('[data-teams]').onclick=manageTeams;
    panel.querySelectorAll('[data-view]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.view===ui.view));b.onclick=()=>{ui.view=b.dataset.view;refresh();};});
    const search=panel.querySelector('[aria-label="Search tasks"]');let searchTimer;
    const applySearch=()=>{ui.page=0;ui.boardLimits={};if(panel.isConnected)renderResults(panel);};
    search.oninput=()=>{ui.search=search.value;clearTimeout(searchTimer);searchTimer=setTimeout(applySearch,120);};
    search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(searchTimer);applySearch();}};
    for(const [label,key] of [['Filter task team','team'],['Filter task assignee','person'],['Group timeline','group']]){const select=panel.querySelector(`[aria-label="${label}"]`);select.value=ui[key];select.onchange=()=>{ui[key]=select.value;ui.page=0;ui.boardLimits={};refresh();};}
    const quick=quickForm(panel);quick.classList.add('planner-quick-global');
    quick.onsubmit=e=>{e.preventDefault();if(!quick.elements.title.value.trim()){newTask({teamId:ui.team});return;}const title=quick.elements.title.value;quick.elements.title.value='';createTask(title,{teamId:quick.dataset.team??ui.team,due:quick.dataset.due??nowDate()});document.querySelector('[aria-label="New task title"]')?.focus();};
    const results=document.createElement('div');results.className='planner-results';panel.append(results);renderResults(panel);
  };

})();
