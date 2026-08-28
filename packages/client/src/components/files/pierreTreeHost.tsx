import type { ReactNode } from 'react';

/**
 * Shared @pierre/trees host surface used by both the Project tree
 * (FileTreePierre) and the Changes view (GitChangesView): one themed CSS
 * injection point and one shadow-DOM-aware row finder.
 */

/**
 * Maps the shadcn palette onto the tree's shadow-DOM custom properties. Must
 * be rendered inside a `[data-pierre-file-tree]` wrapper (shadow DOM isolates
 * the tree from `:root`, so every token below is an explicit indirection).
 */
export const PIERRE_TREE_THEME_CSS = `
  [data-pierre-file-tree] {
    /* Structure */
    --trees-bg-override: var(--sidebar);
    --trees-fg-override: var(--sidebar-foreground);
    --trees-fg-muted-override: var(--muted-foreground);
    /* Faint edge: mix a touch of foreground into the surface instead of the
     * solid border token (the raw border reads too heavy at 1px solid). */
    --trees-border-color-override: color-mix(in oklab, var(--sidebar-foreground) 14%, transparent);
    --trees-accent-override: var(--primary);

    /* Interaction states */
    --trees-selected-bg-override: var(--accent);
    --trees-selected-fg-override: var(--accent-foreground);
    --trees-theme-list-hover-bg-override: var(--accent);

    /*
     * Focus ring. Draws as a 2px outline using --trees-focus-ring-color,
     * and selected+focused rows swap to --trees-selected-focused-border-
     * color; both default into --trees-accent, far heavier than app rings.
     */
    --trees-focus-ring-color-override: var(--ring);
    --trees-selected-focused-border-color-override: var(--sidebar-ring);

    /* Built-in search box */
    --trees-search-bg-override: var(--muted);
    --trees-search-fg-override: var(--foreground);
    --trees-input-bg-override: var(--muted);
    --trees-theme-input-bg-override: var(--muted);
    --trees-theme-input-fg-override: var(--foreground);
  }
`;

/**
 * Standard React wrapper around a Pierre model instance: theme injection,
 * sized host element, shared `data-pierre-file-tree` attribute.
 */
export function PierreTreeHost({
  hostRef,
  children,
}: {
  hostRef?: React.Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <style>{PIERRE_TREE_THEME_CSS}</style>
      <div ref={hostRef} className="h-full w-full" data-pierre-file-tree>
        {children}
      </div>
    </div>
  );
}

interface PierreSelectionItem {
  deselect: () => void;
  isDirectory: () => boolean;
}

interface PierreSelectionModel {
  getItem: (path: string) => PierreSelectionItem | null;
}

/**
 * Treat a file selection as an activation, then clear it. Pierre emits
 * `onSelectionChange` only when selection state changes, so leaving a file
 * selected prevents clicking that same row from opening preview again.
 * `activate` is optional: callers with a stale data set pass none so the row
 * still deselects instead of stranding the selection.
 */
export function activatePierreFileSelection(
  model: PierreSelectionModel,
  path: string,
  activate?: () => void,
): boolean {
  const item = model.getItem(path);
  if (!item || item.isDirectory()) return false;
  activate?.();
  item.deselect();
  return true;
}

/**
 * Real keyboard navigation needs document focus on the row element Pierre
 * marks with tabIndex != -1 (every other row gets -1). Rows may live in light
 * DOM or inside one or more shadow roots depending on custom-element upgrade
 * timing, so the lookup walks every scope under the host; plain
 * querySelector never crosses a shadow boundary. Retries cover late
 * upgrades/render passes (~1s ceiling).
 */
export function focusFocusedPierreRow(
  host: HTMLElement | null,
  retries = 10,
): void {
  if (!host) return;
  let attempts = 0;
  const tryFocus = () => {
    attempts += 1;
    const scopes: ParentNode[] = [host];
    const collect = (root: ParentNode) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          scopes.push(el.shadowRoot);
          collect(el.shadowRoot);
        }
      }
    };
    collect(host);

    for (const scope of scopes) {
      const row = scope.querySelector<HTMLElement>(
        '[tabindex]:not([tabindex="-1"])',
      );
      if (row) {
        row.focus();
        return;
      }
    }
    if (attempts < retries) window.setTimeout(tryFocus, 100);
  };
  window.setTimeout(tryFocus, 0);
}
