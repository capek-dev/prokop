import { MEMORY_GUIDANCE } from '@/harnesses/shared/memory/registry';
import { AGENT_MEMORY_SKILLS_GUIDANCE } from '@/harnesses/prokop/composition/plugins/legacy-system-message';
import { SKILL_MANAGE_GUIDANCE } from '@/harnesses/shared/skills/skill-manage-tool';
import { SESSION_SEARCH_GUIDANCE } from '@/harnesses/shared/session-search';
import { getRuntimeHost } from '@/infrastructure/runtime/host';

export interface HostGuidance {
  memory: string;
  agentMemorySkills: string;
  skillManage: string;
  sessionSearch: string;
}

export function getHostGuidance(): HostGuidance {
  const guidance = getRuntimeHost().guidance ?? {};
  return {
    memory: guidance.memory ?? MEMORY_GUIDANCE,
    agentMemorySkills: guidance.agentMemorySkills ?? AGENT_MEMORY_SKILLS_GUIDANCE,
    skillManage: guidance.skillManage ?? SKILL_MANAGE_GUIDANCE,
    sessionSearch: guidance.sessionSearch ?? SESSION_SEARCH_GUIDANCE,
  };
}
