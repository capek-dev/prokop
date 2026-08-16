/**
 * C6 pinned compatibility forwarder. The legacy filesystem truncation moved
 * to the tool-output domain (`tool-output/policy.ts`); the function
 * identity and the exact pre-C6 behavior (note strings, `_persisted`/
 * `_filePath`/`_originalSize` metadata, synchronous filesystem writes, and
 * non-fail-open filesystem errors) are preserved through the compat barrel
 * export in `compat/jean2.ts`.
 */

export { truncateToolResult } from '../tool-output/policy';
