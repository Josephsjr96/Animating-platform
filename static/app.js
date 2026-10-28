/* ============================================================
   Production Workspace — Front-end Module
   File: static/app.js
   Exposes: window.Wizard, window.API
   ============================================================ */

/* ============ API client ============ */
const CLOUD_API = 'https://animating-platform.josephsanjari1996.workers.dev';
const ACCESS_STORE = 'animation-workspace-key';
const API = {
  key() {
    let key = sessionStorage.getItem(ACCESS_STORE);
    if (!key) {
      key = prompt('Enter your private Workspace Access Key (WORKSPACE_ACCESS_KEY configured in Cloudflare):') || '';
      if (key) sessionStorage.setItem(ACCESS_STORE, key);
    }
    if (!key) throw new Error('Workspace access key required. Configure WORKSPACE_ACCESS_KEY in Cloudflare first.');
    return key;
  },
  async send(path, options={}) {
    const headers = new Headers(options.headers || {});
    headers.set('X-Workspace-Key', this.key());
    const response = await fetch(CLOUD_API+path, {...options, headers});
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) throw new Error('Cloudflare API returned a non-JSON response (HTTP '+response.status+')');
    const data = await response.json();
    if (response.status===401) {
      sessionStorage.removeItem(ACCESS_STORE);
      throw new Error(data.error || 'Incorrect workspace key. Reload and enter the right key.');
    }
    if (!response.ok) throw new Error(data.error || 'Cloudflare API error HTTP '+response.status);
    return data;
  },
  getWorkspace() { return this.send('/api/workspace'); },
  saveWorkspace(state) { return this.send('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)}); },
  scan(file,onProgress,geometry) {
    const form=new FormData();form.append('file',file);
    if(geometry)form.append('geometry',JSON.stringify(geometry));
    const key=this.key();
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open('POST',CLOUD_API+'/api/import/scan');
      xhr.setRequestHeader('X-Workspace-Key',key);
      xhr.upload.onprogress=e=>{if(e.lengthComputable && onProgress)onProgress(e.loaded/e.total)};
      xhr.onload=()=>{
        try {
          const data=JSON.parse(xhr.responseText);
          if(xhr.status===401)sessionStorage.removeItem(ACCESS_STORE);
          if(xhr.status<200||xhr.status>=300)reject(new Error(data.error||'Scan failed (HTTP '+xhr.status+')'));
          else resolve(data);
        }catch(e){reject(e instanceof SyntaxError?new Error('Cloudflare API returned invalid JSON (HTTP '+xhr.status+')'):e)}
      };
      xhr.onerror=()=>reject(new Error('Cannot reach Cloudflare API'));
      xhr.send(form);
    });
  },
  review(id,payload) { return this.send('/api/import/'+encodeURIComponent(id)+'/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); },
  commit(id,opts) { return this.send('/api/import/'+encodeURIComponent(id)+'/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(opts||{})}); }
};

/* ============ Helpers ============ */
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function confClass(c) {
  c = c ?? 0;
  return c >= 0.7 ? 'good' : c >= 0.4 ? 'mid' : 'low';
}

/* ============ Storyboard Import Wizard ============ */
const Wizard = {
  state: {
    file: null,
    result: null,
    panels: [],
    showLowOnly: false
  },

  mount(root) {
    if (!root) {
      console.error('[Wizard] mount() called with no root element');
      return;
    }

    root.innerHTML = `
      <div class="wizard">
        <div class="steps">
          <div class="step active" data-step="1">1 · Upload scan</div>
          <div class="step" data-step="2">2 · AI scanning</div>
          <div class="step" data-step="3">3 · Review &amp; edit</div>
          <div class="step" data-step="4">4 · Import</div>
        </div>

        <section class="panel step-1">
          <h3>Upload a storyboard page</h3>
          <p class="muted">
            One page → one row per panel. AI will detect panels, crop thumbnails,
            and read cut&nbsp;#/dialogue/seconds.
          </p>
          <label class="dropzone" id="drop">
            <input type="file" id="file" accept="image/*" hidden>
            <span class="dz-icon">🖼️</span>
            <span class="dz-text">Drop image here or click to browse</span>
          </label>
          <div class="preview" id="preview"></div>
          <div class="actions">
            <button class="primary" id="scanBtn" disabled>Scan with AI →</button>
          </div>
        </section>

        <section class="panel step-2" hidden>
          <h3>Scanning…</h3>
          <div class="progress"><div class="bar" id="bar"></div></div>
          <p class="muted" id="scanStatus">Preparing…</p>
        </section>

        <section class="panel step-3" hidden>
          <h3>Review extracted shots</h3>
          <p class="muted">
            <b id="panelCount">0</b> panels detected.
            Correct anything before importing.
            <button class="link" id="selectAll">Select all</button> ·
            <button class="link" id="selectNone">None</button> ·
            <button class="link" id="toggleLowConf">Show only low-confidence</button>
          </p>
          <p id="scanWarning" role="status" hidden></p>
          <div class="review-list" id="reviewList"></div>
          <p id="reviewValidation" role="alert" hidden></p>
          <div class="actions">
            <button class="ghost" id="backBtn">← Back</button>
            <button class="primary" id="commitBtn">Import to shot list →</button>
          </div>
        </section>

        <section class="panel step-4" hidden>
          <h3>✅ Imported</h3>
          <p id="doneMsg" class="muted"></p>
          <button class="primary" id="againBtn">Scan another page</button>
        </section>
      </div>
    `;

    this._bind(root);
  },

  _bind(root) {
    const $ = s => root.querySelector(s);

    const step = n => {
      root.querySelectorAll('.step').forEach(el =>
        el.classList.toggle('active', +el.dataset.step === n)
      );
      root.querySelectorAll('.panel').forEach((el, i) =>
        el.hidden = (i + 1) !== n
      );
    };

    const fileIn  = $('#file');
    const drop    = $('#drop');
    const preview = $('#preview');
    const scanBtn = $('#scanBtn');

    const onFile = f => {
      if (!f) return;
      if (!f.type.startsWith('image/')) {
        alert('Please drop an image file (PNG / JPG / WEBP).');
        return;
      }
      this.state.file = f;
      preview.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="preview">`;
      scanBtn.disabled = false;
    };

    fileIn.addEventListener('change', e => onFile(e.target.files[0]));

    ['dragenter', 'dragover'].forEach(ev =>
      drop.addEventListener(ev, e => {
        e.preventDefault();
        drop.classList.add('over');
      })
    );
    ['dragleave', 'drop'].forEach(ev =>
      drop.addEventListener(ev, e => {
        e.preventDefault();
        drop.classList.remove('over');
      })
    );
    drop.addEventListener('drop', e => {
      const f = e.dataTransfer?.files?.[0];
      if (f) onFile(f);
    });

    /* ---- Scan ---- */
    scanBtn.addEventListener('click', async () => {
      step(2);
      const bar = $('#bar');
      const status = $('#scanStatus');
      bar.style.width = '0%';

      try {
        status.textContent = 'Uploading…';
        const res = await API.scan(this.state.file, p => {
          bar.style.width = Math.round(p * 40) + '%';
        });

        if (res.error) throw new Error(res.error);

        bar.style.width = '100%';
        status.textContent = `Found ${res.panel_count} panels via ${res.source}.`;

        this.state.result = res;
        this.state.panels = res.panels.map((p, i) => ({
          ...p,
          include: true,
          _idx: i
        }));

        this._renderReview($('#reviewList'), $('#panelCount'));

        setTimeout(() => step(3), 350);
      } catch (err) {
        console.error('[Wizard] scan failed:', err);
        status.textContent = '❌ ' + err.message;
        setTimeout(() => step(1), 2000);
      }
    });

    /* ---- Review actions ---- */
    $('#backBtn').addEventListener('click', () => step(1));

    $('#selectAll').addEventListener('click', () => {
      this.state.panels.forEach(p => p.include = true);
      this._renderReview($('#reviewList'), $('#panelCount'));
    });

    $('#selectNone').addEventListener('click', () => {
      this.state.panels.forEach(p => p.include = false);
      this._renderReview($('#reviewList'), $('#panelCount'));
    });

    $('#toggleLowConf').addEventListener('click', () => {
      this.state.showLowOnly = !this.state.showLowOnly;
      this._renderReview($('#reviewList'), $('#panelCount'));
    });

    /* ---- Commit ---- */
    $('#commitBtn').addEventListener('click', async () => {
      const btn = $('#commitBtn');
      const invalid = this.state.panels.filter(p => p.include &&
        (!String(p.number ?? '').trim() || !Number.isFinite(Number(p.duration)) || !(Number(p.duration) > 0)));
      const validation = $('#reviewValidation');
      if (invalid.length) {
        this.state.showLowOnly = false;
        this._renderReview($('#reviewList'), $('#panelCount'));
        validation.textContent = 'Before importing, enter a cut number and a duration greater than zero for each included drawing. Check drawings: ' + invalid.map(p => p._idx + 1).join(', ') + '. You can uncheck drawings to skip them.';
        validation.hidden = false;
        const first = invalid[0];
        const role = !String(first.number ?? '').trim() ? 'number' : 'duration';
        const input = $('#reviewList').querySelector(`[data-idx="${first._idx}"] [data-role="${role}"]`);
        input?.focus();
        input?.scrollIntoView({block:'center'});
        return;
      }
      validation.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Importing…';

      try {
        const payload = {
          panels: this.state.panels.map(p => ({
            number: p.number,
            description: p.description,
            notes: p.notes,
            dialogue: p.dialogue,
            duration: p.duration,
            include: p.include
          }))
        };

        const reviewResult = await API.review(this.state.result.import_id, payload);
        if (!reviewResult.ok) throw new Error(reviewResult.error || 'Review failed');

        const local = JSON.parse(localStorage.getItem('production-workspace-v1') || 'null');
        let ws = await API.getWorkspace();
        if (ws.empty) {
          if (!local) throw new Error('No local workspace found. Open the Dashboard first.');
          await API.saveWorkspace(local);
          ws = local;
        }
        const stageIds = (ws.stages || []).map(s => s.id);

        const res = await API.commit(this.state.result.import_id, {
          default_element: 'Main Character',
          default_stage_ids: stageIds.slice(0, 3)
        });

        if (!res.ok) throw new Error(res.error || 'Import failed');
        if (res.workspace) localStorage.setItem('production-workspace-v1', JSON.stringify(res.workspace));
        $('#doneMsg').textContent =
          `Added ${res.added.length} shots. Workspace now has ${res.total_shots} shots. Refresh to see them in the dashboard.`;
        step(4);
      } catch (e) {
        console.error('[Wizard] commit failed:', e);
        alert('Import failed: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Import to shot list →';
      }
    });

    /* ---- Reset ---- */
    $('#againBtn').addEventListener('click', () => {
      this.state = {
        file: null, result: null, panels: [], showLowOnly: false
      };
      $('#file').value = '';
      $('#preview').innerHTML = '';
      $('#scanBtn').disabled = true;
      step(1);
    });
  },

  _renderReview(list, counter) {
    const warning = list.closest('#importWizard')?.querySelector('#scanWarning');
    if(warning){warning.textContent=this.state.result?.warning||'';warning.hidden=!warning.textContent;}
    const panels = this.state.panels.filter(p =>
      !this.state.showLowOnly || (p.confidence ?? 1) < 0.6
    );
    counter.textContent = panels.length;

    if (!panels.length) {
      list.innerHTML = `<p class="muted">No panels to review. Try rescanning.</p>`;
      return;
    }

    list.innerHTML = panels.map(p => `
      <div class="review-card ${p.include ? '' : 'skipped'}" data-idx="${p._idx}">
        <label class="chk">
          <input type="checkbox" ${p.include ? 'checked' : ''} data-role="include">
        </label>
        <div class="thumb">
          ${p.thumbnail_b64
            ? `<img src="data:image/png;base64,${p.thumbnail_b64}" alt="">`
            : `<div class="noimg">no crop</div>`}
        </div>
        <div class="fields">
          <div class="row">
            <input value="${esc(p.number ?? '')}" data-role="number" placeholder="Cut number" aria-label="Cut number for drawing ${p._idx + 1}">
            <input type="number" min="0.001" step="any" value="${esc(p.duration ?? '')}"
                   data-role="duration" placeholder="Seconds" aria-label="Duration in seconds for drawing ${p._idx + 1}">
            <span class="conf ${confClass(p.confidence)}">
              conf ${Math.round((p.confidence ?? 0) * 100)}%
            </span>
          </div>
          <input value="${esc(p.description || '')}" data-role="description"
                 placeholder="Description / action">
          <input value="${esc(p.dialogue || '')}" data-role="dialogue"
                 placeholder="Dialogue">
          <textarea data-role="notes" placeholder="Notes">${esc(p.notes || '')}</textarea>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.review-card').forEach(card => {
      const idx = +card.dataset.idx;
      const panel = this.state.panels[idx];

      card.querySelectorAll('[data-role]').forEach(inp => {
        const handler = () => {
          const role = inp.dataset.role;
          if (role === 'include') {
            panel.include = inp.checked;
            card.classList.toggle('skipped', !panel.include);
          } else if (role === 'duration') {
            panel.duration = inp.value === '' ? null : Number(inp.value);
          } else {
            panel[role] = inp.value;
          }
          card.querySelector('[data-role="number"]').setAttribute('aria-invalid', String(panel.include && !String(panel.number ?? '').trim()));
          card.querySelector('[data-role="duration"]').setAttribute('aria-invalid', String(panel.include && (!Number.isFinite(Number(panel.duration)) || !(Number(panel.duration) > 0))));
        };
        inp.addEventListener('input', handler);
        inp.addEventListener('change', handler);
      });
    });
  }
};

/* ============ Expose globally ============ */
window.Wizard = Wizard;
window.API = API;

console.log('[app.js] Production Workspace front-end loaded — Wizard ready.');
