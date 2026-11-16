import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';

let Setup;
before(async () => {
  const result = await build({
    entryPoints: ['app/setup/page.tsx'], bundle: true, write: false,
    platform: 'node', format: 'esm', jsx: 'automatic',
    plugins: [{ name: 'setup-boundaries', setup(b) {
      b.onResolve({ filter: /^@\/lib\/(?:project-access|workspace-task-link)$/ },
        args => ({ path: resolve(args.path.slice(2) + '.ts') }));
      b.onResolve({ filter: /^\.\/security$/ }, args =>
        args.importer.endsWith('/lib/project-access.ts') ? { path: '@/lib/security', namespace: 'mock' } : null);
      b.onResolve({ filter: /^@\/|^next\/navigation$|^react\/jsx-runtime$|^\.\/setup-client$/ },
        args => ({ path: args.path, namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'js', contents:
        args.path === '@/app/chatgpt-auth'
          ? 'export async function requireChatGPTUser(path) { globalThis.__setupReturn=path; if(!globalThis.__setupSignedIn) throw {redirect:"/signin-with-chatgpt?return_to="+encodeURIComponent(path)}; }'
        : args.path === '@/lib/security'
          ? 'export class HttpError extends Error { constructor(status){super("fixture");this.status=status;} } export async function principal(){ if(globalThis.__setupStatus) throw new HttpError(globalThis.__setupStatus); return {role:"member"}; }'
        : args.path === '@/lib/runtime'
          ? 'export const env={};'
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

const project = 'p_12345678-1234-4234-8234-123456789abc';
const task = 'fictional-event-activity';
function findSetup(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'project-setup') return node;
  for (const child of Array.isArray(node) ? node : [node.props?.children]) {
    const found = findSetup(child);
    if (found) return found;
  }
  return null;
}
test('setup carries only a scoped, validated schedule continuation through sign-in and account setup', async () => {
  const expected = `/setup?project=${project}&scheduleTask=${task}&guide=1`;
  const params = { project, scheduleTask: task, guide: '1', return_to: 'https://outside.example.test/' };
  try {
    globalThis.__setupSignedIn = false;
    globalThis.__setupStatus = 403;
    await assert.rejects(render(params), error => error.redirect === '/signin-with-chatgpt?return_to=' + encodeURIComponent(expected));
    globalThis.__setupSignedIn = true;
    await assert.rejects(render(params), error => error.redirect === '/signup?return_to=' + encodeURIComponent(expected));
    assert.equal(globalThis.__setupReturn, expected);
    globalThis.__setupStatus = 0;
    assert.deepEqual(findSetup(await render(params))?.props, { projectId: project, guided: false, scheduleTask: task, resumeGuide: true });
    assert.equal(findSetup(await render({ project, scheduleTask: task }))?.props.resumeGuide, false);
    assert.equal(globalThis.__setupReturn, `/setup?project=${project}&scheduleTask=${task}`);
    assert.equal(findSetup(await render({ guide: '1' }))?.props.guided, true, 'first-project guided setup stays available');
    assert.equal(globalThis.__setupReturn, '/setup?guide=1');
  } finally {
    delete globalThis.__setupSignedIn;
    delete globalThis.__setupStatus;
    delete globalThis.__setupReturn;
  }
});

test('invalid or repeated setup hints cannot introduce a task or arbitrary return destination', async () => {
  try {
    globalThis.__setupSignedIn = true;
    for (const params of [
      { project, scheduleTask: ['other-task',task], guide: '1' },
      { project, scheduleTask: 'a&review=owner', guide: '1' },
      { project: 'p_not-a-real-scope', scheduleTask: task, guide: '1' },
      { project: [project,'main'], scheduleTask: task, guide: '1' },
      { scheduleTask: task, guide: '1' },
    ]) {
      const props = findSetup(await render({ ...params, next: 'https://outside.example.test/', from: 'plan-receipt' }))?.props;
      assert.equal(props.scheduleTask, '', JSON.stringify(params));
      assert.equal(props.resumeGuide, false, JSON.stringify(params));
      assert.doesNotMatch(globalThis.__setupReturn,/scheduleTask=|next=|from=|outside\.example/);
    }
    const repeatedGuide = findSetup(await render({ project, scheduleTask:task, guide:['1','0'] }))?.props;
    assert.equal(repeatedGuide.scheduleTask,task);
    assert.equal(repeatedGuide.resumeGuide,false);
    assert.equal(globalThis.__setupReturn,`/setup?project=${project}&scheduleTask=${task}`);
  } finally {
    delete globalThis.__setupSignedIn;
    delete globalThis.__setupStatus;
    delete globalThis.__setupReturn;
  }
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
