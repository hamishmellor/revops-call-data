import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/run-analysis': 'http://localhost:3001',
      '/insights': 'http://localhost:3001',
      '/salesloft-calls': 'http://localhost:3001',
    },
  },
});
