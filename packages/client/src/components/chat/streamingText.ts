const OPENING_FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

function isClosingFence(line: string, fenceChar: string, fenceLen: number): boolean {
  const trimmed = line.trim();
  if (trimmed.length < fenceLen || trimmed[0] !== fenceChar) return false;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== fenceChar) return false;
  }
  return true;
}

export interface StreamingTextSplit {
  blocks: string[];
  tail: string;
  tailHasOpenFence: boolean;
}

/**
 * Splits partially-streamed markdown into stable blocks and a growing tail.
 *
 * Stable blocks end at a blank line or a closed code fence, so each can be
 * rendered as an independently memoized MarkdownRenderer that never re-parses.
 * The tail is the last (still growing) block; if a code fence is unterminated
 * the entire fenced section stays in the tail until the fence closes.
 */
export function splitStreamingText(text: string): StreamingTextSplit {
  const blocks: string[] = [];
  let current = '';
  let fenceChar = '';
  let fenceLen = 0;

  // split('\n') yields a trailing '' when text ends with a newline; that is the
  // line terminator, not a blank line, and must not graduate a block (a wrapped
  // paragraph must stay one block until a real blank line or closed fence).
  const rawLines = text.split('\n');
  const endsWithNewline = rawLines.length > 1 && rawLines[rawLines.length - 1] === '';
  const lines = endsWithNewline ? rawLines.slice(0, -1) : rawLines;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only the final line may lack a source newline; append one elsewhere so
    // blocks/tail are exact slices of the streamed text (no phantom breaks).
    const lineText = i === lines.length - 1 && !endsWithNewline ? line : line + '\n';
    if (fenceChar === '') {
      const match = OPENING_FENCE_RE.exec(line);
      if (match) {
        fenceChar = match[1][0];
        fenceLen = match[1].length;
        current += lineText;
      } else if (line.trim() === '') {
        if (current.trim() !== '') blocks.push(current);
        current = '';
      } else {
        current += lineText;
      }
    } else {
      current += lineText;
      if (isClosingFence(line, fenceChar, fenceLen)) {
        blocks.push(current);
        current = '';
        fenceChar = '';
        fenceLen = 0;
      }
    }
  }

  return {
    blocks,
    tail: current,
    tailHasOpenFence: fenceChar !== '',
  };
}
