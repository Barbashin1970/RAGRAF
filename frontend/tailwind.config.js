/** @type {import('tailwindcss').Config} */
const USER_DOMAIN_TONES = [
  'orange', 'amber', 'yellow', 'emerald', 'green', 'teal',
  'sky', 'blue', 'indigo', 'violet', 'fuchsia', 'rose', 'stone',
]
// Безопасный список классов которые мы конструируем динамически в
// `buildUserDomainVisual` через `bg-${tone}-100` и т.д. Без safelist
// Tailwind вырезает их при purge, и пользовательские домены остаются
// бесцветными. Каждый tone × {bg, text, border, gradient}.
const USER_DOMAIN_SAFELIST = USER_DOMAIN_TONES.flatMap((t) => [
  `bg-${t}-50`, `bg-${t}-50/80`, `bg-${t}-100`, `bg-${t}-500`,
  `text-${t}-700`,
  `border-${t}-100`, `border-${t}-300`, `hover:border-${t}-300`,
  `from-${t}-50/80`,
])

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  safelist: USER_DOMAIN_SAFELIST,
  theme: {
    extend: {
      colors: {
        // Nexus-inspired palette (warm beige + teal accents, see regulation-viz-skill.md § Design System)
        surface: {
          DEFAULT: '#FAF6EE',
          offset: '#F1EADB',
          dynamic: '#E8DFC9',
        },
        primary: { DEFAULT: '#2C7A7B', soft: '#B2F5EA' },
        accent: {
          success: '#2F855A',
          'success-highlight': '#C6F6D5',
          blue: '#3182CE',
          'blue-highlight': '#BEE3F8',
          gold: '#B7791F',
          'gold-highlight': '#FAF089',
          purple: '#6B46C1',
          'purple-highlight': '#E9D8FD',
          orange: '#DD6B20',
          'orange-highlight': '#FEEBC8',
          notification: '#C53030',
          'notification-highlight': '#FED7D7',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
