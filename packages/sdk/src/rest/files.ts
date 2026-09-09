import type { HttpClient } from '../transport/http';
import type { GitRepositoryState, GitCommitInput, GitCommitResult, GitPushInput, GitPushResult, GitPushPreviewInput } from '../shared-types/git';
import type {
  BrowseFilesResponse,
  SearchFilesResponse,
  PreviewFileResponse,
  GitDiffFileResponse,
  GitStatusResponse,
  BrowseFsResponse,
  FsParentResponse,
  ListDrivesResponse,
  ReadEditableFileResponse,
  SaveFileResponse,
  FileTreeRestResponse,
  CreateFileRestResponse,
  RenameFileRestResponse,
  DeleteFileRestResponse,
} from '../types/rest-responses';
import type {
  SaveFileRequest,
  CreateFileRequest,
  RenameFileRequest,
  DeleteFileRequest,
} from '../shared';

interface BrowseOptions {
  path?: string;
  showHidden?: boolean;
  limit?: number;
  root?: string;
  signal?: AbortSignal;
}

interface SearchOptions {
  limit?: number;
  showHidden?: boolean;
  root?: string;
  signal?: AbortSignal;
}

interface PreviewOptions {
  signal?: AbortSignal;
}

interface ReadEditableOptions {
  root?: string;
  signal?: AbortSignal;
}

interface SaveOptions {
  signal?: AbortSignal;
}

interface BrowseFsOptions {
  signal?: AbortSignal;
}

interface FsParentOptions {
  signal?: AbortSignal;
}

interface DrivesOptions {
  signal?: AbortSignal;
}

export class FilesRestNamespace {
  constructor(private http: HttpClient) {}

