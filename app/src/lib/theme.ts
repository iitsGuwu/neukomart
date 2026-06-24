import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'neuko-theme';
const listeners = new Set<() => void>();

function current(): Theme {
  if (typeof localStorage === 'undefined') return 'dark';
  return (localStorage.getItem(KEY) as Theme) || 'dark';
}

function apply(theme: Theme) {
  const el = document.documentElement;
  el.classList.toggle('dark', theme === 'dark');
  el.classList.toggle('light', theme === 'light');
  el.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#05070d' : '#d1d7e3');
}

/** Apply the persisted theme as early as possible. */
export function initTheme() {
  apply(current());
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEY, theme);
  apply(theme);
  listeners.forEach((l) => l());
}

export function toggleTheme() {
  setTheme(current() === 'dark' ? 'light' : 'dark');
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    current,
    () => 'dark',
  );
}
