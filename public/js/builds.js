/* Builds vertical: client wiring. Same ClientRouter contract as app.js:
   everything wires per page visit on astro:page-load, cleanups run on
   astro:before-swap, and data-signin elements are left alone here (app.js
   opens the signup surface for them). */
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const track = (event, props) => window.posthog?.capture(event, props);

  let cleanups = [];
  const onLeave = (fn) => cleanups.push(fn);
  document.addEventListener('astro:before-swap', () => {
    cleanups.forEach((fn) => fn());
    cleanups = [];
  });

  let toastTimer;
  const toast = (msg) => {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  };

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    return ok;
  };

  const jsonPost = (url, method, body) =>
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  /* ---------- /builds index: model filter dropdown ---------- */

  const initIndex = () => {
    const root = $('[data-bd-model]');
    if (!root || root.dataset.wired) return;
    root.dataset.wired = '1';
    const btn = $('.bd-model-btn', root);
    const pop = $('.bd-model-pop', root);
    const search = $('.bd-model-search input', root);
    const opts = $$('.bd-model-opt', root);
    const open = (on) => {
      pop.hidden = !on;
      btn.setAttribute('aria-expanded', String(on));
      if (on) {
        search.value = '';
        opts.forEach((o) => (o.hidden = false));
        search.focus();
      }
    };
    btn.addEventListener('click', () => open(pop.hidden));
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      opts.forEach((o) => (o.hidden = !!q && !o.textContent.toLowerCase().includes(q)));
    });
    const away = (e) => {
      if (!root.contains(e.target)) open(false);
    };
    const esc = (e) => {
      if (e.key === 'Escape' && !pop.hidden) open(false);
    };
    document.addEventListener('click', away);
    document.addEventListener('keydown', esc);
    onLeave(() => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', esc);
    });
  };

  /* Build pages carry no copy wiring of their own: their prompt buttons are
     the site-wide .copy-group markup (CopyGroup.astro) and app.js's delegate
     handles them exactly as on the verdict pages. */

  /* ---------- build page: screenshot carousel ---------- */

  const initCarousel = () => {
    const wrap = $('[data-bd-carwrap]');
    if (!wrap || wrap.dataset.wired) return;
    wrap.dataset.wired = '1';
    const car = $('.bd-carousel', wrap);
    const prev = $('[data-car-prev]', wrap);
    const next = $('[data-car-next]', wrap);
    const step = () => {
      const img = $('img', car);
      return (img ? img.getBoundingClientRect().width : car.clientWidth * 0.86) + 12;
    };
    const syncArrows = () => {
      prev.hidden = car.scrollLeft < 10;
      next.hidden = car.scrollLeft > car.scrollWidth - car.clientWidth - 10;
    };
    prev.addEventListener('click', () => car.scrollBy({ left: -step(), behavior: 'smooth' }));
    next.addEventListener('click', () => car.scrollBy({ left: step(), behavior: 'smooth' }));
    car.addEventListener('scroll', syncArrows, { passive: true });
    syncArrows();

    /* Mouse drag-to-scroll. Touch already pans natively; snap is parked
       during the drag so the strip follows the cursor, and re-engages on
       release (the browser then settles on the nearest slide). */
    let drag = null;
    car.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, left: car.scrollLeft };
      car.classList.add('dragging');
      car.setPointerCapture(e.pointerId);
    });
    car.addEventListener('pointermove', (e) => {
      if (drag) car.scrollLeft = drag.left - (e.clientX - drag.x);
    });
    const release = () => {
      if (!drag) return;
      const delta = car.scrollLeft - drag.left;
      drag = null;
      /* Mandatory snap would yank a sub-slide drag back where it started;
         commit the drag's direction once it's past a fifth of a slide. The
         .dragging class (snap off) stays on until the commit scroll lands —
         re-enabling snap first lets the browser race it back to the old
         slide. */
      const s = step();
      const target =
        Math.abs(delta) < s * 0.2
          ? Math.round(car.scrollLeft / s)
          : delta > 0
            ? Math.ceil(car.scrollLeft / s)
            : Math.floor(car.scrollLeft / s);
      const done = () => {
        car.classList.remove('dragging');
        car.removeEventListener('scrollend', done);
      };
      car.addEventListener('scrollend', done);
      setTimeout(done, 700); // scrollend fallback
      car.scrollTo({ left: target * s, behavior: 'smooth' });
    };
    car.addEventListener('pointerup', release);
    car.addEventListener('pointercancel', release);
  };

  /* ---------- /post-a-build ---------- */

  const initPost = () => {
    const wrap = $('.bp-wrap');
    if (!wrap || wrap.dataset.wired) return;
    wrap.dataset.wired = '1';
    const signedIn = wrap.dataset.signedIn === '1';

    let catalog = [];
    try {
      catalog = JSON.parse($('#bp-catalog')?.textContent || '[]');
    } catch {}
    let lists = { models: [], tools: [] };
    try {
      lists = JSON.parse($('#bp-lists')?.textContent || '{}');
    } catch {}

    const state = {
      goes: null, // 'one' | 'few' | 'weeks' | 'never'
      app: null, // optional attach target
      media: [], // uploaded screenshots: [{id, url}]
      pendingFiles: [], // Files picked while signed out, waiting for a session
    };

    /* Draft persistence: the sign-in click is a full OAuth round trip, so a
       half-filled form would die with the navigation. Text state rides
       sessionStorage (tab-scoped, gone when the tab closes); files picked
       while signed out ride IndexedDB as blobs and upload themselves the
       moment the maker is back with a session. Cleared on successful post. */
    const DRAFT_KEY = 'bp-draft';
    const DRAFT_FIELDS = [
      'name', 'one_liner', 'prompt', 'story', 'where_broke', 'tool', 'model',
      'chat_url', 'demo_url', 'repo_url', 'affiliation',
    ];
    const saveDraft = () => {
      try {
        const form = $('#bp-form');
        const d = {
          goes: state.goes,
          app: state.app?.slug ?? null,
          media: state.media,
          handle: $('#bp-handle')?.value ?? '',
        };
        for (const f of DRAFT_FIELDS) d[f] = form?.elements[f]?.value ?? '';
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      } catch {}
    };
    const idbOpen = () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('bp-stash', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('files', { autoIncrement: true });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const idbTx = async (mode, run) => {
      const db = await idbOpen();
      return new Promise((resolve, reject) => {
        const req = run(db.transaction('files', mode).objectStore('files'));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    };
    const stashFiles = () =>
      idbTx('readwrite', (s) => s.clear())
        .then(() => Promise.all(state.pendingFiles.map((f) => idbTx('readwrite', (s) => s.add(f)))))
        .catch(() => {});
    const stashedFiles = () => idbTx('readonly', (s) => s.getAll()).catch(() => []);
    const clearStash = () => idbTx('readwrite', (s) => s.clear()).catch(() => {});
    const clearDraft = () => {
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {}
      return clearStash();
    };

    /* Typeahead picker: rows are built as DOM nodes, never HTML strings. */
    const wireSearch = (root, onPick) => {
      if (!root) return { set: () => {} };
      const input = $('input', root);
      const results = $('.bp-results', root);
      /* Once an app is picked its icon tile replaces the magnifier, so the
         chosen app reads at a glance; typing again brings the glass back. */
      const glyph = $('.bp-searchglyph', root);
      const mag = $('.bp-mag', root);
      const showPick = (a) => {
        if (!glyph || !mag) return;
        if (a) {
          glyph.src = `/icons/${a.slug}.png`;
          glyph.hidden = false;
          mag.style.display = 'none';
        } else {
          glyph.hidden = true;
          glyph.removeAttribute('src');
          mag.style.display = '';
        }
      };
      const render = (q) => {
        const query = q.trim().toLowerCase();
        results.replaceChildren();
        if (!query) {
          results.hidden = true;
          return;
        }
        const hits = catalog.filter((a) => a.name.toLowerCase().includes(query)).slice(0, 6);
        if (!hits.length) {
          results.hidden = true;
          return;
        }
        hits.forEach((a) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'bp-result';
          const img = document.createElement('img');
          img.src = `/icons/${a.slug}.png`;
          img.alt = '';
          img.width = 20;
          img.height = 20;
          const name = document.createElement('b');
          name.textContent = a.name;
          const meta = document.createElement('span');
          meta.textContent = `${a.price != null ? `$${a.price}/mo` : 'varies'}${a.cat ? ` · ${a.cat}` : ''}`;
          row.append(img, name, meta);
          row.addEventListener('click', () => {
            input.value = a.name;
            results.hidden = true;
            root.classList.add('picked');
            showPick(a);
            onPick(a);
          });
          results.appendChild(row);
        });
        results.hidden = false;
      };
      input.addEventListener('input', () => {
        root.classList.remove('picked');
        showPick(null);
        onPick(null);
        render(input.value);
      });
      input.addEventListener('focus', () => render(input.value));
      const away = (e) => {
        if (!root.contains(e.target)) results.hidden = true;
      };
      document.addEventListener('click', away);
      onLeave(() => document.removeEventListener('click', away));
      return {
        set: (a) => {
          input.value = a.name;
          root.classList.add('picked');
          showPick(a);
          onPick(a);
        },
      };
    };

    /* Model / tool combos: the input is the search box, the panel below is
       the list. Free text always stands; picking is a convenience. */
    const wireCombo = (root) => {
      if (!root) return;
      const input = $('input', root);
      const results = $('.bp-results', root);
      const options = lists[root.dataset.bdCombo] ?? [];
      const render = () => {
        const q = input.value.trim().toLowerCase();
        results.replaceChildren();
        const hits = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
        if (!hits.length) {
          results.hidden = true;
          return;
        }
        hits.forEach((o) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'bp-result';
          const name = document.createElement('b');
          name.textContent = o;
          row.appendChild(name);
          row.addEventListener('click', () => {
            input.value = o;
            results.hidden = true;
          });
          results.appendChild(row);
        });
        results.hidden = false;
      };
      input.addEventListener('input', render);
      input.addEventListener('focus', render);
      const away = (e) => {
        if (!root.contains(e.target)) results.hidden = true;
      };
      document.addEventListener('click', away);
      onLeave(() => document.removeEventListener('click', away));
    };
    $$('[data-bd-combo]').forEach(wireCombo);

    const search = wireSearch($('#bp-search'), (a) => {
      state.app = a;
      saveDraft();
    });

    /* "How many goes?" chips decide what the form asks for next. */
    const promptField = $('[data-bd-promptfield]');
    const promptLabel = $('[data-bd-promptlabel]');
    const storyField = $('[data-bd-storyfield]');
    const brokeField = $('[data-bd-brokefield]');
    const brokeLabel = $('[data-bd-brokelabel]');
    const linkHint = $('[data-bd-linkhint]');
    const syncGoes = () => {
      const g = state.goes;
      $$('[data-bd-goes] .bp-chip').forEach((b) =>
        b.classList.toggle('active', b.dataset.goes === g)
      );
      if (!g) return;
      promptField.hidden = false;
      brokeField.hidden = false;
      storyField.hidden = g !== 'weeks';
      promptLabel.textContent =
        g === 'one' || g === 'few'
          ? 'the prompt · posted exactly as sent, free forever'
          : g === 'weeks'
            ? 'what you started with · optional'
            : 'the prompt you tried · optional';
      // The honesty line, phrased for the path: a one-go build hasn't
      // "broken" anywhere yet, but something always still bugs its maker.
      brokeLabel.textContent =
        g === 'weeks'
          ? 'where did it fight you most? · one line'
          : g === 'never'
            ? 'where did it die? · one line'
            : 'what broke, or still bugs you? · one line';
      if (linkHint) {
        linkHint.textContent =
          g === 'never'
            ? 'optional for builds that never got there'
            : 'one of the two at minimum, ideally both';
      }
    };
    $$('[data-bd-goes] .bp-chip').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.goes = btn.dataset.goes;
        syncGoes();
        saveDraft();
      })
    );

    /* Connect GitHub (Google-only accounts): Better Auth's explicit link
       flow, same redirect dance as sign-in. */
    $('[data-bd-linkgh]')?.addEventListener('click', async () => {
      try {
        const res = await jsonPost('/api/auth/link-social', 'POST', {
          provider: 'github',
          callbackURL: '/post-a-build',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error();
        window.location.href = data.url;
      } catch {
        toast('could not start the GitHub connect · try again');
      }
    });

    /* Screenshots: upload on choose OR drop. Signed in, they upload right
       away; signed out they stash locally (thumb included) and upload
       after the OAuth round trip. */
    const fileInput = $('#bp-files');
    const dropZone = $('.bp-drop');
    const shotCount = () => state.media.length + state.pendingFiles.length;
    const syncDropline = () => {
      const line = $('[data-bd-dropline]');
      if (!line) return;
      line.textContent = shotCount()
        ? `${shotCount()} of 3 attached · tap or drop to add more`
        : 'add 1-3 screenshots of what you built';
    };
    const addThumb = (url, onRemove) => {
      const wrap = document.createElement('span');
      wrap.className = 'bp-thumb-wrap';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'bp-thumb-x';
      x.setAttribute('aria-label', 'remove this screenshot');
      x.textContent = '×';
      x.addEventListener('click', () => {
        onRemove();
        wrap.remove();
        syncDropline();
        saveDraft();
      });
      wrap.append(img, x);
      $('[data-bd-thumbs]').appendChild(wrap);
    };
    const uploadFiles = async (fileList) => {
      const files = [...fileList]
        .filter((f) => (f.type || '').startsWith('image/'))
        .slice(0, 3 - shotCount());
      for (const file of files) {
        if (!signedIn) {
          // No session yet: keep the file locally, preview it, upload later.
          state.pendingFiles.push(file);
          addThumb(URL.createObjectURL(file), () => {
            state.pendingFiles = state.pendingFiles.filter((f) => f !== file);
            stashFiles();
          });
          continue;
        }
        const fd = new FormData();
        fd.append('file', file);
        try {
          const res = await fetch('/api/build/media', { method: 'POST', body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'upload failed');
          const entry = { id: data.id, url: data.url };
          state.media.push(entry);
          addThumb(data.url, () => {
            // Detach only: the orphaned upload never gets claimed by a build.
            state.media = state.media.filter((m) => m.id !== entry.id);
          });
        } catch (err) {
          toast(err.message || 'upload failed');
        }
      }
      if (!signedIn) await stashFiles();
      syncDropline();
      saveDraft();
    };
    fileInput?.addEventListener('change', async () => {
      await uploadFiles(fileInput.files);
      fileInput.value = '';
    });
    if (dropZone) {
      for (const ev of ['dragenter', 'dragover']) {
        dropZone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropZone.classList.add('dragging');
        });
      }
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragging');
        if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
      });
    }

    /* The post itself. */
    const form = $('#bp-form');
    const postError = $('[data-bd-post-error]');
    const fail = (msg) => {
      postError.textContent = msg;
      postError.hidden = false;
      $('#bp-go').disabled = false;
    };
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!signedIn) return; // the submit button carries data-signin; app.js opens the modal
      postError.hidden = true;
      const payload = {
        name: form.elements.name.value,
        one_liner: form.elements.one_liner.value,
        goes: state.goes,
        prompt: form.elements.prompt.value,
        story: form.elements.story.value,
        where_broke: form.elements.where_broke.value,
        tool: form.elements.tool.value,
        model: form.elements.model.value,
        chat_url: form.elements.chat_url.value,
        demo_url: form.elements.demo_url.value,
        repo_url: form.elements.repo_url.value,
        affiliation: form.elements.affiliation.value,
        slug: state.app?.slug,
        media: state.media.map((m) => m.id),
        website: form.elements.website.value,
      };
      if (payload.name.trim().length < 2) return fail('give the build a name.');
      if (payload.one_liner.trim().length < 5) return fail('one line on what it does.');
      if (!state.goes) return fail('how many goes did it take?');
      if ((state.goes === 'one' || state.goes === 'few') && payload.prompt.trim().length < 10) {
        return fail("paste the prompt, exactly as sent · it's the whole point.");
      }
      if (state.goes === 'weeks' && payload.story.trim().length < 10) {
        return fail('say what actually got it done.');
      }
      if (payload.where_broke.trim().length < 3) {
        return fail('one line on where it broke · "nowhere yet" counts.');
      }
      if (!payload.tool.trim()) return fail('name the tool you built it with.');
      const handleInput = $('#bp-handle');
      if (handleInput) {
        payload.handle = handleInput.value.trim();
        if (!/^[a-z0-9][a-z0-9_-]{2,19}$/i.test(payload.handle)) {
          return fail('pick a handle: 3-20 letters, numbers, dashes.');
        }
      }
      if (state.goes !== 'never' && !payload.demo_url.trim() && !payload.repo_url.trim()) {
        return fail('a build needs a live demo or a public repo, ideally both.');
      }
      if (!state.media.length) return fail('add at least one screenshot of the thing you built.');
      $('#bp-go').disabled = true;
      try {
        const res = await jsonPost('/api/build', 'POST', payload);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return fail(data.error || 'something went sideways · try again in a minute.');
        track('build_post', { goes: state.goes, app: payload.slug });
        await clearDraft();
        window.location.href = data.url;
      } catch {
        fail('could not reach the server · try again in a minute.');
      }
    });

    /* Every keystroke keeps the draft current (cheap: one JSON stringify). */
    form?.addEventListener('input', saveDraft);

    /* Prefill from the query string (?app=…). */
    const preApp = wrap.dataset.preselectApp;
    if (preApp) {
      const a = catalog.find((x) => x.slug === preApp);
      if (a) search.set(a);
    }

    /* Restore a draft left by the sign-in round trip (or a stray reload).
       Runs after the ?app= prefill so the draft, being newer intent, wins. */
    try {
      const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
      if (d) {
        for (const f of DRAFT_FIELDS) {
          if (form?.elements[f] && typeof d[f] === 'string') form.elements[f].value = d[f];
        }
        const h = $('#bp-handle');
        if (h && typeof d.handle === 'string') h.value = d.handle;
        if (d.goes && $(`[data-bd-goes] .bp-chip[data-goes="${d.goes}"]`)) {
          state.goes = d.goes;
          syncGoes();
        }
        if (d.app) {
          const a = catalog.find((x) => x.slug === d.app);
          if (a) search.set(a);
        }
        if (signedIn && Array.isArray(d.media)) {
          for (const m of d.media) {
            if (typeof m?.id === 'string' && typeof m?.url === 'string') {
              const entry = { id: m.id, url: m.url };
              state.media.push(entry);
              addThumb(entry.url, () => {
                state.media = state.media.filter((x) => x.id !== entry.id);
              });
            }
          }
          syncDropline();
        }
      }
    } catch {}

    /* Files stashed while signed out: upload them now if a session exists,
       otherwise re-preview them so nothing looks lost. */
    stashedFiles().then(async (files) => {
      if (!files?.length) return;
      if (signedIn) {
        await clearStash();
        await uploadFiles(files);
        if (state.media.length) toast('your screenshots came along · all attached');
      } else {
        await uploadFiles(files); // signed out: re-previews and re-stashes
      }
    });
  };

  const init = () => {
    initIndex();
    initCarousel();
    initPost();
  };
  document.addEventListener('astro:page-load', init);
  init();
})();
