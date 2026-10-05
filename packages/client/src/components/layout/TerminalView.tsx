import { useEffect, useRef } from 'react';
import type { CachedTerminal } from '@/hooks/useTerminal';

const FIT_DEBOUNCE_MS = 120;

interface TerminalViewProps {
  cachedTerminal: CachedTerminal;
  visible?: boolean;
}

export function TerminalView({ cachedTerminal, visible = true }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const { terminal } = cachedTerminal;
    if (!cachedTerminal.isOpened) {
      terminal.open(container);
      // eslint-disable-next-line react-hooks/immutability
      cachedTerminal.isOpened = true;
    } else if (terminal.element) {
      container.appendChild(terminal.element);
    }
    return () => { terminal.element?.remove(); };
  }, [cachedTerminal]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !visible) return;
    const { terminal, fitAddon } = cachedTerminal;
    let frame: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fit = () => {
      frame = null;
      if (!container.clientWidth || !container.clientHeight) return;
      try {
        fitAddon.fit();
      } catch {
        // ResizeObserver retries when the container obtains usable dimensions.
      }
    };
    frame = requestAnimationFrame(fit);
    terminal.focus();
    const observer = new ResizeObserver(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(fit);
      }, FIT_DEBOUNCE_MS);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [cachedTerminal, visible]);

  return <div ref={containerRef} className="w-full h-full" onFocus={() => cachedTerminal.terminal.focus()} />;
}
