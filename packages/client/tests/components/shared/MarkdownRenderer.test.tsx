import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi } from 'vitest';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';

describe('MarkdownRenderer', () => {
  // --- Plain Text ---
  describe('plain text', () => {
    test('renders plain text', () => {
      render(<MarkdownRenderer>Hello world</MarkdownRenderer>);
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });

    test('renders empty string without errors', () => {
      const { container } = render(<MarkdownRenderer>{''}</MarkdownRenderer>);
      expect(container.querySelector('.markdown-render')).toBeInTheDocument();
    });
  });

  // --- Headings ---
  describe('headings', () => {
    test('renders h1', () => {
      render(<MarkdownRenderer>{'# Heading 1'}</MarkdownRenderer>);
      const h1 = screen.getByRole('heading', { level: 1 });
      expect(h1).toHaveTextContent('Heading 1');
    });

    test('renders h2', () => {
      render(<MarkdownRenderer>{'## Heading 2'}</MarkdownRenderer>);
      const h2 = screen.getByRole('heading', { level: 2 });
      expect(h2).toHaveTextContent('Heading 2');
    });

    test('renders h3', () => {
      render(<MarkdownRenderer>{'### Heading 3'}</MarkdownRenderer>);
      const h3 = screen.getByRole('heading', { level: 3 });
      expect(h3).toHaveTextContent('Heading 3');
    });
  });

  // --- Inline Formatting ---
  describe('inline formatting', () => {
    test('renders bold text', () => {
      render(<MarkdownRenderer>{'This is **bold** text'}</MarkdownRenderer>);
      const strong = screen.getByText('bold');
      expect(strong).toBeInTheDocument();
      expect(strong.tagName).toBe('STRONG');
    });

    test('renders italic text', () => {
      render(<MarkdownRenderer>{'This is *italic* text'}</MarkdownRenderer>);
      const em = screen.getByText('italic');
      expect(em).toBeInTheDocument();
      expect(em.tagName).toBe('EM');
    });
  });

  // --- Links ---
  describe('links', () => {
    test('renders links with target _blank', () => {
      render(<MarkdownRenderer>{'[Example](https://example.com)'}</MarkdownRenderer>);
      const link = screen.getByRole('link', { name: 'Example' });
      expect(link).toHaveAttribute('href', 'https://example.com');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  // --- Lists ---
  describe('lists', () => {
    test('renders unordered list', () => {
      render(<MarkdownRenderer>{'- item 1\n- item 2\n- item 3'}</MarkdownRenderer>);
      const listItems = screen.getAllByRole('listitem');
      expect(listItems).toHaveLength(3);
      expect(listItems[0]).toHaveTextContent('item 1');
    });

    test('renders ordered list', () => {
      render(<MarkdownRenderer>{'1. first\n2. second\n3. third'}</MarkdownRenderer>);
      const list = screen.getByRole('list');
      expect(list.tagName).toBe('OL');
      const listItems = screen.getAllByRole('listitem');
      expect(listItems).toHaveLength(3);
    });
  });

  // --- Blockquotes ---
  describe('blockquote', () => {
    test('renders blockquote', () => {
      render(<MarkdownRenderer>{'> This is a quote'}</MarkdownRenderer>);
      const blockquote = screen.getByText('This is a quote').closest('blockquote');
      expect(blockquote).toBeInTheDocument();
    });
  });

  // --- Code ---
  describe('code', () => {
    test('renders inline code', () => {
      render(<MarkdownRenderer>{'Use `console.log` for debugging'}</MarkdownRenderer>);
      const code = screen.getByText('console.log');
      expect(code.tagName).toBe('CODE');
    });

    test('renders fenced code block with language', () => {
      render(<MarkdownRenderer>{'```typescript\nconst x = 1;\n```'}</MarkdownRenderer>);
      const pre = document.querySelector('pre');
      expect(pre).toBeInTheDocument();
      expect(pre).toHaveTextContent('const x = 1;');
    });

    test('renders code block without language', () => {
      render(<MarkdownRenderer>{'```\nplain code\n```'}</MarkdownRenderer>);
      const pre = document.querySelector('pre');
      expect(pre).toBeInTheDocument();
      expect(pre).toHaveTextContent('plain code');
    });

    test('shows language label on code block', () => {
      render(<MarkdownRenderer>{'```bash\necho hi\n```'}</MarkdownRenderer>);
      expect(screen.getByText('bash')).toBeInTheDocument();
    });

    test('shows text label on code block without language', () => {
      render(<MarkdownRenderer>{'```\necho hi\n```'}</MarkdownRenderer>);
      expect(screen.getByText('text')).toBeInTheDocument();
    });

    test('copies fenced code block with language to clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });

      render(<MarkdownRenderer>{'```bash\nbun install\n```'}</MarkdownRenderer>);
      await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));

      expect(writeText).toHaveBeenCalledWith('bun install');
      vi.unstubAllGlobals();
    });

    test('copies fenced code block without language to clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });

      render(<MarkdownRenderer>{'```\nplain code\n```'}</MarkdownRenderer>);
      await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));

      expect(writeText).toHaveBeenCalledWith('plain code');
      vi.unstubAllGlobals();
    });

    test('copy button still present after copying', async () => {
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      });

      render(<MarkdownRenderer>{'```bash\necho hi\n```'}</MarkdownRenderer>);
      await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));

      expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
      vi.unstubAllGlobals();
    });

    test('inline code has no copy button', () => {
      render(<MarkdownRenderer>{'Use `console.log` for debugging'}</MarkdownRenderer>);
      expect(screen.queryByRole('button', { name: 'Copy code' })).not.toBeInTheDocument();
    });
  });

  // --- Tables (GFM) ---
  describe('tables', () => {
    test('renders markdown table', () => {
      const table = [
        '| Name | Age |',
        '| --- | --- |',
        '| Alice | 30 |',
        '| Bob | 25 |',
      ].join('\n');

      render(<MarkdownRenderer>{table}</MarkdownRenderer>);

      const tableEl = screen.getByRole('table');
      expect(tableEl).toBeInTheDocument();
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  // --- Horizontal Rule ---
  describe('horizontal rule', () => {
    test('renders hr', () => {
      render(<MarkdownRenderer>{'above\n\n---\n\nbelow'}</MarkdownRenderer>);
      const hr = document.querySelector('hr');
      expect(hr).toBeInTheDocument();
    });
  });

  // --- Props ---
  describe('props', () => {
    test('applies custom className', () => {
      const { container } = render(
        <MarkdownRenderer className="custom-class">text</MarkdownRenderer>,
      );
      const wrapper = container.querySelector('.markdown-render');
      expect(wrapper).toHaveClass('custom-class');
    });

    test('has markdown-render class by default', () => {
      const { container } = render(<MarkdownRenderer>text</MarkdownRenderer>);
      expect(container.querySelector('.markdown-render')).toBeInTheDocument();
    });
  });

  // --- Memoization ---
  describe('memoization', () => {
    test('re-renders when children change', () => {
      const { rerender } = render(<MarkdownRenderer>Version 1</MarkdownRenderer>);
      expect(screen.getByText('Version 1')).toBeInTheDocument();

      rerender(<MarkdownRenderer>Version 2</MarkdownRenderer>);
      expect(screen.getByText('Version 2')).toBeInTheDocument();
    });
  });

  // --- Edge Cases ---
  describe('edge cases', () => {
    test('handles special characters', () => {
      render(<MarkdownRenderer>{'Price: $10 & free <shipping>'}</MarkdownRenderer>);
      expect(screen.getByText(/Price/)).toBeInTheDocument();
    });

    test('handles multiline paragraphs', () => {
      render(<MarkdownRenderer>{'Line one\n\nLine two'}</MarkdownRenderer>);
      const paragraphs = screen.getAllByText(/Line/);
      expect(paragraphs).toHaveLength(2);
    });
  });
});
