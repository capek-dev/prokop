### Fixed

- The model selector in a session header now follows the width of its own pane. With more than one session open, every header showed the icon-only selector used on mobile, even when each pane had plenty of room. `ChatHeader` now measures its own width (`hooks/use-element-width.ts`, a `ResizeObserver`): the selector collapses to the icon below 420px, shows only the model name below 640px, and shows the full model, variant, and preconfig label otherwise. Narrow viewports keep their existing mobile and compact forms.
