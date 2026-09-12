/* /moats/abc: the drawer under a tapped tile, voting, the suggest form and
   the screening poll. Everything renders from the JSON the page ships in
   #abc-data and from API replies; all text lands via textContent, never
   innerHTML. Voting and drawers work signed out; suggesting needs a
   session (the page says so and opens the sign-in modal). */
(() => {
  const POLL_MS = 10000;
  const POLL_MAX = 9; // 90 seconds
  const REOPEN_KEY = 'abc_reopen';

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const init = () => {
    const root = document.querySelector('[data-abc]');
    if (!root || root.dataset.abcReady) return;
    root.dataset.abcReady = '1';

    const dataEl = document.getElementById('abc-data');
    let state;
    try {
      state = JSON.parse(dataEl.textContent);
    } catch {
      return;
    }
    const byLetter = new Map(state.letters.map((l) => [l.letter, l]));
    const grid = root.querySelector('[data-abc-grid]');
    const drawer = root.querySelector('[data-abc-drawer]');
    const meta = root.querySelector('[data-abc-meta]');
    const signinProxy = root.querySelector('[data-signin]');
    let openLetter = null;
    let formOpen = false;
    let formError = '';
    let busy = false;
    const polls = new Map();

    const live = (L) => L.words.filter((w) => w.status === 'live').sort((a, b) => b.votes - a.votes || a.id - b.id);

    /* ---------- tiles ---------- */
    const pill = (w) => {
      const b = el('button', 'abc-pill' + (w.voted ? ' voted' : ''));
      b.type = 'button';
      b.dataset.abcVote = String(w.id);
      b.setAttribute('aria-pressed', w.voted ? 'true' : 'false');
      b.setAttribute('aria-label', `upvote ${w.word}`);
      b.append('▲ ');
      const c = el('span', null, String(w.votes));
      c.dataset.abcCount = String(w.id);
      b.append(c);
      return b;
    };

    const renderTile = (L) => {
      const tile = grid.querySelector(`.abc-tile[data-letter="${L.letter}"]`);
      if (!tile) return;
      const words = live(L);
      const top = words[0] ?? null;
      tile.classList.toggle('ghost', !top);
      tile.replaceChildren();
      if (top) {
        const head = el('div', 'abc-tile-top');
        head.append(el('span', 'abc-letter', L.letter));
        if (words.length > 1) head.append(el('span', 'abc-extra', `+${words.length - 1}`));
        const bot = el('div', 'abc-tile-bot');
        bot.append(el('span', 'abc-word', top.word), pill(top));
        tile.append(head, bot);
        tile.setAttribute('aria-label', `${L.letter}: ${top.word}, ${words.length} ${words.length === 1 ? 'word' : 'words'}`);
      } else {
        tile.append(el('span', 'abc-letter', L.letter));
        const bot = el('div', 'abc-tile-bot');
        const hint = el('span', 'abc-suggest-hint');
        hint.append(el('span', 'long', 'suggest a word'), el('span', 'short', 'suggest'), ' →');
        bot.append(el('span', 'abc-q', '?'), hint);
        tile.append(bot);
        tile.setAttribute('aria-label', `${L.letter}: open, suggest a word`);
      }
    };

    const renderMeta = () => {
      if (!meta) return;
      let filled = 0;
      let votes = 0;
      for (const L of state.letters) {
        const words = live(L);
        if (words.length) filled++;
        for (const w of words) votes += w.votes;
      }
      meta.textContent = `${filled} of 26 letters · ${votes} ${votes === 1 ? 'vote' : 'votes'}`;
    };

    /* ---------- drawer ---------- */
    const leftLine = () =>
      state.left == null ? '' : `${state.left} of ${state.dailyMax} left today`;

    const wordRow = (w) => {
      const row = el('div', 'abc-row' + (w.status !== 'live' ? ` ${w.status}` : ''));
      const text = el('div', 'abc-row-text');
      const name = el('span', 'abc-row-word');
      if (w.status === 'pending') name.append(el('i', 'abc-dot'));
      name.append(w.word);
      text.append(name);
      if (w.why) text.append(el('span', 'abc-row-why', w.why));
      row.append(text);
      if (w.status === 'live') row.append(pill(w));
      else if (w.status === 'pending') row.append(el('span', 'abc-row-state', w.stale ? 'still screening' : 'screening · under a minute'));
      else row.append(el('span', 'abc-row-state muted', 'not this one'));
      return row;
    };

    const form = (L) => {
      const f = el('form', 'abc-form');
      f.dataset.abcForm = L.letter;
      f.noValidate = true;
      const field = (name, max, placeholder, required) => {
        const lab = el('label', 'abc-input');
        const inp = el('input');
        inp.name = name;
        inp.type = 'text';
        inp.maxLength = max;
        inp.placeholder = placeholder;
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        if (required) inp.required = true;
        inp.setAttribute('aria-label', placeholder);
        const counter = el('span', 'abc-counter', `0/${max}`);
        inp.addEventListener('input', () => {
          counter.textContent = `${inp.value.length}/${max}`;
        });
        lab.append(inp, counter);
        return lab;
      };
      f.append(field('word', state.wordMax, `your word for ${L.letter}`, true), field('why', state.whyMax, 'why, optional', false));
      // Honeypot: off-screen, never filled by a person.
      const hp = el('input', 'abc-hp');
      hp.name = 'website';
      hp.tabIndex = -1;
      hp.autocomplete = 'off';
      hp.setAttribute('aria-hidden', 'true');
      f.append(hp);
      const submit = el('button', 'abc-submit', 'suggest');
      submit.type = 'submit';
      f.append(submit);
      return f;
    };

    const renderDrawer = () => {
      const L = openLetter && byLetter.get(openLetter);
      if (!L) return;
      drawer.replaceChildren();
      const visible = L.words.filter((w) => w.status !== 'rejected' || w.mine);
      const liveWords = live(L);
      const head = el('div', 'abc-drawer-head');
      const n = liveWords.length;
      head.append(el('span', 'abc-drawer-title', `${L.letter} · ${n === 0 ? 'no words yet' : `${n} ${n === 1 ? 'word' : 'words'}`}`));
      const close = el('button', 'abc-close', 'close ✕');
      close.type = 'button';
      close.dataset.abcClose = '';
      head.append(close);
      drawer.append(head);
      for (const w of liveWords) drawer.append(wordRow(w));
      for (const w of visible) if (w.status !== 'live') drawer.append(wordRow(w));

      const foot = el('div', 'abc-drawer-foot');
      if (!state.user) {
        const link = el('button', 'abc-link fg', 'sign in to suggest a word →');
        link.type = 'button';
        link.dataset.abcSignin = '';
        foot.append(link, el('span', 'abc-fine', 'free, github or google'));
        drawer.append(foot);
      } else if (state.left <= 0) {
        foot.append(el('span', 'abc-fine', `that’s ${state.dailyMax} for today, back tomorrow`));
        drawer.append(foot);
      } else if (formOpen || visible.length === 0) {
        drawer.append(form(L));
        const note = el('div', 'abc-form-note');
        note.append(el('span', formError ? 'abc-err' : null, formError || 'one or two words. screened before it shows.'), el('span', 'abc-fine', leftLine()));
        drawer.append(note);
      } else {
        const link = el('button', 'abc-link primary', '+ suggest another word');
        link.type = 'button';
        link.dataset.abcOpenForm = '';
        foot.append(link, el('span', 'abc-fine', leftLine()));
        drawer.append(foot);
      }
    };

    /* The drawer is one node moved under the tapped tile's row: the row is
       found from the tiles' offsets, so it is right for 6, 4 or 3 columns. */
    const placeDrawer = (tile) => {
      const tiles = [...grid.querySelectorAll('.abc-tile')];
      const idx = tiles.indexOf(tile);
      let cols = 1;
      while (cols < tiles.length && tiles[cols].offsetTop === tiles[0].offsetTop) cols++;
      const rowEnd = Math.min(idx - (idx % cols) + cols - 1, tiles.length - 1);
      tiles[rowEnd].after(drawer);
    };

    const closeDrawer = () => {
      if (!openLetter) return;
      const tile = grid.querySelector(`.abc-tile[data-letter="${openLetter}"]`);
      tile?.classList.remove('open');
      tile?.setAttribute('aria-expanded', 'false');
      openLetter = null;
      formOpen = false;
      formError = '';
      drawer.hidden = true;
    };

    const openDrawer = (letter, { focus = false } = {}) => {
      const L = byLetter.get(letter);
      if (!L) return;
      if (openLetter === letter) return closeDrawer();
      closeDrawer();
      openLetter = letter;
      const tile = grid.querySelector(`.abc-tile[data-letter="${letter}"]`);
      tile.classList.add('open');
      tile.setAttribute('aria-expanded', 'true');
      placeDrawer(tile);
      renderDrawer();
      drawer.hidden = false;
      if (focus) drawer.querySelector('input, button')?.focus();
    };

    /* ---------- voting ---------- */
    const applyVote = (id, count, voted) => {
      for (const L of state.letters) {
        const w = L.words.find((x) => x.id === id);
        if (!w) continue;
        w.votes = count;
        w.voted = voted;
        renderTile(L);
        if (openLetter === L.letter) renderDrawer();
      }
      renderMeta();
    };

    const vote = async (btn) => {
      if (busy) return;
      const id = Number(btn.dataset.abcVote);
      busy = true;
      btn.classList.add('pop');
      try {
        const res = await fetch('/api/abc/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word_id: id }),
        });
        if (!res.ok) throw new Error();
        const { count, voted } = await res.json();
        applyVote(id, count, voted);
      } catch {
        btn.classList.remove('pop');
      } finally {
        busy = false;
      }
    };

    /* ---------- suggesting ---------- */
    const poll = (id, letter) => {
      let n = 0;
      const tick = async () => {
        n++;
        try {
          const res = await fetch(`/api/abc/word/${id}`, { cache: 'no-store' });
          if (!res.ok) throw new Error();
          const w = await res.json();
          const L = byLetter.get(letter);
          const mine = L.words.find((x) => x.id === id);
          if (mine && w.status !== 'pending') {
            mine.status = w.status;
            mine.votes = w.votes;
            renderTile(L);
            renderMeta();
            if (openLetter === letter) renderDrawer();
            return;
          }
        } catch {
          // keep polling; the screener may just be slow
        }
        if (n < POLL_MAX) polls.set(id, setTimeout(tick, POLL_MS));
        else {
          const L = byLetter.get(letter);
          const mine = L.words.find((x) => x.id === id);
          if (mine && mine.status === 'pending') {
            mine.stale = true;
            if (openLetter === letter) renderDrawer();
          }
        }
      };
      polls.set(id, setTimeout(tick, POLL_MS));
    };

    const suggest = async (f) => {
      if (busy) return;
      const letter = f.dataset.abcForm;
      const L = byLetter.get(letter);
      const fd = new FormData(f);
      const word = String(fd.get('word') || '').trim();
      const why = String(fd.get('why') || '').trim();
      if (word.length < 2) {
        formError = 'a word needs at least two letters';
        renderDrawer();
        f = drawer.querySelector('form');
        f?.querySelector('input[name="word"]')?.focus();
        return;
      }
      busy = true;
      f.querySelector('button[type="submit"]').disabled = true;
      try {
        const res = await fetch('/api/abc/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ letter, word, why, website: fd.get('website') || '' }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          state.user = false;
          renderDrawer();
          signinProxy?.click();
          return;
        }
        if (!res.ok) {
          formError = body.error || 'something broke, try again';
          if (typeof body.left === 'number') state.left = body.left;
          renderDrawer();
          return;
        }
        formError = '';
        formOpen = false;
        if (typeof body.left === 'number') state.left = body.left;
        if (body.id) {
          L.words.push({ id: body.id, word: body.word, why: body.why, votes: 0, voted: false, status: 'pending', mine: true });
          poll(body.id, letter);
        }
        renderDrawer();
      } catch {
        formError = 'something broke, try again';
        renderDrawer();
      } finally {
        busy = false;
      }
    };

    /* ---------- events ---------- */
    grid.addEventListener('click', (e) => {
      const voteBtn = e.target.closest('[data-abc-vote]');
      if (voteBtn) {
        e.stopPropagation();
        vote(voteBtn);
        return;
      }
      if (e.target.closest('[data-abc-close]')) return closeDrawer();
      if (e.target.closest('[data-abc-open-form]')) {
        formOpen = true;
        renderDrawer();
        drawer.querySelector('input')?.focus();
        return;
      }
      if (e.target.closest('[data-abc-signin]')) {
        try {
          sessionStorage.setItem(REOPEN_KEY, openLetter || '');
        } catch {
          // storage may be unavailable; the modal still opens
        }
        if (signinProxy) signinProxy.click();
        else window.location.href = '/signin';
        return;
      }
      if (e.target.closest('[data-abc-drawer]')) return;
      const tile = e.target.closest('.abc-tile');
      if (tile) openDrawer(tile.dataset.letter);
    });

    grid.addEventListener('keydown', (e) => {
      const tile = e.target.closest('.abc-tile');
      if (!tile || e.target !== tile) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDrawer(tile.dataset.letter, { focus: true });
      }
    });

    grid.addEventListener('submit', (e) => {
      const f = e.target.closest('[data-abc-form]');
      if (!f) return;
      e.preventDefault();
      suggest(f);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openLetter) closeDrawer();
    });

    /* Back from sign-in: reopen the tile the visitor was on (or the one in
       the hash, for links straight to a letter). */
    let reopen = null;
    try {
      reopen = sessionStorage.getItem(REOPEN_KEY);
      sessionStorage.removeItem(REOPEN_KEY);
    } catch {
      // no storage, no reopen
    }
    const fromHash = /^#([A-Za-z])$/.exec(location.hash)?.[1]?.toUpperCase();
    const target = (reopen && state.user ? reopen : null) || fromHash;
    if (target && byLetter.has(target)) {
      openDrawer(target);
      grid.querySelector(`.abc-tile[data-letter="${target}"]`)?.scrollIntoView({ block: 'center' });
    }

    document.addEventListener(
      'astro:before-swap',
      () => {
        for (const t of polls.values()) clearTimeout(t);
        polls.clear();
      },
      { once: true }
    );
  };

  document.addEventListener('astro:page-load', init);
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
