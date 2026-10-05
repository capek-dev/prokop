import { createContext, useContext, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceViewId } from '@/stores/workspaceViewStore';

const ViewVisibilityContext = createContext(true);

export function useWorkspaceViewVisible(): boolean {
  return useContext(ViewVisibilityContext);
}

interface WorkspaceViewHostProps {
  id: WorkspaceViewId;
  label?: string;
  target: HTMLElement | null;
  visible: boolean;
  children: ReactNode;
}

/** Keep the portal destination stable; only its DOM parent follows placement. */
export function WorkspaceViewHost({ id, label = id, target, visible, children }: WorkspaceViewHostProps) {
  const [host] = useState(() => document.createElement('div'));

  useLayoutEffect(() => {
    if (!target || host.parentElement === target) return;
    const focused = host.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const scroll = Array.from(host.querySelectorAll<HTMLElement>('*'))
      .filter((element) => element.scrollTop !== 0 || element.scrollLeft !== 0)
      .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
    target.appendChild(host);
    for (const { element, top, left } of scroll) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
    if (visible) focused?.focus({ preventScroll: true });
  }, [host, target, visible]);

  useLayoutEffect(() => {
    host.setAttribute('data-workspace-view', id);
    host.setAttribute('id', `workspace-view-${id}`);
    host.setAttribute('role', 'tabpanel');
    host.setAttribute('aria-label', label);
    host.setAttribute('class', 'absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden');
    host.style.setProperty('visibility', visible ? 'visible' : 'hidden');
    host.style.setProperty('pointer-events', visible ? '' : 'none');
    host.toggleAttribute('inert', !visible);
    host.setAttribute('aria-hidden', String(!visible));
  }, [host, id, label, visible]);

  useLayoutEffect(() => () => host.remove(), [host]);

  return createPortal(
    <ViewVisibilityContext value={visible}>{children}</ViewVisibilityContext>,
    host,
  );
}
