export {
  buildConversationText,
  createCompactionTrigger,
  estimateToolOutputSize,
  formatOutput,
  getDefaultCompactionPolicy,
  persistCompactionFailure,
  processCompactionTask,
  resolveCompactionPolicy,
} from '@capekai/core/compat/jean2';
export type {
  CompactionPolicy,
  CompactionTaskResult,
  CompactionTrigger,
  CompactionTriggerReason,
  GenerateSummaryFn,
} from '@capekai/core/compat/jean2';
