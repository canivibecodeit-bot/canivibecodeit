/* The Build Games judging page: every change saves at once through
   /api/thebuildgames/judging/score. Each field keeps only its latest value
   in flight; a failed save retries three times with growing waits, then
   shows "not saved" with a retry. The page reads fine server-rendered; this
   only keeps the counters and the save state honest. Same ClientRouter
   contract as the other page scripts (init now, and on astro:page-load). */
(() => {
  const WAITS = [800, 2500, 6000];
  const CATEGORIES = 3;

  const init = () => {
    const page = document.querySelector('[data-jg-page]');
    if (!page || page.dataset.jgBound) return;
    page.dataset.jgBound = '1';

    // The progress bar sticks under the site header, whatever its height.
    const header = document.querySelector('.site-header');
    const placeBar = () => {
      if (header) page.style.setProperty('--jg-top', `${Math.round(header.getBoundingClientRect().height)}px`);
    };
    placeBar();
    window.addEventListener('resize', placeBar);

    if (page.dataset.jgLocked) return;

    const doneEl = page.querySelector('[data-jg-done]');
    const statusEl = page.querySelector('[data-jg-status]');
    const statusText = page.querySelector('[data-jg-status-text]');
    const retryBtn = page.querySelector('[data-jg-retry]');
    const fields = new Map();

    const setStatus = (state, text) => {
      if (!statusEl) return;
      statusEl.dataset.state = state;
      statusText.textContent = text;
      retryBtn.hidden = state !== 'error';
    };

    const refreshStatus = () => {
      let saving = 0;
      let failed = 0;
      let message = '';
      for (const f of fields.values()) {
        if (f.inflight) saving += 1;
        if (f.failed) {
          failed += 1;
          message = f.message || message;
        }
      }
      if (failed) setStatus('error', message || 'not saved');
      else if (saving) setStatus('saving', 'saving');
      else setStatus('saved', 'saved');
    };

    const rowStatus = (entryEl, state, text) => {
      const el = entryEl.querySelector('[data-jg-row-status]');
      if (!el) return;
      el.dataset.state = state;
      el.textContent = text;
    };

    const recount = () => {
      let done = 0;
      for (const li of page.querySelectorAll('[data-jg-entry]')) {
        let got = 0;
        for (const seg of li.querySelectorAll('.jg-group')) {
          const scored = !!seg.querySelector('input:checked');
          seg.dataset.scored = scored ? '1' : '0';
          if (scored) got += 1;
        }
        li.dataset.scored = String(got);
        const word = li.querySelector('[data-jg-done-word]');
        if (word) word.textContent = got === CATEGORIES ? ' scored' : '';
        if (got === CATEGORIES) done += 1;
      }
      if (doneEl) doneEl.textContent = String(done);
      const total = Number(page.dataset.jgTotal) || 0;
      page.style.setProperty('--jg-pct', `${total ? Math.round((done / total) * 100) : 0}%`);
    };

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const post = async (payload) => {
      const res = await fetch('/api/thebuildgames/judging/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true };
      // Anything the server refused on purpose will not change on a retry.
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
      let message = 'not saved';
      if (res.status === 401) message = 'not saved · sign in again';
      else if (res.status === 423) message = 'not saved · judging is locked';
      return { ok: false, permanent, message };
    };

    const run = async (f) => {
      if (f.inflight) return;
      f.inflight = true;
      f.failed = false;
      rowStatus(f.entryEl, 'saving', 'saving');
      refreshStatus();
      try {
        while (f.sent !== f.latest) {
          const payload = f.latest;
          let result = { ok: false };
          for (let attempt = 0; attempt < WAITS.length + 1; attempt += 1) {
            try {
              result = await post(payload.body);
            } catch {
              result = { ok: false, permanent: false, message: 'not saved' };
            }
            if (result.ok || result.permanent) break;
            if (attempt < WAITS.length) await wait(WAITS[attempt]);
          }
          if (!result.ok) {
            f.failed = true;
            f.message = result.message;
            rowStatus(f.entryEl, 'error', result.message);
            return;
          }
          f.sent = payload;
        }
        rowStatus(f.entryEl, 'saved', 'saved');
      } finally {
        f.inflight = false;
        refreshStatus();
      }
    };

    const save = (entryEl, category, body) => {
      const key = `${entryEl.dataset.jgEntry}:${category}`;
      let f = fields.get(key);
      if (!f) {
        f = { entryEl, inflight: false, failed: false, sent: null, latest: null, message: '' };
        fields.set(key, f);
      }
      f.latest = { body };
      run(f);
    };

    page.addEventListener('change', (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement)) return;
      const entryEl = input.closest('[data-jg-entry]');
      if (!entryEl) return;
      if (input.type === 'radio') {
        const category = input.closest('[data-jg-score]')?.dataset.jgScore;
        if (!category) return;
        recount();
        save(entryEl, category, { entry: entryEl.dataset.jgEntry, category, score: Number(input.value) });
      } else if (input.matches('[data-jg-note]')) {
        clearTimeout(input._jgTimer);
        save(entryEl, 'note', { entry: entryEl.dataset.jgEntry, category: 'note', note: input.value });
      }
    });

    // Notes save while typing too, a moment after the last keystroke.
    page.addEventListener('input', (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement) || !input.matches('[data-jg-note]')) return;
      const entryEl = input.closest('[data-jg-entry]');
      clearTimeout(input._jgTimer);
      input._jgTimer = setTimeout(() => {
        save(entryEl, 'note', { entry: entryEl.dataset.jgEntry, category: 'note', note: input.value });
      }, 700);
    });

    // "add a note" opens the field; a label opens its "judged on" line.
    page.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-jg-note-toggle]');
      if (toggle) {
        const input = toggle.parentElement.querySelector('[data-jg-note]');
        toggle.hidden = true;
        toggle.setAttribute('aria-expanded', 'true');
        input.hidden = false;
        input.focus();
        return;
      }
      const label = e.target.closest('[data-jg-help-toggle]');
      if (label) {
        const help = label.parentElement.querySelector('.jg-help');
        const open = help.hidden;
        help.hidden = !open;
        label.setAttribute('aria-expanded', String(open));
      }
    });

    retryBtn?.addEventListener('click', () => {
      for (const f of fields.values()) if (f.failed) run(f);
    });

    window.addEventListener('beforeunload', (e) => {
      for (const f of fields.values()) {
        if (f.inflight || f.failed) {
          e.preventDefault();
          return;
        }
      }
    });

    recount();
  };

  init();
  document.addEventListener('astro:page-load', init);
})();
