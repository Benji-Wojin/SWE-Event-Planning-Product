import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

let Setup;
before(async () => {
  const result = await build({
    entryPoints: ['app/setup/page.tsx'], bundle: true, write: false,
    platform: 'node', format: 'esm', jsx: 'automatic',
    plugins: [{ name: 'setup-boundaries', setup(b) {
      b.onResolve({ filter: /^@\/|^next\/navigation$|^react\/jsx-runtime$|^\.\/setup-client$/ },
        args => ({ path: args.path, namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'js', contents:
        args.path === '@/app/chatgpt-auth'
          ? 'export async function requireChatGPTUser(path) { globalThis.__setupReturn=path; if(!globalThis.__setupSignedIn) throw {redirect:"/signin-with-chatgpt?return_to="+encodeURIComponent(path)}; }'
        : args.path === '@/lib/security'
          ? 'export class HttpError extends Error { constructor(status){super("fixture");this.status=status;} } export async function principal(){ if(globalThis.__setupStatus) throw new HttpError(globalThis.__setupStatus); return {role:"member"}; }'
        : args.path === 'next/navigation'
          ? 'export function redirect(path){throw {redirect:path};}'
        : args.path === 'react/jsx-runtime'
          ? 'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";'
        : args.path === './setup-client'
          ? 'export const ProjectSetup="project-setup";'
          : 'export const ThemeToggle="theme-toggle";'
      }));
    }}],
  });
  ({ default: Setup } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')));
});
async function render(params = {}) {
  const node = await Setup({searchParams: Promise.resolve(params)});
  return node.type(node.props);
}
test('setup deep links require login, then registration, while preserving the destination', async () => {
  try {
    globalThis.__setupSignedIn = false;
    globalThis.__setupStatus = 403;
    await assert.rejects(render(), error => error.redirect === '/signin-with-chatgpt?return_to=%2Fsetup');
    globalThis.__setupSignedIn = true;
    await assert.rejects(render(), error => error.redirect === '/signup?return_to=%2Fsetup');
    const path = '/setup?project=p_test';
    await assert.rejects(render({project:'p_test'}), error => error.redirect === '/signup?return_to=' + encodeURIComponent(path));
    assert.equal(globalThis.__setupReturn, path);
    globalThis.__setupStatus = 0;
    assert.equal((await render()).type, 'main'); // Ordinary members may create projects.
    globalThis.__setupStatus = 500;
    await assert.rejects(render(), error => error.status === 500 && !error.redirect);
  } finally {
    delete globalThis.__setupSignedIn;
    delete globalThis.__setupStatus;
    delete globalThis.__setupReturn;
  }
});
