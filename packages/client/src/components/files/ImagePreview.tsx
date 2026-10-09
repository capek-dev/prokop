import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Icons and sprites are scaled up to about this box so they are visible. */
const SMALL_IMAGE_BOX = 256;

interface ImagePreviewProps {
  src: string;
  name: string;
}

/**
 * Fits the image to the view on a checkerboard, so transparency shows.
 * Click toggles actual size. Small images scale up by whole steps with
 * pixelated rendering, which keeps icons sharp.
 */
export default function ImagePreview({ src, name }: ImagePreviewProps) {
  const [actualSize, setActualSize] = useState(false);
  // Scoped to the source, so an SVG fixed while editing renders again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [measured, setMeasured] = useState<{ src: string; width: number; height: number } | null>(null);
  const failed = failedSrc === src;
  const size = measured?.src === src ? measured : null;

  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <ImageOff className="mb-4 size-10 text-muted-foreground" />
        <p className="mb-1 text-sm font-medium">This browser cannot display this image</p>
        <p className="text-xs text-muted-foreground">{name}</p>
      </div>
    );
  }

  const largest = size ? Math.max(size.width, size.height) : 0;
  const upscale = !actualSize && largest > 0 && largest < SMALL_IMAGE_BOX
    ? Math.max(1, Math.floor(SMALL_IMAGE_BOX / largest))
    : 1;

  return (
    <div className="relative h-full">
      <div
        className={cn(
          'h-full overflow-auto chat-transcript-scrollbar',
          'bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-size-[16px_16px]',
          !actualSize && 'flex items-center justify-center p-4',
        )}
      >
        <img
          src={src}
          alt={name}
          draggable={false}
          onLoad={(event) => setMeasured({
            src,
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })}
          onError={() => setFailedSrc(src)}
          onClick={() => setActualSize(value => !value)}
          title={actualSize ? 'Click to fit' : 'Click for actual size'}
          className={cn(
            actualSize ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full object-contain cursor-zoom-in',
            upscale > 1 && '[image-rendering:pixelated]',
          )}
          style={upscale > 1 && size ? { width: size.width * upscale, height: size.height * upscale } : undefined}
        />
      </div>
      {size && size.width > 0 && (
        <span className="pointer-events-none absolute right-3 bottom-2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
          {size.width} × {size.height}{upscale > 1 ? ` · ${upscale}×` : ''}
        </span>
      )}
    </div>
  );
}
