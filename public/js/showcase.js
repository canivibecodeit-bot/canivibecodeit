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
      const play = () => {
        stopOthers();
        video.controls = true;
        video.play().catch(() => {});
      };
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
