import type { ToolDefinition, ToolContext, ToolResult, AskFormResponse } from '@prokopai/sdk';

interface QuestionInput {
  title: string;
  description?: string;
  questions: Array<{
    type: 'single_select';
    question: string;
    description?: string;
    options: Array<{ label: string; value: string; description?: string }>;
  } | {
    type: 'multi_select';
    question: string;
    description?: string;
    options: Array<{ label: string; value: string; description?: string }>;
    min?: number;
    max?: number;
  } | {
    type: 'text';
    question: string;
    description?: string;
    placeholder?: string;
    defaultValue?: string;
  } | {
    type: 'confirm';
    question: string;
    description?: string;
    defaultValue?: boolean;
  }>;
}

export const definition: ToolDefinition = {
  name: 'question',
  capabilities: ['interactive-user-input'],
  description:
    'Ask the user structured questions and get typed answers back as tool results. ' +
    'Use this when you need user input to make decisions, gather preferences, or clarify requirements. ' +
    'Supports multiple question types: single_select (pick one option), multi_select (pick multiple options), ' +
    'text (free text input), and confirm (yes/no). ' +
    'All questions are presented as a single form — user fills them all out and submits once. ' +
    'Returns an array of answers in the same order as the questions.\n\n' +
    'When to use:\n' +
    '- When you need to clarify requirements before proceeding\n' +
    '- When presenting multiple options for the user to choose from\n' +
    '- When gathering preferences or configuration values\n' +
    '- When you need structured, typed data rather than free-form chat input\n\n' +
    'Notes:\n' +
    '- Questions are presented as a form — user must answer all before submitting\n' +
    '- single_select returns a string (the selected value)\n' +
    '- multi_select returns a string[] (array of selected values)\n' +
    '- text returns a string\n' +
    '- confirm returns a boolean\n' +
    '- CRITICAL: Each option within a single_select/multi_select MUST have a unique `value` field. ' +
    'Do NOT use empty strings or duplicate values across options — use distinct machine-readable slugs ' +
    '(e.g., "auth", "database", "api") that differ from each other.',
  display: { summary: '{title}' },
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Title/header for the question form (e.g. "Deployment Configuration")',
      },
      description: {
        type: 'string',
        description: 'Optional description or context shown above the questions',
      },
      questions: {
        type: 'array',
        description: 'Array of questions to ask the user. Each question has a type and type-specific fields.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['single_select', 'multi_select', 'text', 'confirm'],
              description: 'The question type',
            },
            question: {
              type: 'string',
              description: 'The question text shown to the user',
            },
            description: {
              type: 'string',
              description: 'Optional additional context for the question',
            },
            options: {
              type: 'array',
              description: 'Available options (for single_select and multi_select)',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Display label' },
                  value: { type: 'string', description: 'Value returned when selected' },
                  description: { type: 'string', description: 'Optional description of this option' },
                },
                required: ['label', 'value'],
              },
            },
            min: {
              type: 'number',
              description: 'Minimum selections required (multi_select only)',
            },
            max: {
              type: 'number',
              description: 'Maximum selections allowed (multi_select only)',
            },
            placeholder: {
              type: 'string',
              description: 'Placeholder text (text type only)',
            },
            defaultValue: {
              description: 'Default value — string for text, boolean for confirm',
            },
          },
          required: ['type', 'question'],
        },
      },
    },
    required: ['title', 'questions'],
  },
  timeout: 300000,
};

export async function execute(input: QuestionInput, ctx: ToolContext): Promise<ToolResult> {
  try {
    if (!input.questions || input.questions.length === 0) {
      return { success: false, error: 'At least one question is required' };
    }

    if (!input.title || input.title.trim().length === 0) {
      return { success: false, error: 'Title is required' };
    }

    // Validate select-type questions: each option must have a unique, non-empty value
    for (const [qi, q] of input.questions.entries()) {
      if (q.type === 'single_select' || q.type === 'multi_select') {
        const seenValues = new Set<string>();
        const duplicates: string[] = [];
        for (const opt of q.options) {
          const value = (opt.value ?? '').trim();
          if (!value) {
            return {
              success: false,
              error: `Question ${qi + 1} ("${q.question}"): option "${opt.label}" has an empty value. Every option must have a unique, non-empty value field.`,
            };
          }
          if (seenValues.has(value)) {
            duplicates.push(value);
          }
          seenValues.add(value);
        }
        if (duplicates.length > 0) {
          return {
            success: false,
            error: `Question ${qi + 1} ("${q.question}"): duplicate option value(s): ${duplicates.map((v) => `"${v}"`).join(', ')}. Every option must have a unique value field. Fix the duplicates and try again.`,
          };
        }
      }
    }

    ctx.logger.info(`Asking user ${input.questions.length} questions: ${input.title}`);

    const response: AskFormResponse = await ctx.ask({
      target: 'human',
      type: 'form',
      question: input.title,
      description: input.description,
      questions: input.questions,
    });

    return {
      success: true,
      result: {
        title: input.title,
        answers: response.answers.map((a, i) => ({
          question: input.questions[i].question,
          type: input.questions[i].type,
          answer: a.answer,
        })),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`question tool failed: ${message}`);
    return { success: false, error: message };
  }
}
