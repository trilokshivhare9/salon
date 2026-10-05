import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8080,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