  async browse(workspaceId: string, path?: string, options?: BrowseOptions): Promise<BrowseFilesResponse> {
    const params: Record<string, string> = {};

    if (path !== undefined) {
      params.path = path;
    }
    if (options?.showHidden !== undefined) {
      params.showHidden = String(options.showHidden);
    }
    if (options?.limit !== undefined) {
      params.limit = String(options.limit);
    }
    if (options?.root !== undefined) {
      params.root = options.root;
    }

    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/files`, {
      params: Object.keys(params).length > 0 ? params : undefined,
      signal: options?.signal,
    });
  }

  async search(workspaceId: string, query: string, options?: SearchOptions): Promise<SearchFilesResponse> {
    const params: Record<string, string> = {
      search: query,
    };

    if (options?.limit !== undefined) {
      params.limit = String(options.limit);
    }
    if (options?.showHidden !== undefined) {
      params.showHidden = String(options.showHidden);
    }
    if (options?.root !== undefined) {
      params.root = options.root;
    }

    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/files`, {
      params,
      signal: options?.signal,
    });
  }

  async preview(workspaceId: string, path: string, options?: PreviewOptions & { root?: string }): Promise<PreviewFileResponse> {
    const params: Record<string, string> = { path };
    if (options?.root !== undefined) {
      params.root = options.root;
    }
    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/file-preview`, {
      params,
      signal: options?.signal,
    });
  }

  async readEditable(workspaceId: string, path: string, options?: ReadEditableOptions): Promise<ReadEditableFileResponse> {
    const params: Record<string, string> = { path };
    if (options?.root !== undefined) {
      params.root = options.root;
    }
    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/file`, {
      params,
      signal: options?.signal,
    });
  }

  async save(workspaceId: string, request: SaveFileRequest, options?: SaveOptions): Promise<SaveFileResponse> {
    return this.http.put(`/workspaces/${encodeURIComponent(workspaceId)}/file`, request, {
      signal: options?.signal,
    });
  }

  async tree(
    workspaceId: string,
    options?: { root?: string; signal?: AbortSignal },
  ): Promise<FileTreeRestResponse> {
    const params: Record<string, string> = {};
    if (options?.root !== undefined) {
      params.root = options.root;
    }
    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/files/tree`, {
      params: Object.keys(params).length > 0 ? params : undefined,
      signal: options?.signal,
    });
  }

  async createFile(workspaceId: string, request: CreateFileRequest, options?: SaveOptions): Promise<CreateFileRestResponse> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/files/create`, request, {
      signal: options?.signal,
    });
  }

  async renameFile(workspaceId: string, request: RenameFileRequest, options?: SaveOptions): Promise<RenameFileRestResponse> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/files/rename`, request, {
      signal: options?.signal,
    });
  }

  async deleteFile(workspaceId: string, request: DeleteFileRequest, options?: SaveOptions): Promise<DeleteFileRestResponse> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/files/delete`, request, {
      signal: options?.signal,
    });
  }

  /** Remove a staged new file from the index only. Disk contents are untouched. */
  async gitRemoveStagedAddition(workspaceId: string, path: string, options?: { root?: string }): Promise<{ path: string }> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/remove-staged-addition`, { path, root: options?.root });
  }

  /** Restore one modified tracked file in both the index and working tree from HEAD. */
  async gitRevertModifiedFile(
    workspaceId: string,
    path: string,
    options?: { root?: string; signal?: AbortSignal },
  ): Promise<{ path: string }> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/revert-modified-file`, {
      path,
      root: options?.root,
    }, { signal: options?.signal });
  }

  /** Stage one untracked file, without committing or force-adding ignored files. */
  async gitAdd(
    workspaceId: string,
    path: string,
    options?: { root?: string; signal?: AbortSignal },
  ): Promise<{ path: string }> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/add`, {
      path,
      root: options?.root,
    }, { signal: options?.signal });
  }

  async gitRebaseState(workspaceId: string, options?: { root?: string }): Promise<import('../shared-types/gitRebase').GitRebaseState> {
    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/git/rebase`, { params: options?.root !== undefined ? { root: options.root } : undefined });
  }

  async gitRebaseConflict(workspaceId: string, input: { root?: string; path: string }): Promise<import('../shared-types/gitRebase').GitRebaseConflict> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/rebase/conflict`, input);
  }

  async gitRebaseStart(workspaceId: string, input: import('../shared-types/gitRebase').GitRebaseStart): Promise<import('../shared-types/gitRebase').GitRebaseState> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/rebase/start`, input);
  }

  async gitRebaseControl(workspaceId: string, input: import('../shared-types/gitRebase').GitRebaseControl): Promise<import('../shared-types/gitRebase').GitRebaseState> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/rebase/control`, input);
  }

  async gitRebaseResolve(workspaceId: string, input: import('../shared-types/gitRebase').GitRebaseResolution): Promise<import('../shared-types/gitRebase').GitRebaseState> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/rebase/resolve`, input);
  }

  async gitBranches(workspaceId: string, options?: { root?: string; signal?: AbortSignal }): Promise<import('../shared-types/gitBranches').GitBranchesResult> {
    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/git/branches`, { params: options?.root !== undefined ? { root: options.root } : undefined, signal: options?.signal });
  }

  async gitHistory(workspaceId: string, input: { root?: string; head: string; offset: number; upstream?: string | null }): Promise<import('../shared-types/gitBranches').GitHistoryResult> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/history`, input);
  }

  async gitCommitDetails(workspaceId: string, input: { root?: string; head: string }): Promise<import('../shared-types/gitBranches').GitCommitDetails> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/commit-details`, input);
  }

  async gitBranchPushReview(workspaceId: string, input: import('../shared-types/gitBranches').GitBranchPushTarget): Promise<import('../shared-types/gitBranches').GitBranchPushReview> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/branch-push-review`, input);
  }

  async gitBranchAction(workspaceId: string, input: import('../shared-types/gitBranches').GitBranchAction): Promise<{ warning?: string }> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/branch-action`, input);
  }

  async gitRepository(workspaceId: string, options?: { root?: string; signal?: AbortSignal }): Promise<GitRepositoryState> {
    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/git/repository`, {
      params: options?.root !== undefined ? { root: options.root } : undefined,
      signal: options?.signal,
    });
  }

  async gitCommit(workspaceId: string, input: GitCommitInput): Promise<GitCommitResult> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/commit`, input);
  }

  async gitPushPreview(workspaceId: string, input: GitPushPreviewInput): Promise<{ remoteHead: string | null }> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/push-preview`, input);
  }

  async gitPush(workspaceId: string, input: GitPushInput): Promise<GitPushResult> {
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/git/push`, input);
  }

  async gitDiff(
    workspaceId: string,
    path: string,
    options?: { root?: string; signal?: AbortSignal },
  ): Promise<GitDiffFileResponse> {
    const params: Record<string, string> = { path };
    if (options?.root !== undefined) {
      params.root = options.root;
    }
    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/git/diff`, {
      params,
      signal: options?.signal,
    });
  }

  async gitStatus(
    workspaceId: string,
    options?: { root?: string; signal?: AbortSignal },
  ): Promise<GitStatusResponse> {
    const params: Record<string, string> = {};
    if (options?.root !== undefined) {
      params.root = options.root;
    }
    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/git/status`, {
      params: Object.keys(params).length > 0 ? params : undefined,
      signal: options?.signal,
    });
  }

  async browseFs(path?: string, options?: BrowseFsOptions): Promise<BrowseFsResponse> {
    return this.http.get('/fs/browse', {
      params: path !== undefined ? { path } : undefined,
      signal: options?.signal,
    });
  }

  async parent(path: string, options?: FsParentOptions): Promise<FsParentResponse> {
    return this.http.get('/fs/parent', {
      params: { path },
      signal: options?.signal,
    });
  }

  async drives(options?: DrivesOptions): Promise<ListDrivesResponse> {
    return this.http.get('/fs/drives', { signal: options?.signal });
  }
}
