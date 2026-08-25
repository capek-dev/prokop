import { memo } from 'react';
import type { AnyVisualization } from '@prokopai/sdk';
import { DiffViewer } from './DiffViewer';
import { CodeBlock } from './CodeBlock';
import { FileListViewer } from './FileListViewer';
import { SuccessIndicator } from './SuccessIndicator';
import { TerminalOutput } from './TerminalOutput';
import { TodoList } from './TodoList';
import { StructuredResponse } from './StructuredResponse';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';

interface VisualizationRendererProps {
  visualization?: AnyVisualization;
}

export const VisualizationRenderer = memo(function VisualizationRenderer({ visualization }: VisualizationRendererProps) {
  if (!visualization) {
    return null;
  }

  switch (visualization.type) {
    case 'diff':
      return (
        <DiffViewer
          path={visualization.path}
          hunks={visualization.hunks}
          language={visualization.language}
          additions={visualization.additions}
          deletions={visualization.deletions}
          matchInfo={visualization.matchInfo}
        />
      );

    case 'diffs':
      return (
        <div className="space-y-3">
          {visualization.items.map((diff, index) => (
            <DiffViewer
              key={`${diff.path}-${index}`}
              path={diff.path}
              hunks={diff.hunks}
              language={diff.language}
              additions={diff.additions}
              deletions={diff.deletions}
              matchInfo={diff.matchInfo}
            />
          ))}
        </div>
      );

    case 'code':
      return (
        <CodeBlock
          path={visualization.path}
          content={visualization.content}
          language={visualization.language}
          created={visualization.created}
          highlightLines={visualization.highlightLines}
        />
      );

    case 'file-list':
      return (
        <FileListViewer
          title={visualization.title}
          groups={visualization.groups}
          files={visualization.files}
          total={visualization.total}
          singularLabel={visualization.singularLabel}
          pluralLabel={visualization.pluralLabel}
        />
      );

    case 'table':
      return (
        <pre className="text-xs bg-muted/50 border rounded-md p-2 overflow-x-auto">
          {JSON.stringify(visualization.rows, null, 2)}
        </pre>
      );

    case 'markdown':
      return (
        <div className="prose prose-sm dark:prose-invert max-w-full">
          <MarkdownRenderer>{visualization.content}</MarkdownRenderer>
        </div>
      );

    case 'none':
      return <SuccessIndicator message={visualization.message} />;

    case 'shell-output':
      return (
        <TerminalOutput
          command={visualization.command}
          stdout={visualization.stdout}
          stderr={visualization.stderr}
          exitCode={visualization.exitCode}
        />
      );

    case 'todo-list':
      return (
        <TodoList
          title={visualization.title}
          items={visualization.items}
        />
      );

    case 'structured-response':
      return (
        <StructuredResponse
          formatName={visualization.formatName}
          data={visualization.data}
          schema={visualization.schema}
        />
      );

    default:
      return null;
  }
});
