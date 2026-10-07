import { env } from '@/lib/runtime';
import { body, HttpError, json, safe } from '@/lib/security';
import {
  infoContext,
  readInfo,
  mutateInfo,
  readUpload,
  uploadInfo,
  downloadInfo,
} from '@/lib/project-info';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () => {
    const context = await infoContext(request),
      id = new URL(request.url).searchParams.get('file');
    return id ? downloadInfo(context, id) : json(await readInfo(context));
  });
}
export async function POST(request: Request) {
  return safe(async () => {
    const context = await infoContext(request);
    if (new URL(request.url).searchParams.get('upload') === '1') {
      if (
        request.headers.get('origin') !== env.GATHER_ORIGIN ||
        request.headers.get('x-gather-request') !== '1'
      )
        throw new HttpError(403, 'Reload Weft before uploading.');
      return json(await uploadInfo(context, await readUpload(request)));
    }
    return json(await mutateInfo(context, await body(request, 250000)));
  });
}
