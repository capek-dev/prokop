import { expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { CommitPatch } from '@/components/files/CommitPatch';

const filePatch = (name: string) => `diff --git a/${name} b/${name}
index 1111111..2222222 100644
--- a/${name}
+++ b/${name}
@@ -1 +1 @@
-old
+new
`;

test('renders a multi-file commit with the real Pierre renderer', () => {
  const { container } = render(<CommitPatch patch={filePatch('a.txt') + filePatch('b.txt')} themeType="light" />);
  expect(container.querySelectorAll('diffs-container')).toHaveLength(2);
});

test('renders a single-file commit', () => {
  const { container } = render(<CommitPatch patch={filePatch('a.txt')} themeType="dark" />);
  expect(container.querySelectorAll('diffs-container')).toHaveLength(1);
});
