import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;

export const IGNORED_DIRECTORIES = new Set([
  '.git',
  'build',
  'client-dist',
  'coverage',
  'dev-dist',
  'dist',
  'node_modules',
  'storybook-static',
]);

export type ImportKind =
  | 'value'
  | 'type'
  | 'side-effect'
  | 'export-from'
  | 'export-type'
  | 'dynamic'
  | 'require';

export interface ScannedImport {
  file: string;
  kind: ImportKind;
  specifier: string;
  names: string[];
}

export interface ScannedFile {
  path: string;
  sourceText: string;
}

export interface SpecifierMatcher {
  exact?: string;
  prefix?: string;
  name?: string;
}

export interface DependencyRule {
  name: string;
  rationale: string;
  /** Directories whose files the rule governs. Files not under any of these are skipped. */
  appliesTo: string[];
  /** Raw specifier matchers that are always violations. */
  forbiddenSpecifiers?: SpecifierMatcher[];
  /** Files inside these directories are exempt from the whole rule. */
  allowedInDirs?: string[];
  /**
   * Whitelist mode for relative specifiers resolving inside the package source root.
   * 'own-concern' expands to the appliesTo directory that contains the importing file.
   */
  allowedResolvedDirs?: 'own-concern' | string[];
  /** Blacklist mode for relative specifiers resolving inside the package source root. */
  forbiddenResolvedDirs?: string[];
  /** Exact temporary exceptions: repo-relative file path to allowed specifiers. */
  exceptions?: Record<string, string[]>;
}

export interface RuleResult {
  violations: string[];
  staleExceptions: string[];
}

export function isWithin(path: string, parent: string): boolean {
  const relativePath = relative(parent, path);
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..');
}

export function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    if (IGNORED_DIRECTORIES.has(entry)) {
      continue;
    }

    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectSourceFiles(path));
    } else if (SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))) {
      files.push(path);
    }
  }

  return files;
}

function importKind(declaration: ts.ImportDeclaration): ImportKind {
  if (declaration.importClause === undefined) {
    return 'side-effect';
  }
  if (declaration.importClause.isTypeOnly) {
    return 'type';
  }
  const named = declaration.importClause.namedBindings;
  if (
    named !== undefined
    && ts.isNamedImports(named)
    && named.elements.length > 0
    && named.elements.every((element) => element.isTypeOnly)
  ) {
    return 'type';
  }
  return 'value';
}

function importNames(declaration: ts.ImportDeclaration): string[] {
  const clause = declaration.importClause;
  if (clause === undefined) {
    return [];
  }
  const names: string[] = [];
  if (clause.name !== undefined) {
    names.push(clause.name.text);
  }
  const named = clause.namedBindings;
  if (named !== undefined) {
    if (ts.isNamespaceImport(named)) {
      names.push(named.name.text);
    } else {
      names.push(...named.elements.map((element) => element.propertyName?.text ?? element.name.text));
    }
  }
  return names;
}

function exportKind(declaration: ts.ExportDeclaration): ImportKind {
  if (declaration.isTypeOnly) {
    return 'export-type';
  }
  const clause = declaration.exportClause;
  if (
    clause !== undefined
    && ts.isNamedExports(clause)
    && clause.elements.length > 0
    && clause.elements.every((element) => element.isTypeOnly)
  ) {
    return 'export-type';
  }
  return 'export-from';
}

function exportNames(declaration: ts.ExportDeclaration): string[] {
  const clause = declaration.exportClause;
  if (clause === undefined) {
    return [];
  }
  if (ts.isNamedExports(clause)) {
    return clause.elements.map((element) => element.propertyName?.text ?? element.name.text);
  }
  return [clause.name.text];
}

