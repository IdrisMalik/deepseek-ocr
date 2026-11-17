import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The reference demo keeps the entry HTML inside src/. Vite needs explicit
// paths for the root-level public/ and dist/ directories in that layout.
const rootDir = process.cwd();

export default defineConfig({
  root: 'src',
  // Relative asset URLs keep the build loadable from any Pages project path.
  base: './',
  publicDir: resolve(rootDir, 'public'),
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(rootDir, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
