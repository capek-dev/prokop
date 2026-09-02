/**
 * Built-in tool catalog.
 *
 * These tools ship inside the server binary and resolve through the capek
 * contributed-tool resolver before the installed-tools directory. Preconfigs
 * reference them by name exactly like external tools; external tools with
 * colliding names are shadowed (built-in wins).
 */

import type { LoadedTool, ToolContext, ToolDefinition, ToolResult } from '@capekai/tool';
import * as applyPatch from './apply-patch/tool';
import * as browserDiscoverElements from './browser-discover-elements/tool';
import * as browserDomAction from './browser-dom-action/tool';
import * as browserNavigate from './browser-navigate/tool';
import * as browserReadActiveTab from './browser-read-active-tab/tool';
import * as browserScreenshot from './browser-screenshot/tool';
import * as browserTabManage from './browser-tab-manage/tool';
import * as edit from './edit/tool';
import * as editRange from './edit-range/tool';
import * as fileToMarkdown from './file-to-markdown/tool';
import * as gitWorktree from './git-worktree/tool';
import * as glob from './glob/tool';
import * as grep from './grep/tool';
import * as ls from './ls/tool';
import * as multiedit from './multiedit/tool';
import * as question from './question/tool';
import * as readFile from './read-file/tool';
import * as shell from './shell/tool';
import * as tavilySearch from './tavily-search/tool';
import * as terminal from './terminal/tool';
import * as todoRead from './todoread/tool';
import * as todoWrite from './todowrite/tool';
import * as webfetch from './webfetch/tool';
import * as writeFile from './write-file/tool';

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
  applyPatch,
  browserDiscoverElements,
  browserDomAction,
  browserNavigate,
  browserReadActiveTab,
  browserScreenshot,
  browserTabManage,
  edit,
  editRange,
  fileToMarkdown,
  gitWorktree,
  glob,
  grep,
  ls,
  multiedit,
  question,
  readFile,
  shell,
  tavilySearch,
  terminal,
  todoRead,
  todoWrite,
  webfetch,
  writeFile,
] as const;

export const builtinTools: readonly LoadedTool[] = modules.map(toLoadedTool);

export const builtinToolNames: readonly string[] = builtinTools.map((tool) => tool.definition.name);

export function isBuiltinToolName(name: string): boolean {
  return builtinTools.some((tool) => tool.definition.name === name);
}
