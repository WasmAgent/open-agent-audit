/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ─── Brand & Semantic Color Tokens ──────────────────────────────────────
      colors: {
        // Primary brand palette — Indigo shades
        brand: {
          primary: {
            50:  '#eef2ff',
            100: '#e0e7ff',
            200: '#c7d2fe',
            300: '#a5b4fc',
            400: '#818cf8',
            500: '#6366f1',
            600: '#4f46e5',
            700: '#4338ca',
            800: '#3730a3',
            900: '#312e81',
            950: '#1e1b4b',
          },
          // Accent palette — Violet shades
          accent: {
            50:  '#f5f3ff',
            100: '#ede9fe',
            200: '#ddd6fe',
            300: '#c4b5fd',
            400: '#a78bfa',
            500: '#8b5cf6',
            600: '#7c3aed',
            700: '#6d28d9',
            800: '#5b21b6',
            900: '#4c1d95',
            950: '#2e1065',
          },
        },

        // Surface tokens — slate-based background layers
        surface: {
          page:     '#f8fafc', // slate-50
          card:     '#ffffff',
          elevated: '#f1f5f9', // slate-100
          overlay:  'rgba(15, 23, 42, 0.6)', // slate-900 @ 60 %
        },

        // Border tokens
        border: {
          DEFAULT: '#e2e8f0', // slate-200
          strong:  '#94a3b8', // slate-400
          focus:   '#6366f1', // brand.primary.500
        },

        // Text tokens
        text: {
          primary:   '#0f172a', // slate-900
          secondary: '#475569', // slate-600
          muted:     '#94a3b8', // slate-400
          inverse:   '#f8fafc', // slate-50
        },

        // Semantic status tokens
        status: {
          success: {
            DEFAULT: '#16a34a', // green-600
            bg:      '#f0fdf4', // green-50
            border:  '#86efac', // green-300
            text:    '#15803d', // green-700
          },
          warning: {
            DEFAULT: '#d97706', // amber-600
            bg:      '#fffbeb', // amber-50
            border:  '#fcd34d', // amber-300
            text:    '#b45309', // amber-700
          },
          error: {
            DEFAULT: '#dc2626', // red-600
            bg:      '#fef2f2', // red-50
            border:  '#fca5a5', // red-300
            text:    '#b91c1c', // red-700
          },
          info: {
            DEFAULT: '#2563eb', // blue-600
            bg:      '#eff6ff', // blue-50
            border:  '#93c5fd', // blue-300
            text:    '#1d4ed8', // blue-700
          },
        },
      },

      // ─── Box Shadow Tokens ───────────────────────────────────────────────────
      boxShadow: {
        card:     '0 1px 3px 0 rgba(15,23,42,0.08), 0 1px 2px -1px rgba(15,23,42,0.06)',
        elevated: '0 4px 6px -1px rgba(15,23,42,0.10), 0 2px 4px -2px rgba(15,23,42,0.08)',
        floating: '0 10px 15px -3px rgba(15,23,42,0.12), 0 4px 6px -4px rgba(15,23,42,0.08)',
        inset:    'inset 0 2px 4px 0 rgba(15,23,42,0.06)',
        glow:     '0 0 0 3px rgba(99,102,241,0.35)', // brand.primary.500 @ 35 %
      },

      // ─── Border Radius Tokens ────────────────────────────────────────────────
      borderRadius: {
        card:   '0.75rem',  // 12 px
        badge:  '9999px',   // pill
        button: '0.5rem',   // 8 px
        input:  '0.375rem', // 6 px
      },

      // ─── Typography Tokens ───────────────────────────────────────────────────
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
