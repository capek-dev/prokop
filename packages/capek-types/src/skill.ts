/**
 * Skill metadata extracted from SKILL.md frontmatter
 */
export interface SkillInfo {
  /** Skill name from frontmatter */
  name: string;
  /** Description from frontmatter - used to help LLM decide when to use */
  description: string;
  /** Absolute path to the SKILL.md file */
  location: string;
  /** The markdown content (without frontmatter) */
  content: string;
  /** Whether this skill can be invoked by user directly (optional, defaults to true) */
  userInvocable?: boolean;
}

/**
 * Parsed frontmatter from SKILL.md
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  'user-invocable'?: boolean;
}
