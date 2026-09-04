export interface CreateSessionOptions {
  openAlongside?: boolean;
  workspaceRootId?: string;
}

interface ModifierClick {
  metaKey: boolean;
  ctrlKey: boolean;
}

export function getCreateSessionOptions(event: ModifierClick): CreateSessionOptions {
  return { openAlongside: event.metaKey || event.ctrlKey };
}

export function getSessionCreateBoardAction(
  options?: CreateSessionOptions,
): 'replace-focused' | 'open-alongside' {
  return options?.openAlongside ? 'open-alongside' : 'replace-focused';
}
