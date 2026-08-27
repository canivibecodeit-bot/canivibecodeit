/* The Build Games: the pot fills, the figure counts, the clock ticks. All
   progressive — the page reads fine server-rendered without any of it.
   Follows the same ClientRouter contract as the other page scripts. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const claim = (el) => {
    if (!el || el.dataset.bgBound) return null;
    el.dataset.bgBound = '1';
    return el;
  };

  let toastTimer;
  const toast = (msg) => {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
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
      // The server computes the asymptotic fill level (uncapped, never 100%);
      // the JS just applies it and re-applies on poll. No goal math here.
      let potCents = Number(stage.dataset.potCents) || 0;
      let fillTarget = Number(stage.dataset.fill) || 0;

      const setFill = (frac) => {
        const f = Math.max(0, Math.min(1, frac));
        stage.style.setProperty('--fill', f.toFixed(4));
        fillEls.forEach((el) => el.style.setProperty('--fill', f.toFixed(4)));
      };
      setFill(fillTarget);

      // On first load: figure counts up from zero, fill rises from empty.
      if (amountEl && !reduced()) {
        const t0 = performance.now();
        const DUR = 1100;
        const step = (t) => {
          const p = Math.min(1, (t - t0) / DUR);
          const eased = 1 - Math.pow(1 - p, 3);
          amountEl.textContent = fmtUsd(potCents * eased);
          if (p < 1) requestAnimationFrame(step);
          else amountEl.textContent = fmtUsd(potCents);
        };
        setFill(0);
        requestAnimationFrame(() => setFill(fillTarget));
        requestAnimationFrame(step);
      }

      // Bills fall INSIDE the orb (SVG rects, clipped to the sphere) when the
      // pool grows. Animated via the Web Animations API so it works on SVG.
      const rain = (n) => {
        if (!drops || reduced()) return;
        for (let i = 0; i < n; i += 1) {
          const bill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bill.setAttribute('class', 'bg-drop');
          bill.setAttribute('x', String(120 + Math.random() * 60));
          bill.setAttribute('y', '150');
          bill.setAttribute('width', '24');
          bill.setAttribute('height', '11');
          bill.setAttribute('rx', '1.5');
          drops.appendChild(bill);
          const spin = 180 + Math.random() * 180;
          bill.animate(
            [
              { transform: 'translateY(0) rotate(0deg)', opacity: 0.95 },
              { transform: `translateY(210px) rotate(${spin}deg)`, opacity: 0 },
            ],
            { duration: 750 + Math.random() * 250, delay: i * 60, easing: 'cubic-bezier(0.4,0,0.7,1)', fill: 'forwards' }
          ).finished.then(() => bill.remove()).catch(() => bill.remove());
        }
      };

      // Poll: when the pot grows, raise the fill, count the figure up, rain bills.
      setInterval(async () => {
        if (document.hidden || !document.contains(stage)) return;
        try {
          const res = await fetch('/api/thebuildgames/stats');
          if (!res.ok) return;
          const data = await res.json();
          // Live "here right now" figure rides the same poll.
          const onlineEl = $('[data-bg-online]');
          if (onlineEl && typeof data.online === 'number') onlineEl.textContent = data.online;
          if (typeof data.pot_cents !== 'number' || data.pot_cents === potCents) return;
          const grew = data.pot_cents > potCents;
          const from = potCents;
          potCents = data.pot_cents;
          if (typeof data.fill === 'number') setFill(data.fill);
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

    /* ---------- bid form: reveal + submit ---------- */
    const bidOpen = claim($('[data-bid-open]'));
    if (bidOpen) {
      const form = $('[data-bid-form]');
      bidOpen.addEventListener('click', () => {
        if (!form) return;
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector('input[name="link"]').focus();
      });
    }
    const bidForm = claim($('[data-bid-form]'));
    if (bidForm) {
      bidForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('button[type="submit"]', bidForm);
        const err = $('[data-bid-err]', bidForm);
        err.hidden = true;
        btn.disabled = true;
        btn.textContent = 'starting checkout…';
        try {
          const fd = new FormData(bidForm);
          const amountCents = Math.round(Number(fd.get('amount_dollars')) * 100);
          const icon = fd.get('icon');
          const hasIcon = icon && typeof icon === 'object' && icon.size > 0;
          let res;
          if (hasIcon) {
            // Multipart only when there's a file to carry.
            fd.set('amount_cents', String(amountCents));
            fd.delete('amount_dollars');
            res = await fetch(bidForm.action, { method: 'POST', body: fd });
          } else {
            const data = Object.fromEntries(fd.entries());
            res = await fetch(bidForm.action, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                link: data.link,
                tagline: data.tagline,
                amount_cents: amountCents,
                email: data.email,
                email_optin: data.email_optin,
                website: data.website,
              }),
            });
          }
          const out = await res.json().catch(() => ({}));
          if (!res.ok) {
            err.textContent = out.error || 'something broke — try again';
            err.hidden = false;
            return;
          }
          if (out.url) {
            // Off to Stripe; the webhook lists the placement when payment lands.
            window.location.href = out.url;
            return;
          }
          toast(out.message || 'bid placed');
          bidForm.reset();
          bidForm.hidden = true;
        } catch {
          err.textContent = 'network hiccup — try again';
          err.hidden = false;
        } finally {
          btn.disabled = false;
          btn.textContent = 'place bid';
        }
      });
    }

    /* ---------- outbound click beacons (board rows) ---------- */
    $$('[data-bg-out]').forEach((raw) => {
      const a = claim(raw);
      if (!a) return;
      a.addEventListener('click', () => {
        try {
          navigator.sendBeacon('/api/thebuildgames/click', JSON.stringify({ id: a.dataset.bgOut }));
        } catch {
          /* the navigation always wins */
        }
      });
    });

    /* ---------- back from Stripe: say what happened, once ---------- */
    const paid = new URLSearchParams(location.search).get('paid');
    if (paid !== null && !document.body.dataset.bgPaidToast) {
      document.body.dataset.bgPaidToast = '1';
      toast(paid === '1' ? 'payment received · your placement lists in a moment' : 'checkout cancelled — nothing was charged');
      history.replaceState(null, '', location.pathname);
      if (paid === '1') setTimeout(() => location.reload(), 4000);
    }

    /* ---------- report buttons ---------- */
    $$('[data-report]').forEach((raw) => {
      const btn = claim(raw);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await fetch('/api/thebuildgames/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: btn.dataset.report }),
          });
        } catch {
          /* best effort */
        }
        btn.textContent = 'reported ✓';
        toast('reported · a human will look');
      });
    });
  };

  init();
  document.addEventListener('astro:page-load', init);
})();
