const REQUEST_TIMEOUT_MS = 30_000;

// A lost response does not mean a write failed. Never retry mutations here.
export async function accountRequest<T>(
  path: string,
  input?: unknown,
): Promise<T> {
  const writing = input !== undefined;
  const controller = new AbortController();
  const recovery = writing
    ? 'The action may have completed. Reload to check before trying again.'
    : 'Reload and try again.';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Weft took too long to respond. ${recovery}`));
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  });
  const request = async () => {
    let response: Response;
    let data: unknown;
    try {
      response = await fetch(path, {
        method: writing ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: writing
          ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' }
          : {},
        body: writing ? JSON.stringify(input) : undefined,
        signal: controller.signal,
      });
      data = await response.json();
    } catch {
      throw new Error(`Could not reach Weft. ${recovery}`);
    }
    if (!response.ok)
      throw new Error(
        data &&
          typeof data === 'object' &&
          'error' in data &&
          typeof data.error === 'string'
          ? data.error
          : 'Please try again.',
      );
    return data as T;
  };
  try {
    // Bound reading the response body too, even if a transport ignores abort.
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
