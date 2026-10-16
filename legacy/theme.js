(function () {
  'use strict';
  const key = 'gather-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = value => value === 'dark' || value === 'light' ? value : 'system';
  let preference = 'system';
  try { preference = valid(localStorage.getItem(key)); } catch (_) { /* Session-only when storage is unavailable. */ }
  const current = () => preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
  function updateButtons() {
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-pressed', String(current() === 'dark'));
    });
  }
  function apply() {
    // Hydration recovery can replace <html>; never retain a detached root.
    const root = document.documentElement;
    const theme = current();
    root.dataset.theme = theme;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111820' : '#f7f8f2');
    updateButtons();
    window.dispatchEvent(new CustomEvent('gather-theme-change', { detail: theme }));
  }
  function set(value) {
    preference = valid(value);
    try {
      if (preference === 'system') localStorage.removeItem(key);
      else localStorage.setItem(key, preference);
    } catch (_) { /* Applying a theme must not depend on storage access. */ }
    apply();
  }
  window.GatherTheme = Object.freeze({ current, set, refresh: apply, toggle: () => set(current() === 'dark' ? 'light' : 'dark') });
  apply();
  document.addEventListener('DOMContentLoaded', updateButtons, { once: true });
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('[data-theme-toggle]')) window.GatherTheme.toggle();
  });
  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = valid(event.newValue); apply(); }
  });
})();
