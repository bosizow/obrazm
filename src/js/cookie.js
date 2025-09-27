(function () {
  const STORAGE_KEY = 'cookie:consent:simple:v1';

  function isAccepted() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY))?.accepted === true; }
    catch (e) { return false; }
  }
  function accept() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accepted: true, ts: Date.now() }));
  }

  document.addEventListener('DOMContentLoaded', function () {
    const banner = document.getElementById('cookie-banner');
    const btn = document.getElementById('cookie-accept');
    if (!banner || !btn) return;

    if (!isAccepted()) banner.hidden = false;

    btn.addEventListener('click', function () {
      accept();
      banner.hidden = true;
    });
  });
})();