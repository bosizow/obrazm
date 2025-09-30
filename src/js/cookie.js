// Cookie banner: localStorage consent с TTL и безопасными проверками.
// Изменяем только visibility через [hidden], чтобы не ломать layout.

(function () {
  'use strict';

  const STORAGE_KEY = 'cookie:consent:simple:v2'; // bump версия для будущих миграций
  const DAYS_TO_LIVE = 365;                       // срок жизни согласия

  const now = () => Date.now();
  const ms = (d) => d * 24 * 60 * 60 * 1000;

  const read = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; }
    catch { return null; }
  };

  const write = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accepted: true, ts: now() }));
  };

  const isValid = (obj) => !!(obj && obj.accepted === true && (now() - (obj.ts || 0) < ms(DAYS_TO_LIVE)));

  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.getElementById('cookie-banner');
    const btn    = document.getElementById('cookie-accept');
    if (!banner || !btn) return;

    // Показ баннера, если нет валидного согласия
    banner.hidden = isValid(read());

    // Согласие: записываем, прячем баннер
    btn.addEventListener('click', () => {
      write();
      banner.hidden = true;
    }, { passive: true });

    // UX: Esc тоже закрывает (не меняет логику согласия)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !banner.hidden) banner.hidden = true;
    });
  });
})();