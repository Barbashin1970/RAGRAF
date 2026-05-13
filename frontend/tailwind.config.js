/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
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
