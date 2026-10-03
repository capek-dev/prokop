/** Decode a single POSIX shell script argument, never evaluate it.
 * Unsupported shells, options, expansions and trailing arguments stay unmatched. */
export function unwrapShellCommand(command: string): string | null {
  const wrapper = /^(?:\/bin\/|\/usr\/bin\/)?(?:bash|zsh|sh) -(?:lc|c) (.+)$/s.exec(command);
  if (!wrapper) return null;
  const argument = wrapper[1]!;
  let result = '';
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < argument.length; index++) {
    const char = argument[index]!;
    if (quote === "'") {
      if (char === "'") quote = null;
      else result += char;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '$' || char === '`') return null;
      else if (char === '\\') {
        const next = argument[++index];
        if (next === undefined || !['$', '`', '"', '\\'].includes(next)) return null;
        result += next;
      } else result += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '\\') {
      const next = argument[++index];
      if (next === undefined || next === '\n' || next === '\r') return null;
      result += next;
    } else if (/^[a-zA-Z0-9_@%+=:,./-]$/.test(char)) {
      result += char;
    } else return null;
  }
  return quote === null && !result.includes('\0') ? result : null;
}
