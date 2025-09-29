// Плавный скролл к якорям с учётом фиксированного хедера
(function () {
  const header = document.querySelector('.site-header');
  const headerH = () => header ? header.offsetHeight : 0;

  document.querySelectorAll('a.js-anchor[href^="#"]').forEach(a => {
    a.addEventListener('click', function (e) {
      const id = this.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;

      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.pageYOffset - (headerH() + 8);
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
})();

// Переключение родителя в offcanvas, чтобы "С чем помогаем" открывался по клику
(function () {
  const nav = document.querySelector('#mobile-offcanvas .uk-nav');
  if (!nav) return;
  // UIKit уже обрабатывает uk-nav-parent-icon, но делаем небольшой UX-твик:
  nav.querySelectorAll('.uk-parent > a').forEach(link => {
    link.addEventListener('click', e => {
      // если клик по родителю без href на отдельную страницу — просто раскрыть
      if (link.getAttribute('href') === '#') e.preventDefault();
    });
  });
})();

// Пауза воспроизведения видео при его скрытии из виду или при потере фокуса вкладки
(function () {
  const v = document.querySelector('.hero--video');
  if (!v) return;

  let inView = true;                         // видео в зоне видимости
  let pageVisible = document.visibilityState === 'visible'; // вкладка активна
  let windowFocused = document.hasFocus();   // окно в фокусе

  // Проверяем, можно ли воспроизводить видео
  function shouldPlay() {
    return inView && pageVisible && windowFocused;
  }

  // Запускаем или останавливаем видео
  function applyPlayback() {
    if (shouldPlay()) {
      v.play().catch(() => {}); // игнорируем ошибки автоплея
    } else {
      v.pause();
    }
  }

  // Следим за видимостью видео на экране
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting && e.intersectionRatio >= 0.25;
      applyPlayback();
    }, { threshold: [0, 0.25, 1] });
    io.observe(v);
  }

  // Реакция на смену вкладки
  document.addEventListener('visibilitychange', () => {
    pageVisible = document.visibilityState === 'visible';
    applyPlayback();
  });

  // Фокус окна браузера
  window.addEventListener('focus', () => { windowFocused = true; applyPlayback(); });
  window.addEventListener('blur',  () => { windowFocused = false; applyPlayback(); });

  // iOS/Safari: уход или возвращение на страницу
  window.addEventListener('pagehide', () => { pageVisible = false; v.pause(); });
  window.addEventListener('pageshow', () => { pageVisible = true; applyPlayback(); });

  // Первичная проверка при загрузке
  applyPlayback();
})();

// locomotive-scroll
(function () {
  // Не инициализируем при «предпочитаю уменьшенное движение»
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Элемент контейнера
  const container = document.querySelector('[data-scroll-container]');
  if (!container || typeof LocomotiveScroll === 'undefined' || reduceMotion) {
    // Фолбэк: нативный скролл, но починим якоря с учётом фикс-хедера
    fixAnchorLinksFallback();
    return;
  }

  // Оценка высоты фикс-хедера для якорей
  const header = document.querySelector('header, .uk-navbar-container, .site-header');
  const headerOffset = () => (header ? header.getBoundingClientRect().height : 0);

  // Инициализируем Locomotive
  const scroll = new LocomotiveScroll({
    el: container,
    smooth: true,
    lerp: 0.08,          // инерция (0..1)
    multiplier: 1,       // скорость
    smartphone: { smooth: false }, // на телефонах обычно лучше без smooth
    tablet:     { smooth: true, breakpoint: 1024 }
  });

  // Обновлять размеры после загрузки медиа/шрифтов/изображений
  window.addEventListener('load', () => scroll.update());
  // Если у вас где-то динамически появляется контент — вызывайте scroll.update()

  // Якорные ссылки: прокручиваем через API библиотеки, с учётом высоты шапки
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;

      e.preventDefault();
      scroll.scrollTo(target, { offset: -headerOffset(), duration: 800 });
      history.pushState(null, '', id); // обновим URL
    });
  });

  // Если страница загружена уже с хэшем — доскроллим корректно
  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target) {
      setTimeout(() => scroll.scrollTo(target, { offset: -headerOffset(), duration: 0 }), 0);
    }
  }

  // Хелпер на случай интеграции с UIKit Scrollspy/HeightMatch/Sticky:
  // периодически «пингуем» UIkit на пересчёт (если нужно)
  if (window.UIkit && typeof UIkit.update === 'function') {
    scroll.on('scroll', () => UIkit.update(null, 'resize'));
  }

  // Пауза анимации/видео, когда вкладка неактивна (чтобы не жрало батарейку)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      scroll.stop();
      // При желании — ставьте на паузу ваши <video> в hero
      document.querySelectorAll('.hero--video').forEach(v => v.pause && v.pause());
    } else {
      scroll.start();
      document.querySelectorAll('.hero--video').forEach(v => v.play && v.play().catch(()=>{}));
    }
  });

  // Фолбэк для якорей (если Locomotive не стартанёт)
  function fixAnchorLinksFallback() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        const y = target.getBoundingClientRect().top + window.scrollY - headerOffset();
        window.scrollTo({ top: y, behavior: 'smooth' });
        history.pushState(null, '', id);
      });
    });
  }
})();