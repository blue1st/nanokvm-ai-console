/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0f172a',
        surface: '#1e293b',
        'surface-hover': '#334155',
        primary: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
        },
      },
    },
  },
  plugins: [],
}
