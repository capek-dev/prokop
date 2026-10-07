export function buildWorkspaceSystemPrompt(
  workspacePath: string,
  additionalPaths: string[] = [],
): string {
  let additionalSection = '';
  if (additionalPaths.length > 0) {
    additionalSection = `

### Additional Paths

This workspace has additional directories you have full access to:
${additionalPaths.map((path) => `- ${path}`).join('\n')}

You can read, write, search, and explore files in these directories using absolute paths.
Relative paths still resolve from the primary workspace. Use absolute paths for additional paths.

`;
  }

  return `
<workspace>
## Working Directory

You are operating in: ${workspacePath}

### Path Resolution

All file operations support three path types:

1. **Relative Paths** (RECOMMENDED for workspace files)
   - Input: "src/app.ts"
   - Resolves to: "${workspacePath}/src/app.ts"

2. **Absolute Paths**
   - Input: "${workspacePath}/src/app.ts"
   - Used as-is

3. **Home Paths**
   - Input: "~/Documents/file.txt"
   - Expands relative to the current user's home directory

### Default Behaviors

- **File Operations**: Relative paths resolve from workspace root
- **Shell Commands**: Execute from workspace root by default
- **Search Operations**: Scoped to workspace by default
${additionalSection}### Security

Operations outside the workspace directory require explicit approval:
- Writing outside workspace: Requires approval
- Reading outside workspace: Requires approval (configurable)
- System directories: Blocked

### Best Practices

1. Use relative paths for files within the workspace
2. Use the \`cwd\` parameter in shell commands instead of \`cd\`
3. When in doubt, use absolute paths

Current workspace: ${workspacePath}
</workspace>
`.trim();
}
