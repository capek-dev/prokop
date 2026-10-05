import { useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { DockRegion } from '@/components/layout/DockRegion';
import {
  Sidebar,
  SidebarContent,
} from '@/components/ui/sidebar';
import { useIsMobile } from '@/hooks/use-mobile';

interface ResizablePanelProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  embedded?: boolean;
  variant?: 'sidebar' | 'floating' | 'inset' | 'shell';
  onContentKeyDown?: (e: React.KeyboardEvent) => void;
  contentRef?: React.Ref<HTMLDivElement>;
}

export interface ResizablePanelHandle {
  focusContent: () => void;
}

export const ResizablePanel = forwardRef<ResizablePanelHandle, ResizablePanelProps>(
  ({ children, header, variant = 'floating', embedded = false, onContentKeyDown, contentRef: externalContentRef }, ref) => {
    const internalContentRef = useRef<HTMLDivElement>(null);
    const contentRef: React.RefObject<HTMLDivElement | null> = externalContentRef && typeof externalContentRef === 'object'
      ? externalContentRef
      : internalContentRef;
    const isMobile = useIsMobile();

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

    if (embedded) {
      return <div data-sidebar="sidebar" data-mobile-surface={isMobile ? 'sessions' : undefined} className="flex min-h-0 flex-1 flex-col overflow-hidden">{content}</div>;
    }

    if (variant === 'shell' && isMobile) {
      return null;
    }

    if (variant === 'shell') {
      return (
        <DockRegion position="left">
          <div data-sidebar="sidebar" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {content}
          </div>
        </DockRegion>
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
