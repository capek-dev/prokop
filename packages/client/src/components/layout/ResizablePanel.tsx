import { useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  clampPanelWidth,
} from '@prokopai/sdk';
import { DesktopPanelDivider } from '@/components/layout/DesktopPanelDivider';
import {
  Sidebar,
  SidebarContent,
  useSidebar,
} from '@/components/ui/sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePointerDrag } from '@/hooks/usePointerDrag';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';

interface ResizablePanelProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  resizable?: boolean;
  variant?: 'sidebar' | 'floating' | 'inset' | 'shell';
  onContentKeyDown?: (e: React.KeyboardEvent) => void;
  contentRef?: React.Ref<HTMLDivElement>;
}

export interface ResizablePanelHandle {
  focusContent: () => void;
}

export const ResizablePanel = forwardRef<ResizablePanelHandle, ResizablePanelProps>(
  ({ children, header, resizable = true, variant = 'floating', onContentKeyDown, contentRef: externalContentRef }, ref) => {
    const internalContentRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const contentRef: React.RefObject<HTMLDivElement | null> = externalContentRef && typeof externalContentRef === 'object'
      ? externalContentRef
      : internalContentRef;
    const isMobile = useIsMobile();
    const { state } = useSidebar();
    const sessionsPanelWidth = useChatLayoutStore((store) => store.sessionsPanelWidth);
    const setSessionsPanelWidth = useChatLayoutStore((store) => store.setSessionsPanelWidth);

    const focusContent = useCallback(() => {
      const container = contentRef.current;
      if (!container) return;

      const buttons = Array.from(
        container.querySelectorAll<HTMLButtonElement>('[data-sidebar="menu-button"]')
      );

      if (buttons.length === 0) {
        container.focus();
        return;
      }

      buttons[0]?.focus();
    }, [contentRef]);

    useImperativeHandle(ref, () => ({
      focusContent,
    }), [focusContent]);

    const resizeSessions = useCallback((event: PointerEvent): number | null => {
      const panel = panelRef.current;
      const wrapper = panel?.closest<HTMLElement>('[data-panel-id="sessions"]');
      if (!panel || !wrapper) return null;

      const nextWidth = clampPanelWidth(event.clientX - panel.getBoundingClientRect().left);
      wrapper.style.setProperty('--sidebar-width', `${nextWidth}px`);
      return nextWidth;
    }, []);

    const commitSessionsWidth = useCallback((nextWidth: number) => {
      setSessionsPanelWidth(Math.round(nextWidth));
    }, [setSessionsPanelWidth]);

    const handleDividerDown = usePointerDrag({
      cursor: 'ew-resize',
      onMove: resizeSessions,
      onCommit: commitSessionsWidth,
    });

    const handleDividerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const nextWidth = clampPanelWidth(sessionsPanelWidth + direction * 16);
      const wrapper = panelRef.current?.closest<HTMLElement>('[data-panel-id="sessions"]');
      wrapper?.style.setProperty('--sidebar-width', `${nextWidth}px`);
      commitSessionsWidth(nextWidth);
    }, [commitSessionsWidth, sessionsPanelWidth]);

    const content = (
      <>
        {header}
        <SidebarContent
          ref={contentRef}
          tabIndex={-1}
          onKeyDown={onContentKeyDown}
          className="outline-none"
        >
          {children}
        </SidebarContent>
      </>
    );

    if (variant === 'shell' && isMobile) {
      return null;
    }

    if (variant === 'shell') {
      return (
        <>
          <aside
            ref={panelRef}
            data-slot="sessions-panel"
            data-sidebar="sidebar"
            data-state={state}
            data-variant="shell"
            className="relative hidden h-full shrink-0 overflow-hidden bg-sidebar text-sidebar-foreground md:flex md:flex-col"
            style={{
              width: state === 'expanded' ? 'var(--sidebar-width)' : 0,
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            {content}
          </aside>
          {resizable && state === 'expanded' && (
            <DesktopPanelDivider
              label="Resize Sessions"
              min={PANEL_MIN_WIDTH}
              max={PANEL_MAX_WIDTH}
              value={sessionsPanelWidth}
              onKeyDown={handleDividerKeyDown}
              onPointerDown={handleDividerDown}
            />
          )}
        </>
      );
    }

    return (
      <Sidebar
        collapsible="offcanvas"
        variant={variant}
      >
        {content}
      </Sidebar>
    );
  },
);
