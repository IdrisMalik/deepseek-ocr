import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// The entry HTML lives inside src/. Vite needs explicit paths for the
// root-level public/ and dist/ directories in that layout.
const rootDir = process.cwd();

// GitHub Pages cannot set response headers, so the production build injects
// the policy as a meta tag. Development omits it because Vite's HMR client
// uses inline styles.
const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; " +
  "connect-src 'self' https://api.deepseek.com; font-src 'self'; base-uri 'none'; " +
  "form-action 'none'; object-src 'none'";

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: CONTENT_SECURITY_POLICY,
            },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

export default defineConfig({
  plugins: [cspPlugin()],
  root: 'src',
  // Relative asset URLs keep the build loadable from any Pages project path.
  base: './',
  publicDir: resolve(rootDir, 'public'),
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: 'localhost',
    port: 4173,
    // The browser test webServer polls this exact port; fail loudly instead
    // of silently moving when it is taken.
    strictPort: true,
  },
  build: {
    outDir: resolve(rootDir, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
