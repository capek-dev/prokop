import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'node:fs';
import pkg from './package.json';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

const tlsEnabled = process.env.JEAN2_TLS_ENABLED === 'true';
const tlsCertFile = process.env.JEAN2_TLS_CERT_FILE;
const tlsKeyFile = process.env.JEAN2_TLS_KEY_FILE;

let httpsConfig: { cert: string; key: string } | undefined;
if (tlsEnabled && tlsCertFile && tlsKeyFile) {
  httpsConfig = {
    cert: fs.readFileSync(tlsCertFile, 'utf-8'),
    key: fs.readFileSync(tlsKeyFile, 'utf-8'),
  };
}

const defaultServerUrl = httpsConfig ? 'https://localhost:8742' : 'http://localhost:3000';
const serverOrigin = process.env.VITE_SERVER_URL || defaultServerUrl;
const wsOrigin = serverOrigin.replace(/^http/, 'ws');

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  clearScreen: false,
  plugins: [
    tanstackRouter({
      autoCodeSplitting: true,
    }),
    react(),
    babel({ presets: [reactCompilerPreset({ target: '19' })] }),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,mjs,cjs,css,html,ico,png,svg,woff2,json,mp3}'],
      },
      manifest: {
        name: 'Prokop',
        short_name: 'Prokop',
        description: 'AI Agent Client',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        theme_color: '#1c1c1c',
        background_color: '#1c1c1c',
        orientation: 'any',
        categories: ['productivity', 'utilities'],
        // Relaunching (Dock click, shortcut, link) focuses the open window;
        // `src/lib/launchState.ts` receives the launch URL.
        launch_handler: { client_mode: ['focus-existing', 'auto'] },
        // Dock / taskbar right-click menu. No `id` or `start_url` here: adding
        // either changes the installed app's identity for existing installs.
        shortcuts: [
          { name: 'New session', url: '/?action=new-session', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Overview', url: '/?action=overview', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
        icons: [
          { src: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    }
  },
  define: {
    __CLIENT_VERSION__: JSON.stringify(pkg.version),
  },
  envPrefix: ['VITE_'],
  build: {
    outDir: 'dist',
  },
  // Module workers: Pierre's highlight worker lazy-imports Shiki's WASM
  // engine, and code-splitting is unavailable in the default IIFE format.
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    strictPort: true,
    https: httpsConfig,
    host: httpsConfig ? '0.0.0.0' : 'localhost',
    proxy: {
      '/api': {
        target: serverOrigin,
        // Keep the browser's Host: the server trusts loopback requests addressed to
        // localhost, so a rewritten Host would make a phone on the dev server look local.
        changeOrigin: false,
        secure: false
      },
      '/ws': {
        target: wsOrigin,
        ws: true,
        secure: false
      }
    }
  },
  preview: {
    port: 4173,
    strictPort: true,
    https: httpsConfig,
    host: httpsConfig ? '0.0.0.0' : 'localhost',
    proxy: {
      '/api': {
        target: serverOrigin,
        // Keep the browser's Host: the server trusts loopback requests addressed to
        // localhost, so a rewritten Host would make a phone on the dev server look local.
        changeOrigin: false,
        secure: false
      },
      '/ws': {
        target: wsOrigin,
        ws: true,
        secure: false
      }
    }
  }
});
