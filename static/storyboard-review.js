/* Local review prototype. The scanner, API payloads and live backend are unchanged. */
(() => {
  'use strict';
  const key = 'nuvren-storyboard-review-v1';
  let pages = {};
  let storageError = '';
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved?.version === 1 && saved.pages && typeof saved.pages === 'object' && !Array.isArray(saved.pages)) {
      if (!Object.values(saved.pages).every(page => page && typeof page.importId === 'string' && Array.isArray(page.panels) && page.panels.every(panel => panel && typeof panel === 'object' && Number.isInteger(panel._idx)))) throw new Error('Invalid review draft');
      pages = saved.pages;
    }
  } catch { storageError = 'Saved reviews could not be read. Download this session before closing.'; }
  const initialized = new WeakSet();
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = () => Wizard.state.result?.import_id;
  const groups = () => {
    const result = new Map();
    Object.values(pages).forEach(page => page.panels.forEach(panel => {
      if (panel.include !== false && panel.reviewGroup) {
        const group = result.get(panel.reviewGroup) || [];
        group.push({ pageId: page.importId, filename: page.filename, panel });
        result.set(panel.reviewGroup, group);
      }
    }));
    return result;
  };
  function remember() {
    if (!id()) return;
    pages[id()] = {
      importId: id(), filename: Wizard.state.file?.name || Wizard.state.result.filename || 'Storyboard page',
      panels: clone(Wizard.state.panels)
    };
    try { localStorage.setItem(key, JSON.stringify({ version: 1, pages })); storageError = ''; }
    catch { storageError = 'Browser storage is full or unavailable. Download the review draft before closing.'; }
    document.querySelectorAll('[data-review-status]').forEach(el => {
      el.textContent = storageError || 'Review saved locally. Grouping has not been imported to the cloud.';
    });
  }
  function download() {
    remember();
    const shots = [...groups()].map(([groupId, drawings]) => ({
      groupId, number: drawings[0].panel.number || '',
      // Duration is reviewed per shot; never sum repeated panel duration readings.
      duration: null, drawings
    }));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, pages, shots }, null, 2)], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'nuvren-storyboard-review.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function blocked() {
    return Wizard.state.restoredLocalReview || Wizard.state.panels.some(panel =>
      panel.include !== false && (groups().get(panel.reviewGroup)?.length || 0) > 1
    );
  }
  function updateNotice(root) {
    const message = root.querySelector('[data-grouping-notice]');
    if (message) message.textContent = blocked()
      ? 'Local review only: grouped or restored drafts cannot use the current one-panel-per-shot cloud importer. Use Import reviewed shots locally to preserve every drawing.'
      : 'Single-panel imports retain the existing cloud workflow. Grouped shots stay in a local review draft.';
    const button = root.querySelector('#commitBtn');
    if (button) { button.disabled = !!blocked(); button.title = blocked() ? 'Grouped import needs a new backend contract' : ''; }
  }
  const render = Wizard._renderReview.bind(Wizard);
  Wizard._renderReview = function(list, counter) {
    const current = this.state;
    if (!initialized.has(current.panels)) {
      current.panels.forEach(panel => {
        // Leave interpretation to the director; retain the scanner's notes/dialogue/crops.
        panel.description = '';
        panel.reviewGroup ||= crypto.randomUUID();
      });
      initialized.add(current.panels);
    }
    remember();
    render(list, counter);
    const root = list.closest('#importWizard');
    const available = groups();
    list.querySelectorAll('.review-card').forEach(card => {
      const panel = current.panels.find(p => p._idx === Number(card.dataset.idx));
      if (!panel) return;
      const description = card.querySelector('[data-role="description"]');
      description?.setAttribute('aria-label', `Director action for drawing ${panel._idx + 1}`);
      description?.setAttribute('placeholder', 'Director action — enter manually');
      const timing = card.querySelector('[data-role="duration"]');
      if (timing) { timing.value = panel.duration ?? ''; timing.step = 'any'; timing.min = '0.001'; timing.setAttribute('aria-label', `Scanned seconds for drawing ${panel._idx + 1}`); }
      const number = card.querySelector('[data-role="number"]');
      number?.setAttribute('aria-label', `Shot number for drawing ${panel._idx + 1}`);
      const controls = document.createElement('div'); controls.className = 'drawing-group-controls';
      const label = document.createElement('label'); label.textContent = 'Shot group ';
      const select = document.createElement('select'); select.setAttribute('aria-label', `Shot group for drawing ${panel._idx + 1}`);
      for (const [groupId, drawings] of available) {
        const first = drawings[0];
        const option = document.createElement('option'); option.value = groupId;
        option.textContent = `${first.panel.number || 'Unnumbered'} · ${first.filename} · drawing ${first.panel._idx + 1} (${drawings.length})`;
        select.append(option);
      }
      // Excluded panels still need their own selectable group.
      if (![...select.options].some(option => option.value === panel.reviewGroup)) {
        select.add(new Option('Separate shot', panel.reviewGroup));
      }
      select.value = panel.reviewGroup;
      select.onchange = () => {
        const target = available.get(select.value)?.[0]?.panel;
        panel.reviewGroup = select.value;
        if (target) panel.number = target.number;
        remember(); this._renderReview(list, counter);
      };
      label.append(select); controls.append(label);
      const split = document.createElement('button'); split.type = 'button'; split.textContent = 'Make separate shot';
      split.onclick = () => { panel.reviewGroup = crypto.randomUUID(); remember(); this._renderReview(list, counter); };
      controls.append(split); card.querySelector('.fields').prepend(controls);
      card.querySelectorAll('[data-role]').forEach(input => input.addEventListener('input', () => {
        if (input.dataset.role === 'duration') panel.duration = input.value === '' ? null : Number(input.value);
        if (input.dataset.role === 'number') {
          Object.values(pages).forEach(page => page.panels.forEach(p => { if (p.reviewGroup === panel.reviewGroup) p.number = panel.number; }));
          current.panels.forEach(p => { if (p.reviewGroup === panel.reviewGroup) p.number = panel.number; });
          list.querySelectorAll('.review-card').forEach(other => {
            const p = current.panels.find(p => p._idx === Number(other.dataset.idx));
            if (p?.reviewGroup === panel.reviewGroup) other.querySelector('[data-role="number"]').value = panel.number;
          });
        }
        remember(); updateNotice(root);
      }));
    });
    updateNotice(root);
  };
  const mount = Wizard.mount.bind(Wizard);
  Wizard.mount = function(root) {
    mount(root);
    root.querySelector('.step-1 .muted').textContent = 'Scan drawings, then review which drawings belong to each shot. Action descriptions are entered by the director.';
    const tools = document.createElement('section'); tools.className = 'scan-queue local-review-tools';
    const title = document.createElement('h3'); title.textContent = 'Local storyboard review'; tools.append(title);
    const help = document.createElement('p'); help.textContent = 'Review drawings as shots. Choose the same group to join drawings, including drawings from other reviewed pages. Equal scanned cut numbers are suggestions, not automatic grouping.'; tools.append(help);
    const save = document.createElement('button'); save.textContent = 'Download review draft'; save.onclick = download; tools.append(save);
    const saved = document.createElement('select'); saved.setAttribute('aria-label', 'Saved review page');
    saved.add(new Option('Choose a saved page', ''));
    Object.values(pages).forEach(page => saved.add(new Option(page.filename, page.importId))); tools.append(saved);
    const restore = document.createElement('button'); restore.textContent = 'Open saved review';
    restore.onclick = () => {
      const page = pages[saved.value]; if (!page) return;
      this.state = {file:null, result:{import_id:page.importId,filename:page.filename},panels:clone(page.panels),showLowOnly:false,restoredLocalReview:true};
      initialized.add(this.state.panels);
      this._renderReview(root.querySelector('#reviewList'), root.querySelector('#panelCount'));
      root.querySelectorAll('.wizard > .panel').forEach((el,i) => el.hidden = i !== 2);
      root.querySelectorAll('.step').forEach(el => el.classList.toggle('active', el.dataset.step === '3'));
    };
    tools.append(restore);
    const libraryKey = 'nuvren-storyboard-shots-v1';
    const feedback = document.createElement('p'); feedback.setAttribute('role', 'status');
    const gallery = document.createElement('section'); gallery.setAttribute('aria-label', 'Local imported shots');
    const readShots = () => {
      const data = JSON.parse(localStorage.getItem(libraryKey) || '{"version":1,"shots":[]}');
      if (data.version !== 1 || !Array.isArray(data.shots)) throw new Error('Cannot read the local shot library. Existing data retained.');
      return data.shots;
    };
    function showShots() {
      gallery.replaceChildren();
      try {
        const shots = readShots();
        const heading = document.createElement('h3'); heading.textContent = `Local imported shots (${shots.length})`; gallery.append(heading);
        shots.forEach(shot => {
          const details = document.createElement('details');
          const summary = document.createElement('summary'); summary.textContent = `${shot.number || 'Unnumbered'} · ${shot.drawings.length} drawings`; details.append(summary);
          shot.drawings.forEach((drawing, index) => {
            const figure = document.createElement('figure');
            if (drawing.panel.thumbnail_b64) {
              const image = document.createElement('img'); image.src = 'data:image/png;base64,' + drawing.panel.thumbnail_b64;
              image.alt = `Drawing ${index + 1}`; image.style.maxWidth = '240px'; figure.append(image);
            }
            const caption = document.createElement('figcaption'); caption.style.whiteSpace = 'pre-wrap';
            caption.textContent = `${index + 1}. ${drawing.filename} · drawing ${drawing.panel._idx + 1}\nAction: ${drawing.panel.description || ''}\nNotes: ${drawing.panel.notes || ''}\nDialogue: ${drawing.panel.dialogue || ''}`;
            figure.append(caption); details.append(figure);
          });
          gallery.append(details);
        });
      } catch (error) { feedback.textContent = error.message; }
    }
    const localImport = document.createElement('button'); localImport.textContent = 'Import reviewed shots locally';
    localImport.onclick = () => {
      remember();
      try {
        if (storageError) throw new Error(storageError);
        const reviewed = [...groups()];
        if (!reviewed.length) throw new Error('Review at least one included drawing first.');
        const numbers = new Set();
        reviewed.forEach(([, drawings]) => {
          const number = String(drawings[0].panel.number || '').trim();
          if (number && numbers.has(number)) throw new Error(`Shot number ${number} belongs to separate groups. Group the drawings or correct the number before import.`);
          if (number) numbers.add(number);
        });
        const pageIds = new Set(Object.keys(pages));
        const retained = readShots().filter(shot => !shot.drawings.some(drawing => pageIds.has(drawing.pageId)));
        const shots = reviewed.map(([groupId, drawings]) => ({version:1, id:groupId, number:String(drawings[0].panel.number || '').trim(), duration:null, coverDrawing:0, drawings:clone(drawings)}));
        if (retained.some(shot => shot.number && numbers.has(shot.number))) throw new Error('A shot number already exists in the local library. Correct it before import.');
        localStorage.setItem(libraryKey, JSON.stringify({version:1, shots:[...retained, ...shots]}));
        feedback.textContent = `Imported ${shots.length} shots with ${shots.reduce((sum, shot) => sum + shot.drawings.length, 0)} drawings locally. Cloud workspace unchanged.`;
        showShots();
      } catch (error) { feedback.textContent = error.message; }
    };
    const label = document.createElement('label'); label.textContent = 'Restore review draft ';
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', 'Restore review draft');
    file.onchange = async () => {
      try {
        const draft = JSON.parse(await file.files[0].text());
        if (draft.version !== 1 || !draft.pages || typeof draft.pages !== 'object' || Array.isArray(draft.pages) || !Object.entries(draft.pages).every(([pageId, page]) => page && page.importId === pageId && typeof page.filename === 'string' && Array.isArray(page.panels) && page.panels.every(panel => panel && typeof panel === 'object' && Number.isInteger(panel._idx) && typeof panel.reviewGroup === 'string' && panel.reviewGroup.length))) throw new Error('Invalid review draft. Existing review retained.');
        const merged = {...pages, ...draft.pages};
        localStorage.setItem(key, JSON.stringify({version:1, pages:merged})); pages = merged; storageError = '';
        saved.replaceChildren(new Option('Choose a saved page', ''));
        Object.values(pages).forEach(page => saved.add(new Option(page.filename, page.importId)));
        this.state = {file:null, result:null, panels:[], showLowOnly:false};
        root.querySelectorAll('.wizard > .panel').forEach((el,i) => el.hidden = i !== 0);
        root.querySelectorAll('.step').forEach(el => el.classList.toggle('active', el.dataset.step === '1'));
        feedback.textContent = 'Draft restored. Choose a saved page and open it to review.';
      } catch (error) { feedback.textContent = error.message; }
      file.value = '';
    };
    label.append(file); tools.append(localImport, label, feedback, gallery); showShots();
    const status = document.createElement('p'); status.dataset.reviewStatus = ''; status.setAttribute('role','status');
    status.textContent = storageError || 'Drafts are stored in this browser. Download a backup to keep a portable copy.'; tools.append(status);
    // Keep outside .wizard: the existing wizard uses its panel positions as step IDs.
    root.prepend(tools);
    const notice = document.createElement('p'); notice.dataset.groupingNotice = ''; notice.setAttribute('role','status');
    root.querySelector('#commitBtn').before(notice);
    root.querySelector('#commitBtn').addEventListener('click', event => {
      remember();
      if (blocked()) { event.preventDefault(); event.stopImmediatePropagation(); updateNotice(root); }
    }, true);
  };
})();