export function parseImports(sourceText: string, filePath: string): ScannedImport[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: ScannedImport[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        file: filePath,
        kind: importKind(node),
        specifier: node.moduleSpecifier.text,
        names: importNames(node),
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        file: filePath,
        kind: exportKind(node),
        specifier: node.moduleSpecifier.text,
        names: exportNames(node),
      });
    } else if (
      ts.isCallExpression(node)
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport) {
        imports.push({
          file: filePath,
          kind: 'dynamic',
          specifier: node.arguments[0].text,
          names: [],
        });
      } else if (isRequire) {
        imports.push({
          file: filePath,
          kind: 'require',
          specifier: node.arguments[0].text,
          names: [],
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

export function scanFiles(files: ScannedFile[]): ScannedImport[] {
  return files.flatMap((file) => parseImports(file.sourceText, file.path));
}

export function scanDirectory(directory: string): ScannedFile[] {
  return collectSourceFiles(directory).map((path) => ({
    path,
    sourceText: readFileSync(path, 'utf8'),
  }));
}

export function matchesSpecifier(matcher: SpecifierMatcher, imp: ScannedImport): boolean {
  if (matcher.exact !== undefined && imp.specifier !== matcher.exact) {
    return false;
  }
  if (matcher.prefix !== undefined && !imp.specifier.startsWith(matcher.prefix)) {
    return false;
  }
  if (matcher.name !== undefined && !imp.names.includes(matcher.name)) {
    return false;
  }
  return matcher.exact !== undefined || matcher.prefix !== undefined || matcher.name !== undefined;
}

export function resolveLocalSpecifier(specifier: string, filePath: string, sourceRoot: string): string | null {
  if (specifier.startsWith('.')) {
    return resolve(dirname(filePath), specifier);
  }
  if (specifier.startsWith('@/')) {
    return resolve(sourceRoot, specifier.slice(2));
  }
  return null;
}

export function evaluateRules(
  files: ScannedFile[],
  sourceRoot: string,
  repoRoot: string,
  rules: DependencyRule[],
): RuleResult {
  const importsByFile = new Map<string, ScannedImport[]>();
  for (const file of files) {
    importsByFile.set(file.path, parseImports(file.sourceText, file.path));
  }

  const violations: string[] = [];
  const staleExceptions: string[] = [];

  for (const rule of rules) {
    if (rule.allowedResolvedDirs !== undefined && rule.forbiddenResolvedDirs !== undefined) {
      throw new Error(`rule ${rule.name}: allowedResolvedDirs and forbiddenResolvedDirs are mutually exclusive`);
    }

    for (const file of files) {
      const governingDir = rule.appliesTo.find((dir) => isWithin(file.path, dir));
      if (governingDir === undefined) {
        continue;
      }
      if (rule.allowedInDirs?.some((dir) => isWithin(file.path, dir))) {
        continue;
      }

      for (const imp of importsByFile.get(file.path) ?? []) {
        let forbidden = false;

        for (const matcher of rule.forbiddenSpecifiers ?? []) {
          if (matchesSpecifier(matcher, imp)) {
            forbidden = true;
            break;
          }
        }

        if (!forbidden) {
          const resolved = resolveLocalSpecifier(imp.specifier, file.path, sourceRoot);
          if (resolved !== null && isWithin(resolved, sourceRoot)) {
            if (rule.allowedResolvedDirs !== undefined) {
              const allowed = rule.allowedResolvedDirs === 'own-concern'
                ? [governingDir]
                : rule.allowedResolvedDirs;
              if (!allowed.some((dir) => isWithin(resolved, dir))) {
                forbidden = true;
              }
            } else if (rule.forbiddenResolvedDirs !== undefined) {
              if (rule.forbiddenResolvedDirs.some((dir) => isWithin(resolved, dir))) {
                forbidden = true;
              }
            }
          }
        }

        if (!forbidden) {
          continue;
        }

        const repoFile = relative(repoRoot, file.path);
        if (rule.exceptions?.[repoFile]?.includes(imp.specifier)) {
          continue;
        }
        violations.push(`${repoFile} imports ${imp.specifier} (${imp.kind}) [rule: ${rule.name}]`);
      }
    }

    for (const [repoFile, specifiers] of Object.entries(rule.exceptions ?? {})) {
      const filePath = resolve(repoRoot, repoFile);
      const observed = new Set((importsByFile.get(filePath) ?? []).map((imp) => imp.specifier));
      for (const specifier of specifiers) {
        if (!observed.has(specifier)) {
          staleExceptions.push(`${repoFile} -> ${specifier}: exception no longer matches an import [rule: ${rule.name}]`);
        }
      }
    }
  }

  return { violations, staleExceptions };
}
