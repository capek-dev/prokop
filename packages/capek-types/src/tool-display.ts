function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function toDisplayString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function resolveToolSummaryTemplate(
  template: string,
  input: Record<string, unknown>,
): string {
  const resolved = template.replace(/\{([\w.]+)\}/g, (_match, path: string) => {
    let value: unknown = input;
    for (const key of path.split('.')) {
      if (value === null || typeof value !== 'object') return '';
      value = (value as Record<string, unknown>)[key];
    }
    return toDisplayString(value) ?? '';
  });
  return resolved.replace(/\s+/g, ' ').trim();
}

export function resolveToolSummary(
  input: Record<string, unknown>,
  template?: string,
): string {
  if (template) {
    return truncate(resolveToolSummaryTemplate(template, input), 120);
  }

  try {
    const json = JSON.stringify(input);
    if (json === '{}') return '';
    return json.length > 50 ? `${json.slice(0, 47)}...` : json;
  } catch {
    return truncate(String(input), 50);
  }
}
