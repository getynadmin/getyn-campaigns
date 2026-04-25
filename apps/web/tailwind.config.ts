import type { Config } from 'tailwindcss';
import preset from '@getyn/config/tailwind';

const config: Config = {
  presets: [preset],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
};

export default config;
