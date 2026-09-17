/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: 'var(--bg-void)',
        surface: {
          base: 'var(--surface-base)',
          raised: 'var(--surface-raised)',
          overlay: 'var(--surface-overlay)',
        },
        accent: {
          cyan: 'var(--accent-cyan)',
          amber: 'var(--accent-amber)',
          magenta: 'var(--accent-magenta)',
        },
        tactical: {
          line: 'var(--line-dim)',
          glow: 'var(--line-glow)',
          grid: 'var(--grid-hairline)',
        },
        content: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        data: ['ui-monospace', '"SF Mono"', '"JetBrains Mono"', '"Cascadia Code"', 'Consolas', '"Noto Sans Mono CJK SC"', 'monospace'],
      },
      transitionTimingFunction: {
        'tactical-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
        'tactical-in': 'cubic-bezier(0.75, 0, 0.25, 1)',
        'snap': 'cubic-bezier(0.19, 1, 0.22, 1)',
      },
    },
  },
  plugins: [],
};
