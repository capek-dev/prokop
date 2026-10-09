### Changed

- **Long conversations are easier to follow**: Two or more tool calls in a row fold into one line that names the tools and shows failures, lines added and removed, and how long they took. The line stays open while the agent works in it and folds when the reply continues, and clicking it keeps it the way you left it. The agent's progress notes between tool calls stay visible. Finished thinking folds to "Thought for 12s". Each tool shows how long it took, a timer while it runs, why it was stopped, and the first line of its error without opening it. Hovering a reply shows its model, duration, and token count. The prompt map beside the conversation also marks failed turns and compaction points. This works for existing conversations too.
- **Scrolling up during a reply stops following right away**: Any scroll up (wheel, trackpad, touch, scrollbar, arrow keys, Page Up, Home, selecting text, or jumping to a find match) stops following on the first move, even while a long reply streams quickly, instead of being pulled back to the bottom. A sideways swipe in a code block no longer stops following. While you read earlier messages, a "Latest" button appears with a dot when new output arrives, and clicking it (or Cmd+Shift+F) follows again. Switching to another session and back returns you to where you were reading.
- **Your prompt appears the moment you send it**: The prompt shows in the conversation right away instead of after the agent finishes preparing the turn, which took longest in Claude Code and Codex sessions. If it takes a moment to confirm, a small "Sending" mark appears under it. If it cannot be sent, it stays in the conversation marked Not sent with the reason, plus Retry, Edit (puts the text back in the input), and Discard. Retrying never sends a prompt twice.
- **Quieter tool rows**: Shell commands that succeed no longer show a `[0]` exit code; failing ones still show theirs.

### Fixed

- **Prompts sent while disconnected are no longer lost**: Sending while the connection was down cleared the input and dropped the prompt without a word. It now stays in the conversation as Not sent, ready to retry.

- **Hover hints appear in place**: Hints for buttons and icons no longer slide in from the top-left corner of the window; they fade in where they belong.
