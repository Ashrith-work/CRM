/**
 * Shared Tailwind preset. Web app extends this so design tokens live in one place
 * and can later be shared with the mobile app (e.g. via nativewind).
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          500: '#3b6cf6',
          600: '#274fd6',
          700: '#1e3fb0',
        },
      },
      screens: {
        // Smallest supported target is a 375px-wide phone.
        xs: '375px',
      },
    },
  },
  plugins: [],
};
