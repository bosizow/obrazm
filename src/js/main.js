console.log('hello from main.js');

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