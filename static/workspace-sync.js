/* Use the existing authenticated Cloudflare client for both workspace and imports.
   No Worker routes, authentication, or request schemas are changed. */
(() => {
  'use strict';
  let saves = Promise.resolve();
  let saveFailed = false;
  const pendingKey = LS_KEY + '-unsynced';
  const pending = () => {
    try { return JSON.parse(localStorage.getItem(pendingKey)); } catch { return null; }
  };
  const cache = workspace => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(workspace)); }
    catch { /* Cloudflare remains the source of truth if browser storage is full. */ }
  };
  const status = (message, ok) => {
    const el = document.getElementById('backendStatus');
    if (!el) return;
    el.textContent = message;
    el.className = ok ? 'ok' : 'bad';
    el.title = message;
  };
  const validWorkspace = data => data && Array.isArray(data.shots) &&
    Array.isArray(data.stages) && Array.isArray(data.people) &&
    data.project && typeof data.cells === 'object' && data.cells !== null;

  loadState = async function() {
    try {
      const data = await API.getWorkspace();
      if (!data || (data.empty !== true && !validWorkspace(data))) {
        throw new Error('Workspace response is incomplete');
      }
      backendOK = true;
      saveFailed = false;
      if (data.empty === true) {
        // Opening an empty account must not create sample shots on the server.
        const empty = seed();
        empty.shots = [];
        empty.cells = {};
        status('● Cloudflare connected', true);
        return empty;
      }
      cache(data);
      status(pending() ? '● Cloud connected · local backup available' : '● Cloudflare connected', true);
      return data;
    } catch (error) {
      backendOK = false;
      status('● Local only · cloud unavailable', false);
      console.warn('[workspace] Cloudflare load failed; using local cache:', error.message);
      try {
        const cached = pending() || JSON.parse(localStorage.getItem(LS_KEY));
        if (validWorkspace(cached)) return cached;
      } catch {}
      const empty = seed();
      empty.shots = [];
      empty.cells = {};
      return empty;
    }
  };

  saveState = function(workspace = state) {
    // Snapshot now: later UI mutations must not change a queued request's contents.
    const snapshot = JSON.parse(JSON.stringify(workspace));
    const serialized = JSON.stringify(snapshot);
    try { localStorage.setItem(pendingKey, serialized); } catch {}
    cache(snapshot);
    if (!backendOK || saveFailed) {
      status('● Saved locally · cloud not synced', false);
      return Promise.resolve(false);
    }
    status('● Saving to Cloudflare…', true);
    saves = saves.then(async () => {
      if (saveFailed) return false;
      try {
        const result = await API.saveWorkspace(snapshot);
        if (!result || result.ok !== true) throw new Error('Workspace save was not confirmed');
        try {
          if (localStorage.getItem(pendingKey) === serialized) localStorage.removeItem(pendingKey);
        } catch {}
        status('● Saved to Cloudflare', true);
        return true;
      } catch (error) {
        saveFailed = true;
        backendOK = false;
        status('● Save failed · local copy retained', false);
        console.warn('[workspace] Cloudflare save failed:', error.message);
        return false;
      }
    });
    return saves;
  };

  const commit = API.commit.bind(API);
  API.commit = async function(id, options) {
    // Prevent edits being queued against the old workspace while import commits.
    const wasInert = document.body.inert;
    document.body.inert = true;
    document.body.setAttribute('aria-busy', 'true');
    try {
      await saves;
      if (saveFailed || pending()) throw new Error('Workspace changes have not synced. Download your local backup before resolving the connection and importing.');
      const result = await commit(id, options);
      if (result.ok && validWorkspace(result.workspace)) {
        state = result.workspace;
        cache(state);
        backendOK = true;
        status('● Storyboard imported · cloud synced', true);
      }
      return result;
    } finally {
      document.body.inert = wasInert;
      document.body.removeAttribute('aria-busy');
    }
  };
  window.addEventListener('DOMContentLoaded', () => {
    const button = document.createElement('button');
    button.textContent = 'Download local backup';
    button.title = 'Download edits that could not be saved to Cloudflare';
    button.hidden = !pending();
    button.onclick = () => {
      const data = pending();
      if (!data) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'production-workspace-unsynced.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    document.querySelector('.topbar-actions')?.prepend(button);
    const observer = new MutationObserver(() => { button.hidden = !pending(); });
    observer.observe(document.getElementById('backendStatus'), {childList:true});
  });
})();
