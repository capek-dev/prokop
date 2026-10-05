import { useCallback, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { WorkspaceViewGroup } from '@/components/app/WorkspaceViewGroup';
import type { WorkspaceTab } from '@/components/app/workspaceTab';
import { DesktopPanelDivider } from '@/components/layout/DesktopPanelDivider';
import { usePointerDrag } from '@/hooks/usePointerDrag';
import { useWorkspaceViewStore, type ViewRegion, type WorkspaceViewId } from '@/stores/workspaceViewStore';
import type { ViewTree } from '@/stores/workspaceSplitLayout';

interface Props {
  tree: ViewTree;
  region: ViewRegion;
  available: readonly WorkspaceViewId[];
  tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>>;
  onSlot: (id: string, slot: HTMLDivElement | null) => void;
}

export function WorkspaceSplitTree(props: Props) {
  return props.tree.kind === 'group' ? <GroupLeaf {...props} groupId={props.tree.groupId} /> : <Split {...props} tree={props.tree} />;
}

function GroupLeaf({ groupId, region, available, tabs, onSlot }: Props & { groupId: string }) {
  const attach = useCallback((slot: HTMLDivElement | null) => onSlot(groupId, slot), [groupId, onSlot]);
  return <WorkspaceViewGroup groupId={groupId} region={region} available={available} tabs={tabs} slotRef={attach} />;
}

function Split({ tree, ...props }: Props & { tree: Extract<ViewTree, { kind: 'split' }> }) {
  const ref = useRef<HTMLDivElement>(null);
  const horizontal = tree.direction === 'right';
  const resize = useWorkspaceViewStore((state) => state.resizeSplit);
  const clamp = (ratio: number) => {
    const rect = ref.current?.getBoundingClientRect();
    const extent = rect ? (horizontal ? rect.width : rect.height) - 12 : 0;
    const minimum = extent > 0 ? Math.min(0.45, Math.max(0.1, (horizontal ? 160 : 100) / extent)) : 0.1;
    return Math.max(minimum, Math.min(1 - minimum, ratio));
  };
  const onPointerDown = usePointerDrag({
    cursor: horizontal ? 'ew-resize' : 'ns-resize',
    onMove: (event) => {
      const element = ref.current;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const extent = (horizontal ? rect.width : rect.height) - 12;
      if (extent <= 0) return null;
      const ratio = clamp(((horizontal ? event.clientX - rect.left : event.clientY - rect.top) - 6) / extent);
      element.style.setProperty('--split-ratio', String(ratio));
      return ratio;
    },
    onCommit: (ratio) => resize(tree.id, ratio),
  });
  useEffect(() => {
    const restore = () => ref.current?.style.setProperty('--split-ratio', String(tree.ratio));
    window.addEventListener('blur', restore);
    return () => window.removeEventListener('blur', restore);
  }, [tree.ratio]);
  const tracks = 'minmax(0, calc((100% - 12px) * var(--split-ratio))) 12px minmax(0, 1fr)';
  return <div ref={ref} data-workspace-split={tree.id} className="grid min-h-0 min-w-0 flex-1 overflow-hidden" style={{
    '--split-ratio': tree.ratio,
    [horizontal ? 'gridTemplateColumns' : 'gridTemplateRows']: tracks,
  } as CSSProperties}>
    <WorkspaceSplitTree {...props} tree={tree.first} />
    <DesktopPanelDivider label={`Resize ${props.region} split`} orientation={horizontal ? 'vertical' : 'horizontal'} min={10} max={90} value={tree.ratio * 100}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        const increase = horizontal ? 'ArrowRight' : 'ArrowDown';
        const decrease = horizontal ? 'ArrowLeft' : 'ArrowUp';
        if (![increase, decrease, 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        resize(tree.id, clamp(event.key === 'Home' ? 0.1 : event.key === 'End' ? 0.9 : tree.ratio + (event.key === increase ? 0.05 : -0.05)));
      }} />
    <WorkspaceSplitTree {...props} tree={tree.second} />
  </div>;
}
