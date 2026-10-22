import { env } from '@/lib/runtime';
import { HttpError, unseal } from './security';
import { assertProjectAccess, type ProjectUser } from './project-access';

// Shared-file metadata has an independent revision. Bind its validation to the
// eventual workspace write, so an intervening archive cannot race the save.
export async function completionFiles(
  scope: string,
  input: any,
  authorization?: ProjectUser,
) {
  if (
    !['reportCompletion', 'setCompletionEvidence'].includes(input.method) ||
    !input.args?.[1] ||
    typeof input.args[1] !== 'object'
  )
    return null;
  let details;
  try {
    details = (globalThis as any).GatherStore.normalizeCompletionEvidence(
      input.args[1],
    );
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Invalid completion details.',
    );
  }
  if (!details.fileIds.length) return null;
  await assertProjectAccess(authorization);
  const row = await env.DB.prepare(
    'SELECT payload,revision FROM project_info WHERE scope=?',
  )
    .bind(scope)
    .first<any>();
  if (!row)
    throw new HttpError(400, 'Choose an active shared file from this project.');
  const state = await unseal(row.payload, 'info:' + scope);
  if (
    details.fileIds.some(
      (id: string) =>
        !state.files?.some((file: any) => file.id === id && !file.archivedAt),
    )
  )
    throw new HttpError(400, 'Choose an active shared file from this project.');
  await assertProjectAccess(authorization);
  return { scope, revision: row.revision };
}
