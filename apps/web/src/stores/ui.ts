/**
 * Préférences UI persistées localement (localStorage) : thème clair/sombre, motion, densité, navigation.
 * Un script inline dans le <head> applique ces attributs avant le premier rendu (zéro flash).
 */
'use client';
import { create } from 'zustand';

export interface UiState {
  themeMode: 'light' | 'dark' | 'system';
  motion: boolean;
  density: 'comfortable' | 'compact' | null; // null = suivre les préférences utilisateur serveur
  nav: 'sidebar' | 'topbar' | 'rail' | null;
  sidebarCollapsed: boolean;
  langOverride: string | null; // null = préférence serveur
  set: (p: Partial<Omit<UiState, 'set'>>) => void;
}

const LS_KEY = 'sardpi:ui';

function load(): Partial<UiState> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Partial<UiState>;
  } catch {
    return {};
  }
}

export const useUi = create<UiState>((set, get) => ({
  themeMode: 'light',
  motion: true,
  density: null,
  nav: null,
  sidebarCollapsed: false,
  langOverride: null,
  set: (p) => {
    set(p);
    const s = { ...get(), ...p };
    localStorage.setItem(LS_KEY, JSON.stringify({ themeMode: s.themeMode, motion: s.motion, density: s.density, nav: s.nav, langOverride: s.langOverride }));
    applyUi(s);
  },
}));

export function applyUi(s: Pick<UiState, 'themeMode' | 'motion' | 'density' | 'nav' | 'langOverride'>): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  const dark = s.themeMode === 'dark' || (s.themeMode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  el.classList.toggle('dark', !!dark);
  el.dataset.motion = s.motion ? 'on' : 'off';
  el.classList.toggle('motion-on', s.motion);
  if (s.density) el.dataset.density = s.density;
  else delete el.dataset.density;
  if (s.nav) el.dataset.nav = s.nav;
  else delete el.dataset.nav;
}
