/* Model showcase: demo clips play on tap, one at a time, never all at once.
   Same ClientRouter contract as the other page scripts. */
(() => {
  const init = () => {
    document.querySelectorAll('[data-dc-video]').forEach((video) => {
      if (video.dataset.bound) return;
      video.dataset.bound = '1';
      const card = video.closest('.dc');
      const btn = card?.querySelector('[data-dc-play]');
      if (!btn) return; // gifs loop on their own
      const stopOthers = () => {
        document.querySelectorAll('[data-dc-video]').forEach((v) => {
          if (v !== video && !v.loop && !v.paused) v.pause();
        });
      };
      /* A video that cannot play (decode error, network abort, a play()
         rejection) is not a dead button: the card degrades to its post link,
         poster kept, the play affordance swapped for 'watch on X'. */
      const broken = () => {
        if (card.classList.contains('broken')) return;
        card.classList.add('broken');
        card.classList.remove('playing');
        btn.hidden = true;
        const watch = card.querySelector('[data-dc-watch]');
        if (watch) watch.hidden = false;
      };
      video.addEventListener('error', broken);
      let started = false;
      const play = () => {
        stopOthers();
        video.controls = true;
        started = true;
        video.play().catch(broken);
      };
      video.addEventListener('abort', () => {
        if (started) broken();
      });
      btn.addEventListener('click', play);
      video.addEventListener('play', () => card.classList.add('playing'));
      video.addEventListener('pause', () => card.classList.remove('playing'));
      video.addEventListener('ended', () => {
        card.classList.remove('playing');
        video.controls = false;
      });
    });
  };
  init();
  document.addEventListener('astro:page-load', init);
})();
