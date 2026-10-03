/**
 * Built-in tool catalog.
 *
 * These tools ship inside the server binary and resolve through the capek
 * contributed-tool resolver before the installed-tools directory. Preconfigs
 * reference them by name exactly like external tools; external tools with
 * colliding names are shadowed (built-in wins).
 */

import type { LoadedTool, ToolContext, ToolDefinition, ToolResult } from '@capekai/tool';
import * as browserDiscoverElements from '@/harnesses/prokop/tools/browser-discover-elements/tool';
import * as browserDomAction from '@/harnesses/prokop/tools/browser-dom-action/tool';
import * as browserNavigate from '@/harnesses/prokop/tools/browser-navigate/tool';
import * as browserReadActiveTab from '@/harnesses/prokop/tools/browser-read-active-tab/tool';
import * as browserScreenshot from '@/harnesses/prokop/tools/browser-screenshot/tool';
import * as browserTabManage from '@/harnesses/prokop/tools/browser-tab-manage/tool';
import * as edit from '@/harnesses/prokop/tools/edit/tool';
import * as fileToMarkdown from '@/harnesses/prokop/tools/file-to-markdown/tool';
import * as glob from '@/harnesses/prokop/tools/glob/tool';
import * as grep from '@/harnesses/prokop/tools/grep/tool';
import * as question from '@/harnesses/prokop/tools/question/tool';
import * as readFile from '@/harnesses/prokop/tools/read-file/tool';
import * as shell from '@/harnesses/prokop/tools/shell/tool';
import * as terminal from '@/harnesses/prokop/tools/terminal/tool';
import * as todo from '@/harnesses/prokop/tools/todo/tool';
import * as webfetch from '@/harnesses/prokop/tools/webfetch/tool';
import * as writeFile from '@/harnesses/prokop/tools/write-file/tool';

const BUILTIN_PATH = 'builtin:prokopai';

type BuiltinToolModule = {
  definition: ToolDefinition;
  execute: (input: never, ctx: ToolContext) => Promise<ToolResult>;
};

function toLoadedTool(module: BuiltinToolModule): LoadedTool {
  return {
    definition: module.definition,
    execute: module.execute as unknown as LoadedTool['execute'],
    path: BUILTIN_PATH,
  };
}

const modules = [
  browserDiscoverElements,
  browserDomAction,
  browserNavigate,
  browserReadActiveTab,
  browserScreenshot,
  browserTabManage,
  edit,
  fileToMarkdown,
  glob,
  grep,
  question,
  readFile,
  shell,
  terminal,
  todo,
  webfetch,
  writeFile,
] as const;

export const builtinTools: readonly LoadedTool[] = modules.map(toLoadedTool);

export const builtinToolNames: readonly string[] = builtinTools.map((tool) => tool.definition.name);

export function isBuiltinToolName(name: string): boolean {
  return builtinTools.some((tool) => tool.definition.name === name);
}
