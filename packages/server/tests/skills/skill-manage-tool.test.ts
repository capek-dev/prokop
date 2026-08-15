import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { executeSkillManageTool, buildSkillManageToolDescription } from '@capekai/core/compat/jean2';

describe('skill_manage tool', () => {
  let testDir: string;
  let skillsDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'jean2-skill-manage-test-'));
    skillsDir = join(testDir, '.agents', 'skills');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function skillPath(name: string) {
    return join(skillsDir, name, 'SKILL.md');
  }

  // ── Validation ───────────────────────────────────────────────

  describe('input validation', () => {
    test('rejects invalid action', async () => {
      const result = await executeSkillManageTool(
        { action: 'invalid', name: 'test' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid action');
    });

    test('rejects missing action', async () => {
      const result = await executeSkillManageTool(
        { name: 'test' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
    });

    test('rejects missing name for non-list action', async () => {
      const result = await executeSkillManageTool(
        { action: 'delete' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    test('rejects name with path separators', async () => {
      const result = await executeSkillManageTool(
        { action: 'delete', name: 'a/b' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('path separators');
    });
  });

  // ── list action ──────────────────────────────────────────────

  describe('list action', () => {
    test('returns empty list when no skills exist', async () => {
      const result = await executeSkillManageTool(
        { action: 'list' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe('list');
      expect(result.skills).toEqual([]);
    });

    test('returns list of existing skills', async () => {
      mkdirSync(join(skillsDir, 'my-skill'), { recursive: true });
      writeFileSync(
        skillPath('my-skill'),
        '---\nname: my-skill\ndescription: A test skill\n---\n\n# Body\n',
      );

      const result = await executeSkillManageTool(
        { action: 'list' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(1);
      expect(result.skills![0]).toEqual({
        name: 'my-skill',
        description: 'A test skill',
      });
    });

    test('list does not require name parameter', async () => {
      const result = await executeSkillManageTool(
        { action: 'list' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
    });
  });

  // ── create action ────────────────────────────────────────────

  describe('create action', () => {
    test('creates a new skill successfully', async () => {
      const result = await executeSkillManageTool(
        { action: 'create', name: 'my-skill', description: 'A test skill', content: '# Body\n\nSteps here.' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe('create');
      expect(result.name).toBe('my-skill');

      const content = readFileSync(skillPath('my-skill'), 'utf-8');
      expect(content).toContain('name: my-skill');
      expect(content).toContain('description: A test skill');
      expect(content).toContain('# Body');
    });

    test('rejects create without description', async () => {
      const result = await executeSkillManageTool(
        { action: 'create', name: 'my-skill', content: 'body' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('description');
    });

    test('rejects create without content', async () => {
      const result = await executeSkillManageTool(
        { action: 'create', name: 'my-skill', description: 'desc' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('content');
    });

    test('rejects create if skill already exists', async () => {
      await executeSkillManageTool(
        { action: 'create', name: 'my-skill', description: 'desc', content: 'body' },
        skillsDir,
        'none',
      );

      const result = await executeSkillManageTool(
        { action: 'create', name: 'my-skill', description: 'desc', content: 'body' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    test('normalizes skill name to safe slug', async () => {
      const result = await executeSkillManageTool(
        { action: 'create', name: 'My Cool Skill!', description: 'desc', content: 'body' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(result.name).toBe('my-cool-skill');
    });
  });

  // ── update action ────────────────────────────────────────────

  describe('update action', () => {
    beforeEach(async () => {
      await executeSkillManageTool(
        { action: 'create', name: 'my-skill', description: 'Original desc', content: 'Original body' },
        skillsDir,
        'none',
      );
    });

    test('updates skill body', async () => {
      const result = await executeSkillManageTool(
        { action: 'update', name: 'my-skill', content: 'New body content' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe('update');

      const content = readFileSync(skillPath('my-skill'), 'utf-8');
      expect(content).toContain('New body content');
      expect(content).not.toContain('Original body');
    });

    test('preserves existing description when not provided', async () => {
      const result = await executeSkillManageTool(
        { action: 'update', name: 'my-skill', content: 'New body' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(result.description).toBe('Original desc');
    });

    test('updates description when provided', async () => {
      const result = await executeSkillManageTool(
        { action: 'update', name: 'my-skill', description: 'New desc', content: 'New body' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(result.description).toBe('New desc');
    });

    test('rejects update for non-existent skill with available names in error', async () => {
      const result = await executeSkillManageTool(
        { action: 'update', name: 'nope', content: 'body' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
      expect(result.error).toContain('my-skill');
    });

    test('case-insensitive name resolution', async () => {
      const result = await executeSkillManageTool(
        { action: 'update', name: 'MY-SKILL', content: 'Uppercase body' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);

      const content = readFileSync(skillPath('my-skill'), 'utf-8');
      expect(content).toContain('Uppercase body');
    });
  });

  // ── patch action ─────────────────────────────────────────────

  describe('patch action', () => {
    beforeEach(async () => {
      await executeSkillManageTool(
        { action: 'create', name: 'my-skill', description: 'A skill', content: 'Line one\nLine two\nLine three' },
        skillsDir,
        'none',
      );
    });

    test('patches a unique string', async () => {
      const result = await executeSkillManageTool(
        { action: 'patch', name: 'my-skill', oldString: 'Line two', newString: 'Line TWO' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe('patch');

      const content = readFileSync(skillPath('my-skill'), 'utf-8');
      expect(content).toContain('Line TWO');
      expect(content).not.toContain('Line two');
    });

    test('rejects patch with non-matching oldString with helpful hint', async () => {
      const result = await executeSkillManageTool(
        { action: 'patch', name: 'my-skill', oldString: 'nonexistent text', newString: 'replacement' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.error).toContain('skill');
    });

    test('rejects patch with multiple matches', async () => {
      await executeSkillManageTool(
        { action: 'update', name: 'my-skill', content: 'dup\ndup\n' },
        skillsDir,
        'none',
      );

      const result = await executeSkillManageTool(
        { action: 'patch', name: 'my-skill', oldString: 'dup', newString: 'unique' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('2 locations');
    });

    test('rejects patch for non-existent skill with available names', async () => {
      const result = await executeSkillManageTool(
        { action: 'patch', name: 'nope', oldString: 'x', newString: 'y' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
      expect(result.error).toContain('my-skill');
    });

    test('case-insensitive name resolution for patch', async () => {
      const result = await executeSkillManageTool(
        { action: 'patch', name: 'MY-SKILL', oldString: 'Line two', newString: 'Patched' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
    });
  });

  // ── delete action ────────────────────────────────────────────

  describe('delete action', () => {
    beforeEach(async () => {
      await executeSkillManageTool(
        { action: 'create', name: 'my-skill', description: 'A skill', content: 'body' },
        skillsDir,
        'none',
      );
    });

    test('deletes an existing skill', async () => {
      const result = await executeSkillManageTool(
        { action: 'delete', name: 'my-skill' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe('delete');
      expect(existsSync(join(skillsDir, 'my-skill'))).toBe(false);
    });

    test('rejects delete for non-existent skill with available names', async () => {
      const result = await executeSkillManageTool(
        { action: 'delete', name: 'nope' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
      expect(result.error).toContain('my-skill');
    });

    test('case-insensitive name resolution for delete', async () => {
      const result = await executeSkillManageTool(
        { action: 'delete', name: 'MY-SKILL' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
    });
  });

  // ── Frontmatter name divergence ──────────────────────────────

  describe('frontmatter name divergence', () => {
    test('resolve by frontmatter name when folder name differs', async () => {
      mkdirSync(join(skillsDir, 'custom-folder'), { recursive: true });
      writeFileSync(
        skillPath('custom-folder'),
        '---\nname: pretty-name\ndescription: A skill with a custom name\n---\n\nBody here\n',
      );

      const result = await executeSkillManageTool(
        { action: 'patch', name: 'PRETTY-NAME', oldString: 'Body here', newString: 'Patched body' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);

      const content = readFileSync(skillPath('custom-folder'), 'utf-8');
      expect(content).toContain('Patched body');
    });

    test('delete resolves by frontmatter name', async () => {
      mkdirSync(join(skillsDir, 'custom-folder'), { recursive: true });
      writeFileSync(
        skillPath('custom-folder'),
        '---\nname: pretty-name\ndescription: desc\n---\n\nbody\n',
      );

      const result = await executeSkillManageTool(
        { action: 'delete', name: 'pretty-name' },
        skillsDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(existsSync(join(skillsDir, 'custom-folder'))).toBe(false);
    });
  });

  // ── Dynamic description ──────────────────────────────────────

  describe('buildSkillManageToolDescription', () => {
    test('includes skill names when skills exist', async () => {
      mkdirSync(join(skillsDir, 'debug-flow'), { recursive: true });
      writeFileSync(
        skillPath('debug-flow'),
        '---\nname: debug-flow\ndescription: How to debug things\n---\n\nBody\n',
      );

      const desc = await buildSkillManageToolDescription(skillsDir);
      expect(desc).toContain('debug-flow');
      expect(desc).toContain('How to debug things');
      expect(desc).toContain('list');
    });

    test('shows hint when no skills exist', async () => {
      const desc = await buildSkillManageToolDescription(skillsDir);
      expect(desc).toContain('No skills exist yet');
    });
  });
});
