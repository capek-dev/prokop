import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { AnyVisualization } from '@prokopai/sdk';
import { VisualizationRenderer } from '@/components/visualizations/VisualizationRenderer';

describe('VisualizationRenderer', () => {
  it('renders nothing when visualization is undefined', () => {
    const { container } = render(<VisualizationRenderer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders SuccessIndicator for "none" type', () => {
    const viz: AnyVisualization = {
      type: 'none',
      message: 'Done',
    };
    render(<VisualizationRenderer visualization={viz} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('renders TerminalOutput for "shell-output" type', () => {
    const viz: AnyVisualization = {
      type: 'shell-output',
      command: 'echo hi',
      exitCode: 0,
      stdout: 'hi',
    };
    render(<VisualizationRenderer visualization={viz} />);
    expect(screen.getByText('echo hi')).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('renders TodoList for "todo-list" type', () => {
    const viz: AnyVisualization = {
      type: 'todo-list',
      items: [
        { content: 'Task 1', status: 'pending', priority: 'medium' },
      ],
    };
    render(<VisualizationRenderer visualization={viz} />);
    expect(screen.getByText('Task 1')).toBeInTheDocument();
  });

  it('renders FileListViewer for "file-list" type', () => {
    const viz: AnyVisualization = {
      type: 'file-list',
      title: 'My Files',
      files: [{ path: 'src/a.ts' }],
    };
    render(<VisualizationRenderer visualization={viz} />);
    expect(screen.getByText('My Files')).toBeInTheDocument();
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
  });

  it('renders markdown content for "markdown" type', () => {
    const viz: AnyVisualization = {
      type: 'markdown',
      content: '# Hello World',
    };
    render(<VisualizationRenderer visualization={viz} />);
    expect(screen.getByText('# Hello World')).toBeInTheDocument();
  });

  it('renders JSON for "table" type', () => {
    const viz: AnyVisualization = {
      type: 'table',
      columns: [{ key: 'name' }],
      rows: [{ name: 'Alice' }],
    };
    render(<VisualizationRenderer visualization={viz} />);
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });
});
