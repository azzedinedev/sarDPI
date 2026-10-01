import type { Config } from 'tailwindcss';

/**
 * Design tokens sarDPI — palette médicale (bleu-turquoise / vert menthe / blanc cassé / corail).
 * Toutes les couleurs sont mappées sur des variables CSS (thèmes clairs/sombres/externes).
 * Plugin RTL : la variante `rtl:` inversent chevrons/fleches en `dir="rtl"`.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        surface2: 'rgb(var(--c-surface-2) / <alpha-value>)',
        glass: 'rgb(var(--c-glass) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(var(--c-primary) / <alpha-value>)',
          soft: 'rgb(var(--c-primary-soft) / <alpha-value>)',
          ink: 'rgb(var(--c-primary-ink) / <alpha-value>)',
        },
        mint: { DEFAULT: 'rgb(var(--c-mint) / <alpha-value>)', soft: 'rgb(var(--c-mint-soft) / <alpha-value>)' },
        coral: { DEFAULT: 'rgb(var(--c-coral) / <alpha-value>)', soft: 'rgb(var(--c-coral-soft) / <alpha-value>)' },
        amber: { DEFAULT: 'rgb(var(--c-amber) / <alpha-value>)', soft: 'rgb(var(--c-amber-soft) / <alpha-value>)' },
        ok: { DEFAULT: 'rgb(var(--c-ok) / <alpha-value>)', soft: 'rgb(var(--c-ok-soft) / <alpha-value>)' },
        info: { DEFAULT: 'rgb(var(--c-info) / <alpha-value>)', soft: 'rgb(var(--c-info-soft) / <alpha-value>)' },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        // Échelle typographique (design tokens) ; line-height augmenté en arabe via CSS global
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        card: 'var(--r-card)',
        field: 'var(--r-field)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        lift: 'var(--shadow-lift)',
        glow: 'var(--shadow-glow)',
      },
      spacing: {
        row: 'var(--row-h)',
      },
    },
  },
  plugins: [
    // Variante RTL sans plugin externe : `rtl:hidden` => [dir="rtl"] & { display:none }
    function ({ addVariant }: { addVariant: (n: string, v: string | string[]) => void }) {
      addVariant('rtl', '[dir="rtl"] &');
      addVariant('ltr', '[dir="ltr"] &');
    },
  ],
};

export default config;
