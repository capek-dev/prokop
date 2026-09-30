export {
  effectivePath,
  isOutsideRoot,
  isSensitivePath,
  isWithinRoot,
} from './paths';
export {
  severityFromMode,
  type LegacyAutoApproveSeverity,
} from './legacy-severity';
export {
  decide,
  type Concern,
  type Finding,
  type PermissionDecision,
  type PermissionMode,
} from './concerns';
export {
  CATASTROPHIC_BASES,
  DESTRUCTIVE_RULES,
  PROTECTED_TARGET_ROOTS,
  SCREENED_TOKENS,
  containsScreenedToken,
  isProtectedTarget,
  isSensitiveFilename,
  matchDestructiveRule,
  type DestructiveMatch,
  type DestructiveRule,
  type InvocationShape,
} from './command/tables';
export {
  analyzeCommand,
  type CommandAnalyzeContext,
} from './command/analyze';
export {
  analyzeRisk,
  classifyShellCommand,
  parseCommand,
  resolveCommandPath,
  stripRedundantCd,
  type ParsedCommand,
  type RiskAnalysis,
  type ShellRiskContext,
} from './shell';
