/**
 * Empty-transcript state. Checkout selection lives in the input selector row
 * (fresh sessions) and the strip below the input (bound sessions), so this
 * stays a plain empty state with no worktree UI.
 */
export function EmptySessionCheckout() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-1 px-4 py-16 text-center">
      <p className="text-lg font-medium">Start a conversation</p>
      <p className="text-sm text-muted-foreground">Send a message below to begin.</p>
    </div>
  );
}
