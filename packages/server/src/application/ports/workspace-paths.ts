/**
 * Inward-facing workspace path policy port (S5, paired with C6 step 4).
 * The Capek workspace domain owns containment and path classification; the
 * Capek adapter (`adapters/capek/workspace-paths.ts`) fulfills this port
 * through the compat barrel, so server consumers share one algorithm with
 * the tool runtime. Shapes are plain structural data; no filesystem I/O
 * crosses the boundary (the file services perform the I/O after the policy
 * classifies the path).
 */

export interface WorkspaceLikeShape {
  path: string;
  additionalPaths: string[];
}

export interface WorkspacePathPolicyPort {
  /** Expands `~` to the active home directory and resolves. The optional
   * `home` retains the pre-C6 server signature override for compat
   * consumers; the scoped Capek provider owns the default home. */
  expandPath(inputPath: string, home?: string): string;
  /** Tilde joins the active home (or the compat override), absolute inputs
   * resolve verbatim, relative inputs anchor to the workspace path. */
  resolvePath(path: string, workspacePath: string, home?: string): string;
  /** Relative-based containment over the workspace root and additional
   * roots; separator-aware. */
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
  /** Resolves the client-supplied path against the selected root with
   * Windows backslash normalization. */
  resolveCandidatePath(root: string, inputPath: string): string;
  /** Resolves an optional `root` query to an allowed root. */
  resolveRootForQuery(
    workspace: WorkspaceLikeShape,
    rootQuery?: string,
  ): { root: string; isMain: boolean };
  /** Editable-file root selection; `valid` is false for roots outside the
   * workspace and additional roots. */
  selectEditableRoot(
    workspace: WorkspaceLikeShape,
    rootQuery?: string,
  ): { root: string; valid: boolean };
}
