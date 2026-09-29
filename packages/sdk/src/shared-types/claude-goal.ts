// Host projection of the native Claude /goal status. 'ended' requires a native met verdict.
export interface ClaudeGoalState {
  condition: string;
  status: 'active' | 'ended' | 'uncertain';
  iterations: number;
}
