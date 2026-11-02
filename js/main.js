(() => {
  document.documentElement.classList.add('js');
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Kopfzeile
  const hdr = $('.hdr');
  const onScroll = () => hdr.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Mobiles Menü
  const burger = $('.burger'), mnav = $('.mnav');
  const setMenu = (open) => { mnav.hidden = !open; burger.setAttribute('aria-expanded', String(open)); };
  burger.addEventListener('click', () => setMenu(mnav.hidden));
  $$('a', mnav).forEach((a) => a.addEventListener('click', () => setMenu(false)));

  // Einblenden
  const obs = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); obs.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  $$('.feat, .trust__grid, .privacy__grid, .avail, .faq__list').forEach((g) =>
    $$('.reveal', g).forEach((el, i) => el.style.setProperty('--d', Math.min(i * 0.06, 0.45) + 's')));
  $$('.reveal').forEach((el) => obs.observe(el));

  // Zähler
  const fmt = (n) => n.toLocaleString('de-CH').replace(/[,.  ]/g, '’');
  const cObs = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    cObs.unobserve(e.target);
    const el = e.target, to = +el.dataset.count;
    if (reduced) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min((t - t0) / 1300, 1), v = Math.round(to * (1 - Math.pow(1 - p, 3)));
      el.textContent = fmt(v);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  $$('[data-count]').forEach((el) => cObs.observe(el));

  // Schritte mit Panels
  const steps = $$('.step'), panels = $$('.panel');
  let idx = 0, timer;
  const show = (i) => {
    idx = (i + steps.length) % steps.length;
    steps.forEach((s, k) => { s.classList.toggle('is-on', k === idx); s.setAttribute('aria-selected', String(k === idx)); });
    panels.forEach((p, k) => p.classList.toggle('is-on', k === idx));
  };
  const auto = () => { clearInterval(timer); if (!reduced) timer = setInterval(() => show(idx + 1), 6000); };
  steps.forEach((s, i) => { s.addEventListener('click', () => { show(i); auto(); }); s.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(i); auto(); } }); });
  const stage = $('.steps');
  stage.addEventListener('mouseenter', () => clearInterval(timer));
  stage.addEventListener('mouseleave', auto);
  new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting ? auto() : clearInterval(timer))).observe(stage);

  // Lightbox
  const lb = $('#lb'), lbImg = $('img', lb);
  const open = (src) => { lbImg.src = src; lb.hidden = false; document.body.style.overflow = 'hidden'; };
  const close = () => { lb.hidden = true; document.body.style.overflow = ''; };
  document.addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]');
    if (z) { open(z.dataset.zoom); return; }
    if (!lb.hidden && (e.target === lb || e.target.closest('.lb__close') || e.target === lbImg)) close();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lb.hidden) close(); });

  $('#year').textContent = new Date().getFullYear();
})();
