import { useEffect, useRef } from 'react';
import type { CachedTerminal } from '@/hooks/useTerminal';

const FIT_DEBOUNCE_MS = 120;

interface TerminalViewProps {
  cachedTerminal: CachedTerminal;
}

export function TerminalView({ cachedTerminal }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { terminal, fitAddon } = cachedTerminal;
    if (!cachedTerminal.isOpened) {
      terminal.open(container);
      // eslint-disable-next-line react-hooks/immutability
      cachedTerminal.isOpened = true;
    } else if (terminal.element) {
      container.appendChild(terminal.element);
    }

    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // Container might not be visible yet
      }

      if (terminal.cols <= 1 || terminal.rows <= 1) {
        const waitForDimensions = () => {
          try {
            fitAddon.fit();
            if (terminal.cols > 1 && terminal.rows > 1) return;
          } catch {
            // Container might not be ready
          }
          requestAnimationFrame(waitForDimensions);
        };
        requestAnimationFrame(waitForDimensions);
      }
    });

    terminal.focus();

    let fitDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const runDebouncedFit = () => {
      if (fitDebounceTimer !== null) clearTimeout(fitDebounceTimer);
      fitDebounceTimer = setTimeout(() => {
        fitDebounceTimer = null;
        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
          } catch {
            // Container might not be visible
          }
        });
      }, FIT_DEBOUNCE_MS);
    };

    const observer = new ResizeObserver(runDebouncedFit);
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (fitDebounceTimer !== null) {
        clearTimeout(fitDebounceTimer);
        fitDebounceTimer = null;
      }
      if (terminal.element && terminal.element.parentElement) {
        terminal.element.parentElement.removeChild(terminal.element);
      }
    };
  }, [cachedTerminal]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      onFocus={() => cachedTerminal.terminal.focus()}
    />
  );
}
