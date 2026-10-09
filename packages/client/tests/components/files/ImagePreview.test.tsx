import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ImagePreview from '@/components/files/ImagePreview';
import { isBinaryImagePath } from '@/lib/imageFiles';

function loadWithSize(image: HTMLElement, width: number, height: number) {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height });
  fireEvent.load(image);
}

describe('ImagePreview', () => {
  test('a favicon scales up by whole steps, pixelated, and shows its real size', () => {
    render(<ImagePreview src="data:image/x-icon;base64,AA==" name="favicon.ico" />);
    const image = screen.getByRole('img', { name: 'favicon.ico' });

    loadWithSize(image, 16, 16);

    expect(image).toHaveStyle({ width: '256px', height: '256px' });
    expect(image.className).toContain('[image-rendering:pixelated]');
    expect(screen.getByText('16 × 16 · 16×')).toBeInTheDocument();
  });

  test('clicking toggles actual size, which never scales', () => {
    render(<ImagePreview src="data:image/png;base64,AA==" name="icon.png" />);
    const image = screen.getByRole('img', { name: 'icon.png' });
    loadWithSize(image, 32, 32);

    fireEvent.click(image);

    expect(image).not.toHaveAttribute('style');
    expect(image).toHaveAttribute('title', 'Click to fit');
  });

  test('a format the browser cannot decode says so instead of a broken image', () => {
    render(<ImagePreview src="data:image/heic;base64,AA==" name="photo.heic" />);
    fireEvent.error(screen.getByRole('img', { name: 'photo.heic' }));
    expect(screen.getByText('This browser cannot display this image')).toBeInTheDocument();
  });
});

describe('isBinaryImagePath', () => {
  test('matches binary image extensions case-insensitively, by name only', () => {
    expect(['a.png', 'b.JPG', 'favicon.ico', 'x.webp'].every(isBinaryImagePath)).toBe(true);
    expect(['notes.md', 'png', '.png', 'dir.png/file.ts'].some(isBinaryImagePath)).toBe(false);
  });

  test('SVG is text, so it follows the normal open mode', () => {
    expect(isBinaryImagePath('icons/logo.svg')).toBe(false);
  });
});
