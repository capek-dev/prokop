import { describe, test, expect } from 'vitest';
import { splitStreamingText } from '@/components/chat/streamingText';

describe('splitStreamingText', () => {
  test('empty text yields no blocks and empty tail', () => {
    expect(splitStreamingText('')).toEqual({ blocks: [], tail: '', tailHasOpenFence: false });
  });

  test('single unfinished paragraph stays in tail', () => {
    const result = splitStreamingText('Hello world, this is sti');
    expect(result.blocks).toEqual([]);
    expect(result.tail).toBe('Hello world, this is sti');
    expect(result.tailHasOpenFence).toBe(false);
  });

  test('completed paragraph graduates to block, remainder stays in tail', () => {
    const result = splitStreamingText('First paragraph.\n\nSecond para');
    expect(result.blocks).toEqual(['First paragraph.\n']);
    expect(result.tail).toBe('Second para');
    expect(result.tailHasOpenFence).toBe(false);
  });

  test('multiple completed blocks accumulate', () => {
    const result = splitStreamingText('# Title\n\nIntro text.\n\n- item\n- item2\n\nNext');
    expect(result.blocks).toEqual(['# Title\n', 'Intro text.\n', '- item\n- item2\n']);
    expect(result.tail).toBe('Next');
  });

  test('open code fence keeps entire section in tail', () => {
    const result = splitStreamingText('Intro.\n\n```ts\nconst x = 1');
    expect(result.blocks).toEqual(['Intro.\n']);
    expect(result.tail).toBe('```ts\nconst x = 1');
    expect(result.tailHasOpenFence).toBe(true);
  });

  test('closed code fence graduates as a block', () => {
    const result = splitStreamingText('Intro.\n\n```ts\nconst x = 1;\n```\n\nAfter');
    expect(result.blocks).toEqual(['Intro.\n', '```ts\nconst x = 1;\n```\n']);
    expect(result.tail).toBe('After');
    expect(result.tailHasOpenFence).toBe(false);
  });

  test('blank line inside open fence does not split', () => {
    const result = splitStreamingText('```\nline1\n\nline2\n```');
    expect(result.blocks).toEqual(['```\nline1\n\nline2\n```']);
    expect(result.tail).toBe('');
  });

  test('fence with info string and longer closing fence recognized', () => {
    const result = splitStreamingText('~~~python\nprint(1)\n~~~~~~\ntail');
    expect(result.blocks).toEqual(['~~~python\nprint(1)\n~~~~~~\n']);
    expect(result.tail).toBe('tail');
  });

  test('tilde fence does not close with backticks and vice versa', () => {
    const tildes = splitStreamingText('~~~\nabc\n```\nmore');
    expect(tildes.blocks).toEqual([]);
    expect(tildes.tailHasOpenFence).toBe(true);

    const backticks = splitStreamingText('```\nabc\n~~~\nmore');
    expect(backticks.blocks).toEqual([]);
    expect(backticks.tailHasOpenFence).toBe(true);
  });

  test('indented fence (up to 3 spaces) recognized', () => {
    const result = splitStreamingText('   ```\ncode\n   ```');
    expect(result.blocks).toEqual(['   ```\ncode\n   ```']);
    expect(result.tail).toBe('');
  });

  test('list item line does not terminate a block mid-list', () => {
    const result = splitStreamingText('- one\n- two\n- three');
    expect(result.blocks).toEqual([]);
    expect(result.tail).toBe('- one\n- two\n- three');
  });

  test('block ending at end of text with trailing newline is complete', () => {
    const result = splitStreamingText('Done.\n');
    expect(result.blocks).toEqual([]);
    expect(result.tail).toBe('Done.\n');
  });

  test('two consecutive blank lines do not create empty blocks', () => {
    const result = splitStreamingText('Para.\n\n\n\nNext');
    expect(result.blocks).toEqual(['Para.\n']);
    expect(result.tail).toBe('Next');
  });
});
