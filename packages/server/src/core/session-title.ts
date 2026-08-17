import type { MessageWithParts } from '@jean2/sdk';
import { runTextModel } from '@capekai/core/internal/providers';
import { getModelsConfig, findModel } from '@/config';

const DEFAULT_SESSION_TITLES = new Set(['new session', 'new']);
const MAX_CONTEXT_CHARS = 12000;

const TITLE_SYSTEM_PROMPT = [
  'You are a title generator. You output ONLY a thread title. Nothing else.',
  'Generate a brief title that would help the user find this conversation later.',
  '',
  'Return exactly one XML tag: <title>Concise Topic</title>',
  '',
  'Rules:',
  '- Output ONLY the <title> tag immediately. Do NOT think, reason, or explain first.',
  '- The title must capture what the conversation is ABOUT, not how it starts.',
  '- Concise title, not a sentence. Max 80 characters. No quotes. No trailing punctuation.',
  '- MUST use the same language as the user message.',
  '- When a file is mentioned, focus on WHAT the user wants to do WITH it.',
  '- Vary phrasing — avoid repetitive patterns like always starting with "Analyzing" or "How to".',
  '- Never include tool names (e.g. "shell tool", "edit tool", "bash tool").',
  '- Never mention the user, assistant, conversation, prompt, or title-generation task.',
  '- Keep exact: technical terms, ticket numbers, filenames, HTTP codes.',
  '- Return one title only; do not provide examples, alternatives, lists, or numbering.',
  '- Do not explain your reasoning.',
  '- DO NOT say you cannot generate a title or complain about the input.',
  '- Always output something meaningful, even if the input is minimal.',
  '- If the user message is short or casual (e.g. "hello", "lol", "hey"): create a title that reflects the tone (e.g. Greeting, Quick check-in, Light chat).',
  '',
  'BAD titles (just copying opening words):',
  '"lets start task CAS-1873, where we have to implement landing page from scratch"',
  '  ✗ <title>Lets start task CAS 1873</title>  ← just copied the opening',
  '  ✓ <title>CAS-1873 Landing page implementation</title>  ← captures the actual topic',
  '"can you help me fix the login bug I found yesterday"',
  '  ✗ <title>Can you help me fix</title>  ← just copied opening words',
  '  ✓ <title>Login bug fix</title>  ← captures the actual topic',
  '',
  'Good examples:',
  '"debug 500 errors in production" → <title>Debugging production 500 errors</title>',
  '"refactor user service" → <title>Refactoring user service</title>',
  '"why is app.js failing" → <title>app.js failure investigation</title>',
  '"implement rate limiting" → <title>Rate limiting implementation</title>',
  '"how do I connect postgres to my API" → <title>Postgres API connection</title>',
  '"best practices for React hooks" → <title>React hooks best practices</title>',
  '"@src/auth.ts can you add refresh token support" → <title>Auth refresh token support</title>',
  '"@utils/parser.ts this is broken" → <title>Parser bug fix</title>',
  '"look at @config.json" → <title>Config review</title>',
  '"@App.tsx add dark mode toggle" → <title>Dark mode toggle in App</title>',
  '"hello" → <title>Greeting</title>',
  '"what\'s new in Python 3.13" → <title>Python 3.13 new features</title>',
  '"i think we should probably migrate to postgres" → <title>Postgres migration</title>',
  '"hey so I was thinking, can we add SSO?" → <title>SSO implementation</title>',
].join('\n');

export function isDefaultSessionTitle(title: string | null | undefined): boolean {
  return DEFAULT_SESSION_TITLES.has((title ?? '').trim().toLowerCase());
}

export function hasManualSessionTitle(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.titleManuallyRenamed === true;
}

export function markManualSessionTitle(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    titleManuallyRenamed: true,
  };
}

export async function generateSessionTitle(messages: MessageWithParts[]): Promise<string | null> {
  const conversation = buildConversationText(messages);
  if (!conversation) return null;

  const config = getModelsConfig();
  const providerId = config.defaultProvider || findModel(config.defaultModel)?.providerId;
  const text = await runTextModel({
    modelId: config.defaultModel,
    providerId,
    systemPrompt: TITLE_SYSTEM_PROMPT,
    prompt: `Generate a title for this conversation:\n\n<chat>\n${conversation}\n</chat>`,
    maxOutputTokens: 20000,
    temperature: 0.5,
  });
  const title = normalizeTitle(text);
  if (title) return title;

  console.warn('[session-title] Rejected generated title, using fallback if possible:', text.slice(0, 200));
  return fallbackTitleFromMessages(messages);
}

function buildConversationText(messages: MessageWithParts[]): string {
  const lines: string[] = [];
  for (const item of messages) {
    const text = item.parts
      .filter(part => part.type === 'text')
      .map(part => part.text.trim())
      .filter(Boolean)
      .join('\n');
    if (!text) continue;
    lines.push(`${item.message.role}: ${text}`);
  }
  return lines.join('\n\n').slice(0, MAX_CONTEXT_CHARS).trim();
}

function normalizeTitle(value: string): string | null {
  const xmlTitle = value.match(/<title>(.*?)<\/title>/is)?.[1];
  const candidates = (xmlTitle ? [xmlTitle] : value.split('\n'))
    .map(line => line.replace(/^\s*(title|answer)\s*:\s*/i, '').trim())
    .filter(Boolean);

  if (!xmlTitle && candidates.length !== 1) return null;

  for (const candidate of candidates) {
    const title = cleanTitle(candidate);
    if (title && !isMetaTitle(title)) return title;
  }
  return null;
}

function fallbackTitleFromMessages(messages: MessageWithParts[]): string | null {
  const firstUserText = messages
    .find(item => item.message.role === 'user')
    ?.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join(' ');

  if (!firstUserText) return null;

  const cleaned = firstUserText
    .replace(/[`*_#>\-[\]()]/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  const words = cleaned
    .split(' ')
    .map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
    .slice(0, 6);

  const title = cleanTitle(words.join(' '));
  return title && !isMetaTitle(title) ? title : null;
}

function cleanTitle(value: string): string | null {
  const title = value
    .trim()
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^[-*•]\s*/, '')
    .replace(/^['"`]+|['"`.]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 100)
    .trim();
  return title || null;
}

function isMetaTitle(title: string): boolean {
  const normalized = title.toLowerCase();
  return [
    'user just',
    'user wants',
    'user asked',
    'the user wants',
    'the user asked',
    'assistant wishes',
    'assistant helps',
    'generate a short title',
    'generate a concise',
    'conversation title',
    'this conversation',
    'the prompt',
    'i need to',
    'i should',
  ].some(phrase => normalized.includes(phrase));
}
