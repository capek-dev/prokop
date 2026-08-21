import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { LegendList } from '@legendapp/list/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileTreeRow } from './FileTreeRow';
import type { FileEntryActionTarget, FileEntryActions } from './FileEntryContextMenu';
import { useFlatFileTree, type VisibleFileNode } from '@/hooks/useFlatFileTree';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';

interface FileTreeProps {
  workspaceId: string;
  sdkClient: ProkopaiClient | null;
  onFileSelect?: (target: FileEntryActionTarget) => void;
  showHidden?: boolean;
  width?: number;
  root?: string;
  /** Currently active file path (relative), for active row styling. */
  activePath?: string;
  /** Root the activePath is relative to ('' or undefined for main root). */
  activeRoot?: string;
  /** Context menu actions for file rows. */
  contextActions?: FileEntryActions;
}

export interface FileTreeHandle {
  refresh: () => void;
  focus: () => void;
}

export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(
  ({ workspaceId, sdkClient, onFileSelect, showHidden = true, width, root, activePath, activeRoot, contextActions }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [focusedIndex, setFocusedIndex] = useState<number>(-1);

    const {
      visibleNodes,
      isLoading,
      error,
      refetchRoot,
      toggleExpanded,
      prefetchDirectory,
    } = useFlatFileTree({
      sdkClient,
      workspaceId,
      showHidden,
      root,
    });

    const shouldVirtualize = visibleNodes.length > RENDER_BUDGETS.fileTreeVirtualizeThreshold;

    useImperativeHandle(ref, () => ({
      refresh: () => {
        refetchRoot();
      },
      focus: () => {
        if (visibleNodes.length > 0) {
          setFocusedIndex(0);
        }
        const container = containerRef.current;
        if (container) {
          const firstNode = container.querySelector<HTMLButtonElement>('[data-file-node]');
          if (firstNode) {
            firstNode.focus();
          } else {
            container.focus();
          }
        }
      },
    }), [refetchRoot, visibleNodes.length]);

    const focusNode = useCallback((index: number) => {
      if (index < 0 || index >= visibleNodes.length) return;
      setFocusedIndex(index);
      const container = containerRef.current;
      if (!container) return;
      const nodes = container.querySelectorAll<HTMLButtonElement>('[data-file-node]');
      nodes[index]?.focus();
    }, [visibleNodes.length]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (visibleNodes.length === 0) return;

      const currentIndex = focusedIndex >= 0 ? focusedIndex : 0;
      const currentNode = visibleNodes[currentIndex];

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          focusNode(Math.min(currentIndex + 1, visibleNodes.length - 1));
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          focusNode(Math.max(currentIndex - 1, 0));
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          if (!currentNode) break;
          if (currentNode.entry.type === 'directory') {
            if (!currentNode.isExpanded) {
              toggleExpanded(currentNode.fullPath);
            } else {
              focusNode(Math.min(currentIndex + 1, visibleNodes.length - 1));
            }
          } else {
            focusNode(Math.min(currentIndex + 1, visibleNodes.length - 1));
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (!currentNode) break;
          if (currentNode.entry.type === 'directory' && currentNode.isExpanded) {
            toggleExpanded(currentNode.fullPath);
          } else if (currentNode.parentId) {
            const parentIndex = visibleNodes.findIndex(n => n.fullPath === currentNode.parentId);
            if (parentIndex >= 0) focusNode(parentIndex);
          } else {
            focusNode(Math.max(currentIndex - 1, 0));
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (!currentNode) break;
          if (currentNode.entry.type === 'directory') {
            toggleExpanded(currentNode.fullPath);
          } else {
            onFileSelect?.({
              entry: { ...currentNode.entry, path: currentNode.fullPath },
              root,
            });
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          setFocusedIndex(-1);
          (document.activeElement as HTMLElement)?.blur();
          break;
        }
      }
    }, [visibleNodes, focusedIndex, toggleExpanded, onFileSelect, focusNode, root]);

    const rowCommon = {
      onToggle: toggleExpanded,
      onFileSelect,
      onPrefetch: prefetchDirectory,
      contextActions,
      root,
    };

    // Determine whether the active file lives under this tree's root.
    const rootMatches = (activeRoot ?? '') === (root ?? '');
    const isActivePath = !!(activePath && rootMatches);

    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Loading files...
        </div>
      );
    }

    if (error) {
      return (
        <div className="p-4 text-sm text-destructive">
          {error.message}
          <Button variant="ghost" size="sm" onClick={() => refetchRoot()} className="ml-2">
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      );
    }

    if (visibleNodes.length === 0) {
      return (
        <div className="p-4 text-sm text-muted-foreground">
          Empty workspace
          <Button variant="ghost" size="sm" onClick={() => refetchRoot()} className="ml-2">
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      );
    }

    if (shouldVirtualize) {
      return (
        <div
          ref={containerRef}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="flex-1 min-h-0 min-w-0 w-full outline-none"
        >
          <LegendList
            data={visibleNodes}
            keyExtractor={(node: VisibleFileNode) => node.id}
            renderItem={({ item, index }: { item: VisibleFileNode; index: number }) => (
              <FileTreeRow
                node={item}
                {...rowCommon}
                isFocused={focusedIndex === index}
                isActive={isActivePath && item.fullPath === activePath}
              />
            )}
            estimatedItemSize={36}
            drawDistance={400}
            className="h-full overflow-y-auto px-2 pb-2"
            ListEmptyComponent={null}
          />
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex-1 min-h-0 min-w-0 w-full outline-none"
      >
        <ScrollArea className="h-full">
          <div
            className="px-2 pb-2 w-full min-w-0"
            style={width ? { width: `${width - 8}px` } : undefined}
          >
            <div className="space-y-0.5 min-w-0">
              {visibleNodes.map((node, index) => (
                <FileTreeRow
                  key={node.id}
                  node={node}
                  {...rowCommon}
                  isFocused={focusedIndex === index}
                  isActive={isActivePath && node.fullPath === activePath}
                />
              ))}
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }
);

FileTree.displayName = 'FileTree';
