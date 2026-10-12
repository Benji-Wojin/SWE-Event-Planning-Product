const workspaceSections = new Set([
  'overview', 'tasks', 'inbox', 'updates', 'team', 'info', 'timeline', 'memory', 'details',
]);

/** Add an inherited browser fragment to an already server-validated return path.
 * Never change the destination, overwrite an explicit fragment, or carry arbitrary text.
 */
export function workspaceSignInReturn(returnTo: string, hash: string): string {
  if (!workspaceSections.has(hash.slice(1)) || !hash.startsWith('#') ||
      !returnTo.startsWith('/') || returnTo.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(returnTo)) return returnTo;
  try {
    const url = new URL(returnTo, 'https://app.local');
    if (url.origin !== 'https://app.local' || !['/project', '/demo'].includes(url.pathname) || url.hash) return returnTo;
    return returnTo + hash;
  } catch {
    return returnTo;
  }
}
