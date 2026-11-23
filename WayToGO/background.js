// Restore appearance before the first paint; storage may be disabled in private mode.
(() => {
  const choices = new Set(['none', '1', '2', '3', '4', '5', '6']);
  const storageKey = 'waytogo.background';
  let selected = '5';
  try {
    const saved = localStorage.getItem(storageKey);
    if (choices.has(saved)) selected = saved;
  } catch { /* The default also works without browser storage. */ }
  document.documentElement.dataset.background = selected;

  document.addEventListener('DOMContentLoaded', () => {
    const picker = document.getElementById('background-picker');
    picker.value = selected;
    picker.addEventListener('change', () => {
      if (!choices.has(picker.value)) return;
      document.documentElement.dataset.background = picker.value;
      try { localStorage.setItem(storageKey, picker.value); } catch { /* Session-only choice. */ }
    });
  });
})();
