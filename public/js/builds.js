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
      media: [],
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

    /* Screenshots: upload on choose OR drop, keep the ids for the post. */
    const fileInput = $('#bp-files');
    const dropZone = $('.bp-drop');
    const syncDropline = () => {
      const line = $('[data-bd-dropline]');
      if (!line) return;
      line.textContent = state.media.length
        ? `${state.media.length} of 3 attached · tap or drop to add more`
        : 'add 1-3 screenshots of what you built';
    };
    const uploadFiles = async (fileList) => {
      const thumbs = $('[data-bd-thumbs]');
      const files = [...fileList]
        .filter((f) => (f.type || '').startsWith('image/'))
        .slice(0, 3 - state.media.length);
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        try {
          const res = await fetch('/api/build/media', { method: 'POST', body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'upload failed');
          state.media.push(data.id);
          const wrap = document.createElement('span');
          wrap.className = 'bp-thumb-wrap';
          const img = document.createElement('img');
          img.src = data.url;
          img.alt = '';
          const x = document.createElement('button');
          x.type = 'button';
          x.className = 'bp-thumb-x';
          x.setAttribute('aria-label', 'remove this screenshot');
          x.textContent = '×';
          x.addEventListener('click', () => {
            // Detach only: the orphaned upload never gets claimed by a build.
            state.media = state.media.filter((m) => m !== data.id);
            wrap.remove();
            syncDropline();
          });
          wrap.append(img, x);
          thumbs.appendChild(wrap);
        } catch (err) {
          toast(err.message || 'upload failed');
        }
      }
      syncDropline();
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
        media: state.media,
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
        window.location.href = data.url;
      } catch {
        fail('could not reach the server · try again in a minute.');
      }
    });

    /* Prefill from the query string (?app=…). */
    const preApp = wrap.dataset.preselectApp;
    if (preApp) {
      const a = catalog.find((x) => x.slug === preApp);
      if (a) search.set(a);
    }
  };

  const init = () => {
    initIndex();
    initPost();
  };
  document.addEventListener('astro:page-load', init);
  init();
})();
