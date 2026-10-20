import { generateText, Output, jsonSchema, APICallError } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { GROQ_MODEL, GROQ_CHAT_URL, fitsGroqRequest } from './groq';
import {
  parsePlanOutput,
  planRequestBody,
  PlanProviderError,
  type PlanOutput,
} from './plan-generation';
import { taskConversation } from './task-conversation';

export function validateTaskProposal(
  value: unknown,
  clarified: boolean,
): PlanOutput {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !['items', 'questions', 'assumptions', 'work'].includes(key),
    )
  )
    throw new Error('Invalid assistant response.');
  const { work, ...proposal } = value as any;
  const result = parsePlanOutput(proposal, true);
  if (work != null) {
    if (
      work.kind === 'none' &&
      Object.keys(work).sort().join(',') === 'content,kind,title' &&
      work.title === '' &&
      work.content === ''
    )
      return validateTaskProposal(proposal, clarified);
    if (
      typeof work !== 'object' ||
      Array.isArray(work) ||
      Object.keys(work).sort().join(',') !== 'content,kind,title' ||
      !['written_draft', 'cannot_execute'].includes(work.kind) ||
      typeof work.title !== 'string' ||
      !work.title.trim() ||
      work.title.length > 180 ||
      typeof work.content !== 'string' ||
      !work.content.trim() ||
      work.content.length > 6000 ||
      result.items.length ||
      result.questions.length
    )
      throw new Error('Invalid work draft.');
    // A limitation is product-owned copy, never a model-authored claim of execution.
    result.work =
      work.kind === 'cannot_execute'
        ? {
            kind: 'cannot_execute',
            title: 'That needs a person or a connected tool',
            content:
              'I cannot browse, inspect files, contact people, send messages, book, buy, run code, verify real-world work, or mark tasks complete. I can write a draft announcement, checklist, agenda or task brief here, or propose tasks for you to review. Tell me which written piece would help.',
          }
        : work;
  }
  if (
    result.items.length > 5 ||
    result.questions.length > 1 ||
    (clarified && result.questions.length) ||
    (result.questions.length && result.items.length) ||
    result.items.some(
      (item) =>
        item.kind !== 'preparation' ||
        item.start ||
        item.end ||
        item.location ||
        item.dependsOn.length,
    )
  )
    throw new Error('Invalid task proposal.');
  return result;
}
export async function generateTaskProposal(
  context: any,
  apiKey: string,
): Promise<PlanOutput> {
  const conversation = taskConversation(context.brief.description);
  const clarified = conversation.some(
    (message) => message.role === 'assistant',
  );
  const body = planRequestBody(context);
  const outputSchema = body.response_format.json_schema.schema;
  try {
    const result = await generateText({
      model: createGroq({
        apiKey,
        fetch: async (url, options) => {
          if (String(url) !== GROQ_CHAT_URL)
            throw new PlanProviderError('provider');
          const request = JSON.parse(String(options?.body));
          if (
            !fitsGroqRequest({
              ...request,
              max_completion_tokens: request.max_tokens,
            })
          )
            throw new PlanProviderError('context_limit');
          const response = await fetch(url, options);
          if (response.ok) {
            const data: any = await response
              .clone()
              .json()
              .catch(() => null);
            const choice = data?.choices?.length === 1 ? data.choices[0] : null;
            if (
              choice?.finish_reason !== 'stop' ||
              choice.message?.role !== 'assistant' ||
              choice.message.refusal ||
              choice.message.tool_calls?.length ||
              typeof choice.message.content !== 'string' ||
              choice.message.content.length > 96000
            )
              throw new PlanProviderError('provider');
          }
          return response;
        },
      })(GROQ_MODEL),
      system: body.messages[0].content,
      prompt: JSON.stringify({
        ...context,
        brief: { ...context.brief, description: undefined },
        conversation,
      }),
      output: Output.object({
        name: 'task_creation_proposal',
        schema: jsonSchema<PlanOutput>(outputSchema as any, {
          validate: (value) => {
            try {
              return {
                success: true,
                value: validateTaskProposal(value, clarified),
              };
            } catch {
              return {
                success: false,
                error: new Error('Invalid task proposal.'),
              };
            }
          },
        }),
      }),
      providerOptions: { groq: { reasoningEffort: 'low' } },
      maxOutputTokens: 2000,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(40000),
    });
    if (result.finishReason !== 'stop' || result.toolCalls.length)
      throw new Error('Incomplete task proposal.');
    return validateTaskProposal(result.output, clarified);
  } catch (error) {
    if (error instanceof PlanProviderError) throw error;
    if (APICallError.isInstance(error))
      throw new PlanProviderError(
        error.statusCode === 429
          ? 'rate_limit'
          : [401, 403].includes(error.statusCode || 0)
            ? 'credentials'
            : 'provider',
      );
    throw new PlanProviderError('provider');
  }
}
