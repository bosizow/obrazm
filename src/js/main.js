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