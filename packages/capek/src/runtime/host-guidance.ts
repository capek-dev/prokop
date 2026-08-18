import { MEMORY_GUIDANCE } from '../memory';
import { AGENT_MEMORY_SKILLS_GUIDANCE } from '../plugins/legacy-system-message';
import { SKILL_MANAGE_GUIDANCE } from '../skills';
import { SESSION_SEARCH_GUIDANCE } from '../session-search';
import { getRuntimeHost } from './host';

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
