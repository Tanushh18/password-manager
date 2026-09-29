/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Custom brand colors
        brand: {
          teal: '#31AAA9',
          cream: '#F8E0A4',
          red: '#A82020',
          darkred: '#6C1A1A',
        },
        // Teal color scale
        teal: {
          50: '#f0fffe',
          100: '#d8fcfb',
          200: '#b1f8f6',
          300: '#31AAA9',
          400: '#2a9a9a',
          500: '#238a8a',
          600: '#1c6b6b',
          700: '#154c4c',
          800: '#0e2d2d',
          900: '#070e0e',
        },
        // Cream color scale
        cream: {
          50: '#fffbf4',
          100: '#fef7e8',
          200: '#F8E0A4',
          300: '#f5d27d',
          400: '#f2c456',
          500: '#efb62f',
          600: '#d49a0f',
          700: '#b8800d',
          800: '#9c6609',
          900: '#6c4606',
        },
        // Red color scale
        red: {
          50: '#fef9f8',
          100: '#fdf3f1',
          200: '#f5d8d5',
          300: '#A82020',
          400: '#931a1a',
          500: '#7e1414',
          600: '#6C1A1A',
          700: '#5a1515',
          800: '#481010',
          900: '#360b0b',
        },
        dark: {
          bg: '#0f172a',
          surface: '#1e293b',
          'surface-light': '#334155',
          text: '#f1f5f9',
          'text-muted': '#cbd5e1',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Courier New', 'monospace'],
      },
      boxShadow: {
        'primary': '0 10px 30px rgba(49, 170, 169, 0.15)',
        'lg': '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
      },
    },
  },
  darkMode: 'class',
  plugins: [],
}
