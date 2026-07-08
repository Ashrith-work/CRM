import type { Config } from 'tailwindcss';
import preset from '@crm/config/tailwind';

const config: Config = {
  presets: [preset],
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
