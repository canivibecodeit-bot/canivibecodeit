/* Sponsor icon upload block, shared by both post-checkout details pages.
   External file so the CSP script allowlist stays hash-free. Everything it
   needs rides on the block's data attributes:
     data-endpoint  POST target (multipart: token, file | action=revert)
     data-token     the page's details token
     data-default   the favicon-derived default, shown after a revert
     data-targets   optional selector of other <img>s to keep in sync
     data-hidden    optional selector of a hidden input that carries the
                    hosted URL into the page's own save (sponsor page) */
(() => {
  const MAX = 2 * 1024 * 1024;
  document.querySelectorAll('[data-icon-upload]').forEach((box) => {
    const { endpoint, token } = box.dataset;
    const fallback = box.dataset.default || '';
    const input = box.querySelector('input[type=file]');
    const img = box.querySelector('[data-icon-preview]');
    const msg = box.querySelector('[data-icon-msg]');
    const state = box.querySelector('[data-icon-state]');
    const revertBtn = box.querySelector('[data-icon-revert]');
    const targets = box.dataset.targets ? document.querySelectorAll(box.dataset.targets) : [];
    const hidden = box.dataset.hidden ? document.querySelector(box.dataset.hidden) : null;
    if (!input || !img) return;

    const say = (text, bad) => {
      msg.textContent = text;
      msg.classList.toggle('bad', !!bad);
    };
    const show = (url) => {
      const src = url || fallback;
      img.src = src;
      img.hidden = !src;
      targets.forEach((t) => {
        t.src = src;
      });
      if (hidden) hidden.value = url || '';
      if (state) state.textContent = url ? 'uploaded icon' : 'site favicon';
      revertBtn?.classList.toggle('is-off', !url);
    };

    const post = async (fd) => {
      fd.append('token', token);
      box.classList.add('busy');
      try {
        const res = await fetch(endpoint, { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          say(data.error || 'something broke, try again', true);
          return null;
        }
        return data;
      } catch {
        say('network hiccup, try again', true);
        return null;
      } finally {
        box.classList.remove('busy');
      }
    };

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const before = img.src;
      if (file.size > MAX) {
        say('that file is over 2MB', true);
        input.value = '';
        return;
      }
      // Local preview straight away; the server's copy replaces it on success.
      const reader = new FileReader();
      reader.onload = () => {
        img.src = String(reader.result);
        img.hidden = false;
      };
      reader.readAsDataURL(file);
      say('uploading');
      const fd = new FormData();
      fd.append('file', file, 'icon');
      const data = await post(fd);
      input.value = '';
      if (data) {
        show(data.icon_url);
        say('icon updated, this is what the card shows now');
      } else {
        img.src = before;
      }
    });

    revertBtn?.addEventListener('click', async () => {
      const fd = new FormData();
      fd.append('action', 'revert');
      say('reverting');
      const data = await post(fd);
      if (data) {
        show(data.icon_url);
        say('back to the site favicon');
      }
    });
  });
})();
