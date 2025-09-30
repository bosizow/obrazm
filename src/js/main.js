// Главный фронтовой скрипт проекта.
// Архитектура: независимые IIFE-модули + общие хелперы.
// Некритичные фичи — с graceful fallback (reduced motion, отсутствие библиотек и т.д.).

(function () {
  'use strict';

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const raf = (fn) => (window.requestAnimationFrame || setTimeout)(fn, 0);
  const bool = (v) => v === true;

  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const headerOffset = () => {
    const header = $('.site-header') || $('header') || $('.uk-navbar-container');
    return header ? header.getBoundingClientRect().height : 0;
  };

  // Плавный скролл до элемента (нативный API)
  const smoothScrollTo = (el, offset = 0, duration = 600) => {
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.pageYOffset - offset;
    // На сильно слабых девайсах можно убрать smooth
    window.scrollTo({ top: y, behavior: (prefersReducedMotion() ? 'auto' : 'smooth') });
  };

  // ---------- 1) Якоря (нативно) ----------
  // main.js (после DOM)
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      const href = a.getAttribute('href');
      if (!href || href === '#') return;           // пропускаем пустой якорь
      const idRaw = href.slice(1);                 // "id"
      const target = document.getElementById(decodeURIComponent(idRaw))
        || document.querySelector(href); // про запас

      if (!target) a.setAttribute('href', `/#${idRaw}`); // переписываем на /#id
    });
  });

  // ---------- 2) Мобильный offcanvas (UIKit) ----------
  (function offcanvasAutoClose() {
    const off = document.getElementById('mobile-offcanvas');
    if (!off || typeof UIkit === 'undefined' || typeof UIkit.offcanvas !== 'function') return;

    const api = UIkit.offcanvas(off);
    // Делегирование: закрываем по клику на "обычные" ссылки
    on(off, 'click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;

      // Не закрываем родительские пункты меню/раскрывашки и явно помеченные ссылки
      if (a.closest('.uk-parent') || a.hasAttribute('data-no-close')) return;

      api.hide();
    }, { passive: true });

    // Якорные ссылки дополнительно
    $$('#mobile-offcanvas a.js-anchor').forEach((a) => on(a, 'click', () => api.hide(), { passive: true }));

    // При переходе на десктоп — закрыть
    const mq = window.matchMedia('(min-width: 768px)');
    mq.addEventListener?.('change', (ev) => { if (ev.matches) api.hide(); });

    // На случай если Esc не перехвачен UIKit (обычно не нужен)
    on(document, 'keydown', (e) => { if (e.key === 'Escape') api.hide(); });
  })();

  // ---------- 3) Навигация в offcanvas: клики по родителям ----------
  (function navParentUX() {
    const nav = $('#mobile-offcanvas .uk-nav');
    if (!nav) return;
    nav.querySelectorAll('.uk-parent > a').forEach((link) => {
      on(link, 'click', (e) => {
        // Если у родителя href="#", блокируем переход и даём UIkit раскрыть подпункты
        if (link.getAttribute('href') === '#') e.preventDefault();
      }, { passive: false });
    });
  })();

  // ---------- 4) Видеогерой: play/pause по видимости / фокусу ----------
  (function heroVideoAutoPause() {
    const v = $('.hero--video');
    if (!v) return;

    let inView = true;
    let pageVisible = document.visibilityState === 'visible';
    let windowFocused = document.hasFocus();

    const shouldPlay = () => inView && pageVisible && windowFocused && !prefersReducedMotion();

    const applyPlayback = () => {
      if (shouldPlay()) v.play().catch(() => { /* ignore autoplay errors */ });
      else v.pause();
    };

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(([e]) => {
        inView = e.isIntersecting && e.intersectionRatio >= 0.25;
        applyPlayback();
      }, { threshold: [0, 0.25, 1] });
      io.observe(v);
    }

    on(document, 'visibilitychange', () => {
      pageVisible = document.visibilityState === 'visible';
      applyPlayback();
    });

    on(window, 'focus', () => { windowFocused = true; applyPlayback(); });
    on(window, 'blur', () => { windowFocused = false; applyPlayback(); });

    on(window, 'pagehide', () => { pageVisible = false; v.pause(); });
    on(window, 'pageshow', () => { pageVisible = true; applyPlayback(); });

    applyPlayback();
  })();

  // ---------- 5) Locomotive Scroll (если доступен) ----------
  (function locomotiveInit() {
    const container = document.querySelector('[data-scroll-container]');
    const reduce = prefersReducedMotion();
    const hasLib = (typeof LocomotiveScroll !== 'undefined');

    // Фолбэк: нативный скролл + корректные якоря
    const fallbackAnchors = () => {
      $$('a[href^="#"]').forEach((a) => {
        on(a, 'click', (e) => {
          const id = a.getAttribute('href');
          const target = id && document.querySelector(id);
          if (!target) return;
          e.preventDefault();
          smoothScrollTo(target, headerOffset(), 600);
          history.pushState(null, '', id);
        }, { passive: false });
      });
      if (location.hash) raf(() => {
        const t = document.querySelector(location.hash);
        if (t) smoothScrollTo(t, headerOffset(), 0);
      });
    };

    // Если нет контейнера/библиотеки или включено reduced motion — делаем фолбэк
    if (!container || !hasLib || reduce) {
      fallbackAnchors();
      return;
    }

    const scroll = new LocomotiveScroll({
      el: container,
      smooth: true,
      lerp: 0.08,
      multiplier: 1,
      smartphone: { smooth: false },
      tablet: { smooth: true, breakpoint: 1024 }
    });

    // Обновление размеров после загрузки ассетов
    on(window, 'load', () => scroll.update());

    // Якоря через API Locomotive
    $$('a[href^="#"]').forEach((a) => {
      on(a, 'click', (e) => {
        const id = a.getAttribute('href');
        if (!id || id === '#') return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        scroll.scrollTo(target, { offset: -headerOffset(), duration: 800 });
        history.pushState(null, '', id);
      }, { passive: false });
    });

    // Если пришли с хэшем — доскроллим
    if (location.hash) {
      const t = document.querySelector(location.hash);
      if (t) raf(() => scroll.scrollTo(t, { offset: -headerOffset(), duration: 0 }));
    }

    // Помогаем UIkit обновляться при прокрутке
    if (window.UIkit && typeof UIkit.update === 'function') {
      scroll.on('scroll', () => UIkit.update(null, 'resize'));
    }

    // При скрытии вкладки — останавливаем, при возвращении — стартуем
    on(document, 'visibilitychange', () => {
      if (document.hidden) {
        scroll.stop();
        $$('.hero--video').forEach((v) => v.pause?.());
      } else {
        scroll.start();
        $$('.hero--video').forEach((v) => v.play?.().catch(() => { }));
      }
    });
  })();

  // ---------- 6) Mux HLS для .hero--video (если используется data-mux-playback-id) ----------
  (function muxHls() {
    const v = $('.hero--video');
    if (!v) return;

    const pid = v.dataset.muxPlaybackId;
    if (!pid) return;

    const hlsSrc = `https://stream.mux.com/${pid}.m3u8`;

    // Safari умеет 'application/vnd.apple.mpegurl' нативно; остальные — через Hls.js
    const natively = !!v.canPlayType && v.canPlayType('application/vnd.apple.mpegurl');
    if (!natively && window.Hls && typeof Hls === 'function') {
      const hls = new Hls({ maxBufferLength: 10 });
      hls.loadSource(hlsSrc);
      hls.attachMedia(v);
    } else {
      // Для Safari достаточно <source> в HTML, но можно подстраховаться:
      if (!v.querySelector('source')) {
        const src = document.createElement('source');
        src.src = hlsSrc;
        src.type = 'application/vnd.apple.mpegurl';
        v.appendChild(src);
      }
    }

    // Лёгкая безопасность на видимости вкладки
    on(document, 'visibilitychange', () => {
      if (document.hidden) v.pause();
      else v.play().catch(() => { });
    });
  })();

})();