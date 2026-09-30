/**
 * Built-in tool catalog.
 *
 * These tools ship inside the server binary and resolve through the capek
 * contributed-tool resolver before the installed-tools directory. Preconfigs
 * reference them by name exactly like external tools; external tools with
 * colliding names are shadowed (built-in wins).
 */

import type { LoadedTool, ToolContext, ToolDefinition, ToolResult } from '@capekai/tool';
import * as browserDiscoverElements from '@/tools/builtin/browser-discover-elements/tool';
import * as browserDomAction from '@/tools/builtin/browser-dom-action/tool';
import * as browserNavigate from '@/tools/builtin/browser-navigate/tool';
import * as browserReadActiveTab from '@/tools/builtin/browser-read-active-tab/tool';
import * as browserScreenshot from '@/tools/builtin/browser-screenshot/tool';
import * as browserTabManage from '@/tools/builtin/browser-tab-manage/tool';
import * as edit from '@/tools/builtin/edit/tool';
import * as fileToMarkdown from '@/tools/builtin/file-to-markdown/tool';
import * as glob from '@/tools/builtin/glob/tool';
import * as grep from '@/tools/builtin/grep/tool';
import * as question from '@/tools/builtin/question/tool';
import * as readFile from '@/tools/builtin/read-file/tool';
import * as shell from '@/tools/builtin/shell/tool';
import * as tavilySearch from '@/tools/builtin/tavily-search/tool';
import * as terminal from '@/tools/builtin/terminal/tool';
import * as todo from '@/tools/builtin/todo/tool';
import * as webfetch from '@/tools/builtin/webfetch/tool';
import * as writeFile from '@/tools/builtin/write-file/tool';

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
  tavilySearch,
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
