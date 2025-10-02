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

  // ---------- 4) Инициализация видео с надёжным фолбэком Mux HLS для .hero--video ----------
  (function () {
    const PLAYBACK_ID = 'YOUR_PLAYBACK_ID_HERE'; // ← подставь свой Playback ID из Mux
    const mount = document.getElementById('heroVideoMount');

    const muxSrc = `https://stream.mux.com/${PLAYBACK_ID}.m3u8?max_resolution=1080p&redundant_streams=true`;
    const fallbackTimeoutMs = 5000; // через сколько секунд переключаться на локальное видео, если не заиграло

    const localMarkup = `
    <video class="hero--video" autoplay muted playsinline webkit-playsinline loop preload="metadata" poster="./assets/video/hero.jpg" style="width:100%;height:100%;object-fit:cover">
      <source src="./assets/video/hero.webm" type="video/webm">
      <source src="./assets/video/hero.mp4" type="video/mp4">
      Ваш браузер не поддерживает видео.
    </video>
  `;

    function tryAutoplay(video) {
      video.muted = true; // гарантирует автоплей на мобилках
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => { });
    }

    function showLocal() {
      mount.innerHTML = localMarkup;
      const v = mount.querySelector('video');
      if (v) tryAutoplay(v);
    }

    function setupMux() {
      const v = document.createElement('video');
      v.className = 'hero--video';
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.setAttribute('muted', '');
      v.muted = true;
      v.setAttribute('loop', '');
      v.setAttribute('preload', 'metadata');
      v.setAttribute('poster', './assets/video/hero.jpg');
      v.style.width = '100%';
      v.style.height = '100%';
      v.style.objectFit = 'cover';

      mount.innerHTML = '';
      mount.appendChild(v);

      let hls = null;
      let fallbackTimer = setTimeout(() => {
        cleanup();
        showLocal();
      }, fallbackTimeoutMs);

      function cleanup() {
        clearTimeout(fallbackTimer);
        v.removeEventListener('playing', onPlaying);
        v.removeEventListener('error', onError);
        if (hls) { try { hls.destroy(); } catch (e) { } hls = null; }
      }

      function onPlaying() { cleanup(); }
      function onError() { cleanup(); showLocal(); }

      v.addEventListener('playing', onPlaying, { once: true });
      v.addEventListener('error', onError, { once: true });

      // iOS/Safari — нативный HLS
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = muxSrc;
        tryAutoplay(v);
        return;
      }

      // Другие браузеры — через hls.js
      if (window.Hls && Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: true });
        hls.on(Hls.Events.ERROR, function (_e, data) {
          if (data && data.fatal) { cleanup(); showLocal(); }
        });
        hls.loadSource(muxSrc);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, function () { tryAutoplay(v); });
        return;
      }

      // Совсем старый браузер — сразу локально
      cleanup();
      showLocal();
    }

    setupMux();
  })();

  // ---------- 5) Видео: play/pause по видимости / фокусу ----------
  (function heroVideoAutoCtrl() {
    const v = document.querySelector('.hero--video');
    if (!v) return;

    // Критично для iOS: проставить до play()
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');

    let inView = true;
    let pageVisible = document.visibilityState === 'visible';
    let windowFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

    const prefersReducedMotion = () =>
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const shouldPlay = () => inView && pageVisible && windowFocused && !prefersReducedMotion();

    const tryPlay = () => v.play().catch(() => {/* игнорируем автоплей-ошибки */ });
    const applyPlayback = () => { shouldPlay() ? tryPlay() : v.pause(); };

    // Автовоспроизведение после готовности метаданных
    v.addEventListener('loadedmetadata', applyPlayback, { once: true });

    // Наблюдаем видимость
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(([e]) => {
        inView = e.isIntersecting && e.intersectionRatio >= 0.25;
        applyPlayback();
      }, { threshold: [0, 0.25, 1] });
      io.observe(v);
    }

    // Страница/фокус
    document.addEventListener('visibilitychange', () => { pageVisible = document.visibilityState === 'visible'; applyPlayback(); });
    window.addEventListener('focus', () => { windowFocused = true; applyPlayback(); });
    window.addEventListener('blur', () => { windowFocused = false; applyPlayback(); });

    // iOS Safari «разблокировка» по первому взаимодействию с документом (не по видео)
    const unlock = () => { tryPlay(); document.removeEventListener('touchstart', unlock, true); document.removeEventListener('pointerdown', unlock, true); };
    document.addEventListener('touchstart', unlock, true);
    document.addEventListener('pointerdown', unlock, true);

    // Навигация
    window.addEventListener('pagehide', () => v.pause());
    window.addEventListener('pageshow', () => applyPlayback());

    applyPlayback();
  })();

  // ---------- 6) Locomotive Scroll (если доступен) ----------
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

})();