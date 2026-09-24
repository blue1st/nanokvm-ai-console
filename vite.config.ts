import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import esbuild from 'esbuild';

function buildScriptsPlugin() {
  const compile = () => {
    esbuild.buildSync({
      entryPoints: ['electron/preload.ts'],
      outfile: 'dist-electron/preload.cjs',
      format: 'cjs',
      platform: 'node',
      bundle: true,
      external: ['electron'],
    });
    esbuild.buildSync({
      entryPoints: ['electron/network-worker.ts'],
      outfile: 'dist-electron/network-worker.cjs',
      format: 'cjs',
      platform: 'node',
      bundle: true,
      external: ['electron'],
    });
  };

  return {
    name: 'build-scripts',
    buildStart() {
      compile();
    },
    closeBundle() {
      compile();
    },
    handleHotUpdate(ctx: { file: string }) {
      if (
        ctx.file.includes('preload.ts') ||
        ctx.file.includes('network-worker.ts') ||
        ctx.file.includes('llm-client.ts') ||
        ctx.file.includes('mcp-client.ts')
      ) {
        compile();
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    buildScriptsPlugin(),
    electron([
      {
        // Main-Process entry file of the Electron App.
        entry: 'electron/main.ts',
        vite: {
          plugins: [buildScriptsPlugin()],
          build: {
            outDir: 'dist-electron',
            emptyOutDir: false,
            rollupOptions: {
              external: [
                'electron',
              ],
              output: {
                entryFileNames: 'main.js',
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
});
