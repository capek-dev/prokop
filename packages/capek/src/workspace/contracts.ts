/**
 * C6 workspace policy contracts.
 *
 * The agent-scoped workspace policy owns containment and path
 * classification. Two surfaces are unified here:
 *
 * - The tool-runtime capability surface previously living in
 *   `tools/workspace-capability.ts` (`isLexicallyContained` plus the
 *   capability built over a `WorkspaceCapabilityHost`: tilde/absolute/
 *   relative resolution, effective-root and additional-root containment,
 *   sensitive and blocked classification, environment overlay, and
 *   additional-root mutation through the host).
 * - The server file-access surface previously living in the Jean2 workspace
 *   domain (`expandPath`, `resolvePath`, `isPathWithinWorkspace`,
 *   `isPathInside`, `isInsideUnselectedAdditionalRoot`,
 *   `resolveCandidatePath`, `resolveRootForQuery`, `selectEditableRoot`).
 *
 * The host interface keeps filesystem I/O on the host side: capability
 * construction only classifies paths and delegates mutations and
 * environment reads to the host. The Jean2 server fulfills the policy
 * through the inward-facing `WorkspacePathPolicyPort` adapter
 * (`adapters/capek/workspace-paths.ts`).
 */

/** Host supplied by the Jean2 workspace adapter or the facade bindings.
 * Filesystem I/O stays behind this interface; the policy never performs
 * I/O itself. */
export interface WorkspaceCapabilityHost {
  root?: string;
  additionalRoots?: string[];
  allowedRoots?: string[];
  tempDir: string;
  getEnvironmentValue?: (key: string) => string | undefined;
  addAdditionalRoot?: (path: string) => boolean | Promise<boolean>;
  removeAdditionalRoot?: (path: string) => boolean | Promise<boolean>;
}

export interface WorkspaceCapability {
  effectiveRoot: string;
  additionalRoots: string[];
  allowedRoots: string[];
  tempDir: string;
  resolvePath(path: string): string;
  isWithinWorkspace(path: string): boolean;
  isSensitivePath(path: string): boolean;
  isBlockedPath(path: string): boolean;
  getEnvironmentValue(key: string): string | undefined;
  addWorkspacePath(path: string): Promise<boolean>;
  removeWorkspacePath(path: string): Promise<boolean>;
}

/** Structural workspace shape used by the server-side root functions. */
export interface WorkspaceLike {
  path: string;
  additionalPaths: string[];
}

/** Composition-time provider options. The defaults reproduce the exact
 * pre-C6 constants; a custom provider may swap the blocked-path list, the
 * sensitive pattern list, or the home directory without the consumers
 * changing. */
export interface WorkspacePolicyOptions {
  blockedPaths: readonly string[];
  sensitivePatterns: readonly string[];
  homeDir: string;
}

/**
 * Pure path classification policy. Every function is deterministic over its
 * inputs and the frozen options; none performs filesystem I/O. The
 * mandatory containment and sensitive/blocked denial invariants are part of
 * the default provider and are not options (a custom provider replacing
 * them takes over the invariant, exactly like the other C6 policies).
 */
export interface WorkspacePolicy {
  /** Expands `~` to the frozen home directory and resolves. */
  expandPath(inputPath: string): string;
  /** Server-style resolution: tilde joins the frozen home, absolute inputs
   * resolve verbatim, relative inputs anchor to the workspace path. */
  resolvePathFor(path: string, workspacePath: string): string;
  /** Relative-based containment over the workspace root and additional
   * roots; separator-aware so `/main-other` never matches `/main`. */
  isPathWithinWorkspace(
    targetPath: string,
    workspacePath: string,
    additionalPaths?: string[],
  ): boolean;
  /** Separator-aware containment so `/foo` does not match `/foobar`. */
  isPathInside(child: string, parent: string): boolean;
  /** Whether the candidate lies inside an additional root other than the
   * selected one. */
  isInsideUnselectedAdditionalRoot(
    candidate: string,
    selectedRoot: string,
    additionalPaths: string[],
  ): boolean;
  /** Resolves the client-supplied path against the selected root; absolute
   * inputs resolve verbatim, relative inputs anchor to the root, and
   * Windows backslashes normalize to forward slashes. */
  resolveCandidatePath(root: string, inputPath: string): string;
  /** Resolves an optional `root` query to an allowed root, falling back to
   * the main workspace root when missing or invalid. */
  resolveRootForQuery(
    workspace: WorkspaceLike,
    rootQuery?: string,
  ): { root: string; isMain: boolean };
  /** Editable-file root selection: an explicit root must exactly match the
   * main root or one additional root, otherwise `valid` is false (the
   * caller rejects with the exact 'Invalid workspace root' error). */
  selectEditableRoot(
    workspace: WorkspaceLike,
    rootQuery?: string,
  ): { root: string; valid: boolean };
  /** Tool-runtime lexical containment: resolved path equals the root or
   * starts with `root + sep`. */
  isLexicallyContained(path: string, root: string): boolean;
  /** Case-insensitive sensitive-pattern classification. */
  isSensitivePath(path: string): boolean;
  /** Blocked-path classification over the frozen blocked list (resolved
   * input, case-sensitive). */
  isBlockedPath(path: string): boolean;
}

/**
 * The combined agent-scoped workspace service: the pure policy plus the
 * tool-runtime capability construction over a host.
 */
export interface WorkspaceService extends WorkspacePolicy {
  readonly id: string;
  /** Frozen composition-time options. */
  readonly options: Readonly<WorkspacePolicyOptions>;
  /** Builds the tool-runtime capability over a host using this service's
   * policy decisions. */
  createCapability(host: WorkspaceCapabilityHost): WorkspaceCapability;
}
