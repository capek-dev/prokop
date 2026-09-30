export {
  effectivePath,
  isOutsideRoot,
  isSensitivePath,
  isWithinRoot,
} from './paths';
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
