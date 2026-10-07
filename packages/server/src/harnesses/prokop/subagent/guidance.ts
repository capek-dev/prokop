/** Subagent domain: self-delegation context guidance. Moved byte-for-byte
 * from the pre-C5 fixed system-message builder; the legacy builder imports
 * it here so both the fixed and the composed paths emit identical bytes. */
export function selfDelegationGuidance(preconfigId: string): string {
  return `SELF-DELEGATION:
- You may use the task tool with subagent_type "${preconfigId}" to delegate work to a fresh instance of yourself.
- This permission applies only to the immediate child. Reusing "${preconfigId}" later in the same ancestry chain is blocked.`;
}
