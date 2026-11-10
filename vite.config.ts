import { defineConfig } from 'vite';
import { resolve } from 'path';
import { bidsPhysioPlugin } from './server/bids-physio-plugin';

export default defineConfig({
  plugins: [bidsPhysioPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // Scan only the app's pages for dependencies, not other HTML in the
  // project (e.g. the built docs in docs/_build/)
  optimizeDeps: {
    entries: ['index.html', 'quality.html'],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        quality: resolve(__dirname, 'quality.html'),
      },
    },
  },
});
