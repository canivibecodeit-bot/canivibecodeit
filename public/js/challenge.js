/* Challenge page behavior: the countdown tick, the entry form (fetch post,
   inline errors, redirect to the fresh permalink), report buttons, and the
   badge-embed copy. All progressive: the page reads fine without any of it. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  let toastTimer;
  const toast = (msg) => {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  };

  // astro:page-load fires on the initial load too (ClientRouter), so every
  // binding marks its element — a second init on the same DOM is a no-op.
  const claim = (el) => {
    if (!el || el.dataset.chBound) return null;
    el.dataset.chBound = '1';
    return el;
  };

  const init = () => {
    /* ---------- countdown ---------- */
    const cd = claim($('[data-countdown]'));
    if (cd && cd.dataset.state !== 'closed') {
      const target = Number(cd.dataset.target);
      const tick = () => {
        const s = Math.max(0, Math.floor((target - Date.now()) / 1000));
        const d = $('[data-cd-days]', cd);
        const h = $('[data-cd-hours]', cd);
        const m = $('[data-cd-mins]', cd);
        if (d) d.textContent = Math.floor(s / 86400);
        if (h) h.textContent = Math.floor((s % 86400) / 3600);
        if (m) m.textContent = Math.floor((s % 3600) / 60);
        // The moment passes: a reload flips the page to its next state
        // (open form appears, or the gallery closes). One reload, not a loop.
        if (s === 0 && !cd.dataset.done) {
          cd.dataset.done = '1';
          setTimeout(() => location.reload(), 1500);
        }
      };
      tick();
      setInterval(tick, 30000);
    }

    /* ---------- email opt-in reveal ---------- */
    const emailToggle = claim($('[data-email-toggle]'));
    if (emailToggle) {
      const input = $('.ch-email-input');
      emailToggle.addEventListener('change', () => {
        input.hidden = !emailToggle.checked;
        if (emailToggle.checked) input.focus();
        else input.value = '';
      });
    }

    /* ---------- entry form ---------- */
    const form = claim($('[data-challenge-form]'));
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('button[type="submit"]', form);
        const err = $('[data-form-err]', form);
        err.hidden = true;
        btn.disabled = true;
        btn.textContent = 'entering…';
        try {
          const data = Object.fromEntries(new FormData(form).entries());
          const res = await fetch(form.action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const out = await res.json().catch(() => ({}));
          if (!res.ok) {
            err.textContent = out.error || 'something broke — try again';
            err.hidden = false;
            return;
          }
          if (out.held) {
            toast(out.message || 'entry received · pending a quick look');
            form.reset();
            return;
          }
          toast(out.existing ? 'already in — here it is' : 'you are in 🎉');
          location.href = out.url || '/challenge';
        } catch {
          err.textContent = 'network hiccup — try again';
          err.hidden = false;
        } finally {
          btn.disabled = false;
          btn.textContent = 'enter the challenge';
        }
      });
    }

    /* ---------- report buttons ---------- */
    $$('[data-report]').forEach((raw) => {
      const btn = claim(raw);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await fetch('/api/challenge/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: btn.dataset.report }),
          });
        } catch {
          /* the count is best-effort from the reporter's side */
        }
        btn.textContent = 'reported ✓';
        toast('reported · a human will look');
      });
    });

    /* ---------- badge embed copy ---------- */
    const copy = claim($('[data-copy-embed]'));
    if (copy) {
      copy.addEventListener('click', async () => {
        const code = $('[data-embed]');
        try {
          await navigator.clipboard.writeText(code.textContent);
          copy.textContent = 'copied ✓';
          setTimeout(() => (copy.textContent = 'copy'), 2000);
        } catch {
          toast('copy failed — select it by hand');
        }
      });
    }
  };

  // ClientRouter soft-navigations re-run pages without a fresh script load.
  init();
  document.addEventListener('astro:page-load', init);
})();
