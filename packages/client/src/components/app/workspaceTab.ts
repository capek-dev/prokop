export interface WorkspaceTab {
  label: string;
  description?: string;
  dirty?: boolean;
  status?: 'Running' | 'Needs input';
  closeDisabled?: boolean;
  onActivate?: () => void;
  onClose?: () => void;
  onCloseOthers?: () => void;
  onCloseAll?: () => void;
}
