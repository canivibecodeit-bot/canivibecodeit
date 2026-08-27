/* The Build Games: the pot fills, the figure counts, the clock ticks. All
   progressive — the page reads fine server-rendered without any of it.
   Follows the same ClientRouter contract as the other page scripts. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const claim = (el) => {
    if (!el || el.dataset.bgBound) return null;
    el.dataset.bgBound = '1';
    return el;
  };

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fmtUsd = (cents) => '$' + Math.round(cents / 100).toLocaleString('en-US');

  const init = () => {
    /* ---------- countdown (seconds, tabular, no jitter) ---------- */
    const cd = claim($('[data-countdown]'));
    if (cd) {
      const target = Number(cd.dataset.target);
      const d = $('[data-cd-days]', cd);
      const h = $('[data-cd-hours]', cd);
      const m = $('[data-cd-mins]', cd);
      const sec = $('[data-cd-secs]', cd);
      const tick = () => {
        const s = Math.max(0, Math.floor((target - Date.now()) / 1000));
        if (d) d.textContent = Math.floor(s / 86400);
        if (h) h.textContent = Math.floor((s % 86400) / 3600);
        if (m) m.textContent = Math.floor((s % 3600) / 60);
        if (sec) sec.textContent = s % 60;
        if (s === 0 && !cd.dataset.done) {
          cd.dataset.done = '1';
          setTimeout(() => location.reload(), 1500);
        }
      };
      tick();
      setInterval(tick, 1000);
    }

    /* ---------- the pot: count-up on load, fill + drops on increase ---------- */
    const stage = claim($('[data-pot]'));
    if (stage) {
      const amountEl = $('[data-pot-amount]');
      const fillEls = [$('.bg-fill'), $('.bg-fill-top')].filter(Boolean);
      const drops = $('.bg-drops', stage);
      const goal = Number(stage.dataset.goal) || 1;
      let potCents = Number(stage.dataset.potCents) || 0;

      const setFill = (frac) => {
        const f = Math.max(0, Math.min(1, frac));
        stage.style.setProperty('--fill', f.toFixed(4));
        fillEls.forEach((el) => el.style.setProperty('--fill', f.toFixed(4)));
      };
      // Server rendered the fill inline; mirror it onto the scaling elements.
      setFill(Number(stage.dataset.fill) || 0);

      // Count the hero figure up from zero on first load.
      if (amountEl && !reduced()) {
        const t0 = performance.now();
        const DUR = 1100;
        const from = 0;
        const step = (t) => {
          const p = Math.min(1, (t - t0) / DUR);
          const eased = 1 - Math.pow(1 - p, 3);
          amountEl.textContent = fmtUsd(from + (potCents - from) * eased);
          if (p < 1) requestAnimationFrame(step);
          else amountEl.textContent = fmtUsd(potCents);
        };
        // start the fill from empty too, so it visibly rises on load
        setFill(0);
        requestAnimationFrame(() => setFill(potCents / goal));
        requestAnimationFrame(step);
      }

      const rain = (n) => {
        if (!drops || reduced()) return;
        for (let i = 0; i < n; i += 1) {
          const bill = document.createElement('span');
          bill.className = 'bg-drop';
          bill.style.left = 20 + Math.random() * 60 + '%';
          bill.style.animationDelay = Math.random() * 200 + 'ms';
          drops.appendChild(bill);
          setTimeout(() => bill.remove(), 1000);
        }
      };

      // Poll: when the pot grows, raise the fill, count the figure up, rain bills.
      setInterval(async () => {
        if (document.hidden || !document.contains(stage)) return;
        try {
          const res = await fetch('/api/thebuildgames/stats');
          if (!res.ok) return;
          const data = await res.json();
          if (typeof data.pot_cents !== 'number' || data.pot_cents === potCents) return;
          const grew = data.pot_cents > potCents;
          const from = potCents;
          potCents = data.pot_cents;
          setFill(typeof data.fill === 'number' ? data.fill : potCents / goal);
          if (amountEl && !reduced()) {
            const t0 = performance.now();
            const DUR = 700;
            const step = (t) => {
              const p = Math.min(1, (t - t0) / DUR);
              const eased = 1 - Math.pow(1 - p, 3);
              amountEl.textContent = fmtUsd(from + (potCents - from) * eased);
              if (p < 1) requestAnimationFrame(step);
              else amountEl.textContent = fmtUsd(potCents);
            };
            requestAnimationFrame(step);
          } else if (amountEl) {
            amountEl.textContent = fmtUsd(potCents);
          }
          if (grew) rain(6);
        } catch {
          /* next poll gets another chance */
        }
      }, 30000);
    }
  };

  init();
  document.addEventListener('astro:page-load', init);
})();
