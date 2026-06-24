/** @type {import('tailwindcss').Config} */
const ink = (n) => `rgb(var(--ink-${n}) / <alpha-value>)`;
const slate = (n) => `rgb(var(--slate-${n}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // NEUKO surfaces — CSS-variable backed so they flip between themes.
        ink: {
          950: ink(950),
          900: ink(900),
          850: ink(850),
          800: ink(800),
          700: ink(700),
          600: ink(600),
          500: ink(500),
        },
        // Text/neutral scale — also theme-aware.
        slate: {
          50: slate(50),
          100: slate(100),
          200: slate(200),
          300: slate(300),
          400: slate(400),
          500: slate(500),
          600: slate(600),
          700: slate(700),
          800: slate(800),
          900: slate(900),
        },
        // NEUKO signature neon red
        neon: {
          DEFAULT: '#ff2222',
          soft: '#ff7a7a',
          deep: '#d90000',
        },
        // G*BOY retro screen green
        gboy: {
          DEFAULT: 'rgb(var(--gboy-default) / <alpha-value>)',
          deep: 'rgb(var(--gboy-deep) / <alpha-value>)',
          screen: 'rgb(var(--gboy-screen) / <alpha-value>)',
        },
        // Harmies plush purple
        harm: {
          DEFAULT: '#a98bff',
          deep: '#7b5cff',
        },
        // warm pop accent
        flare: {
          DEFAULT: '#ff7a59',
          deep: '#ff4d6d',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,34,34,0.20), 0 0 40px -8px rgba(255,34,34,0.45)',
        'glow-harm': '0 0 0 1px rgba(169,139,255,0.20), 0 0 40px -8px rgba(123,92,255,0.45)',
        'glow-gboy': 'var(--glow-gboy)',
        card: '0 24px 60px -24px rgba(0,0,0,0.75)',
      },
      backgroundImage: {
        'grid-fade':
          'radial-gradient(circle at 50% 0%, rgba(255,34,34,0.10), transparent 45%), radial-gradient(circle at 85% 30%, rgba(123,92,255,0.10), transparent 40%)',
        'neon-line': 'linear-gradient(90deg, transparent, #ff2222, transparent)',
      },
      keyframes: {
        floaty: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseGlow: {
          '0%,100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(400%)' },
        },
      },
      animation: {
        floaty: 'floaty 6s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite',
        pulseGlow: 'pulseGlow 3s ease-in-out infinite',
        scan: 'scan 4s linear infinite',
      },
    },
  },
  plugins: [],
};
