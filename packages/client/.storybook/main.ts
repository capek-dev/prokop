import type { StorybookConfig } from '@storybook/react-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const config: StorybookConfig = {
  stories: [
    '../src/**/*.stories.tsx',
    '../src/**/*.mdx',
  ],
  addons: [
    './theme-addon/preset.ts',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (config) => {
    // Filter out TanStack Router plugins — not needed in Storybook (no routes)
    const existingPlugins = (config.plugins ?? []).flatMap((plugin) =>
      Array.isArray(plugin) ? plugin : [plugin],
    ).filter((plugin) => {
      if (plugin && typeof plugin === 'object' && 'name' in plugin) {
        const name = (plugin as { name: string }).name;
        // Remove TanStack Router (no routes in Storybook) and React plugins
        // (we add our own react() plugin below — duplicates cause "RefreshRuntime already declared")
        const lower = name.toLowerCase();
        return !lower.includes('tanstack')
          && !lower.includes('router')
          && !lower.startsWith('vite:react');
      }
      return true;
    });

    config.plugins = [
      react(),
      tailwindcss(),
      ...existingPlugins,
    ];

    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(import.meta.dirname, '../src'),
    };

    config.optimizeDeps = config.optimizeDeps || {};
    config.optimizeDeps.include = [
      '@prokopai/sdk',
    ];

    return config;
  },
};

export default config;
