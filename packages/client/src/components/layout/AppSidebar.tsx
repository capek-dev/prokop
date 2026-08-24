import { useRef, useCallback, forwardRef, useImperativeHandle, useEffect } from 'react';
import { ResizablePanel } from './ResizablePanel';

interface AppSidebarProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  currentSessionId: string | null;
  onEscape?: () => void;
}

export interface AppSidebarHandle {
  focusSessionPanel: () => void;
}

export const AppSidebar = forwardRef<AppSidebarHandle, AppSidebarProps>((props, ref) => {
  const { children, header, currentSessionId, onEscape } = props;

  const sessionListRef = useRef<HTMLDivElement>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const focusSessionPanel = useCallback(() => {
    const container = sessionListRef.current;
    if (!container) return;

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-sidebar="menu-button"]')
    );

    if (buttons.length === 0) {
      container.focus();
      return;
    }

    const currentButton = buttons.find(btn => {
      return btn.getAttribute('data-session-id') === currentSessionIdRef.current;
    });

    if (currentButton) {
      currentButton.focus();
    } else {
      buttons[0]?.focus();
    }
  }, []);

  useImperativeHandle(ref, () => ({
    focusSessionPanel,
  }), [focusSessionPanel]);

  const handleSessionListKeyDown = useCallback((e: React.KeyboardEvent) => {
    const container = sessionListRef.current;
    if (!container) return;

    // Don't intercept keyboard navigation when an inline rename input is focused.
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.contentEditable === 'true')
    ) {
      return;
    }

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-sidebar="menu-button"]'
      )
    );
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIndex = currentIndex < buttons.length - 1 ? currentIndex + 1 : 0;
        buttons[nextIndex]?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
        buttons[prevIndex]?.focus();
        break;
      }
      case 'ArrowRight': {
        const flexContainer = (document.activeElement as HTMLElement)?.parentElement;
        if (!flexContainer) break;
        const chevronButton = flexContainer.querySelector<HTMLButtonElement>(
          'button[aria-label="Toggle child sessions"]'
        );
        if (!chevronButton) break;
        const collapsible = flexContainer.closest<HTMLElement>('[data-state]');
        if (collapsible?.dataset.state === 'closed') {
          e.preventDefault();
          chevronButton.click();
        }
        break;
      }
      case 'ArrowLeft': {
        const flexContainer = (document.activeElement as HTMLElement)?.parentElement;
        if (!flexContainer) break;
        const chevronButton = flexContainer.querySelector<HTMLButtonElement>(
          'button[aria-label="Toggle child sessions"]'
        );
        if (!chevronButton) break;
        const collapsible = flexContainer.closest<HTMLElement>('[data-state]');
        if (collapsible?.dataset.state === 'open') {
          e.preventDefault();
          chevronButton.click();
        }
        break;
      }
      case 'Enter': {
        if (document.activeElement instanceof HTMLButtonElement) {
          e.preventDefault();
          document.activeElement.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
          }));
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        (e.target as HTMLElement)?.blur();
        onEscape?.();
        break;
      }
    }
  }, [onEscape]);

  return (
    <ResizablePanel
      variant="floating"
      header={header}
      contentRef={sessionListRef}
      onContentKeyDown={handleSessionListKeyDown}
    >
      {children}
    </ResizablePanel>
  );
});
