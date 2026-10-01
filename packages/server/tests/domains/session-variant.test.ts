import { describe, expect, test } from 'bun:test';
import { modelVariantKeys, resolveSessionVariant } from '@/domains/sessions/variant';

const catalog = [
  {
    id: 'deepseek',
    models: [
      { id: 'deepseek-v4-pro', variants: { high: {}, max: {} } },
      { id: 'deepseek-flash', variants: { high: {}, max: {} } },
      { id: 'deepseek-plain' },
    ],
  },
  {
    id: 'minimax',
    models: [{ id: 'MiniMax-M3', variants: { 'No Thinking': {}, Adaptive: {} } }],
  },
];

describe('session variant policy', () => {
  test('resolveSessionVariant keeps a stored key and falls to the first (lowest) key otherwise', () => {
    expect(resolveSessionVariant(['high', 'max'], 'max')).toBe('max');
    expect(resolveSessionVariant(['high', 'max'], 'high')).toBe('high');
    expect(resolveSessionVariant(['high', 'max'], null)).toBe('high');
    expect(resolveSessionVariant(['high', 'max'], 'xhigh')).toBe('high');
    expect(resolveSessionVariant(['high', 'max'], undefined)).toBe('high');
  });

  test('models without variants resolve to null', () => {
    expect(resolveSessionVariant([], 'high')).toBeNull();
    expect(resolveSessionVariant([], null)).toBeNull();
  });

  test('modelVariantKeys returns declared order and scopes by provider when given', () => {
    expect(modelVariantKeys(catalog, 'deepseek-v4-pro')).toEqual(['high', 'max']);
    expect(modelVariantKeys(catalog, 'deepseek-v4-pro', 'deepseek')).toEqual(['high', 'max']);
    expect(modelVariantKeys(catalog, 'MiniMax-M3', 'minimax')).toEqual(['No Thinking', 'Adaptive']);
    expect(modelVariantKeys(catalog, 'deepseek-plain')).toEqual([]);
    expect(modelVariantKeys(catalog, 'unknown-model')).toEqual([]);
    expect(modelVariantKeys(catalog, null, 'deepseek')).toEqual([]);
  });
});
