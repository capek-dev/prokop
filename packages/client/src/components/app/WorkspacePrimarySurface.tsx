import type { ReactNode } from 'react';

interface WorkspacePrimarySurfaceProps {
  header: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Primary Chat or Board dock, including its dock-local header. */
export function WorkspacePrimarySurface({
  header,
  children,
  className,
}: WorkspacePrimarySurfaceProps) {
  return (
    <section
      data-slot="workspace-primary-surface"
      className={className ?? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'}
    >
      {header}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
    </section>
  );
}
