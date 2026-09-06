import { mergeConfig } from 'vitest/config';
import { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import baseConfig from './vitest.config';

// Exercise the same React Compiler transform as the browser for render regressions.
export default mergeConfig(baseConfig, {
  plugins: [babel({ presets: [reactCompilerPreset({ target: '19' })] })],
});
