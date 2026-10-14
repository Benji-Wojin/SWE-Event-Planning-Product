import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

test('privacy page renders without authentication, a database, or remote data', async () => {
  const result = await build({
    entryPoints: ['app/privacy/page.tsx'], bundle: true, platform: 'node',
    format: 'esm', write: false, jsx: 'automatic',
    plugins: [{ name: 'privacy-render', setup(b) {
      b.onResolve({ filter: /^react\/jsx-runtime$|^@\/components\/theme-toggle$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents:
        args.path === 'react/jsx-runtime'
          ? 'export const jsx=(type,props)=>typeof type==="function"?type(props):({type,props}),jsxs=jsx;'
          : 'export const ThemeToggle=()=>null;'
      }));
    } }],
  });
  const { default: PrivacyPage, metadata } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree)
    ? tree.flatMap(nodes) : [tree, ...nodes(tree.props.children)];
  const tree = nodes(PrivacyPage());
  assert.equal(tree.filter(n => n.type === 'h1').length, 1);
  assert.match(metadata.title, /Privacy policy/);
  const contacts = tree.filter(n => n.type === 'a' && n.props.href?.startsWith('mailto:'));
  assert.ok(contacts.length >= 3);
  assert.ok(contacts.every(n => n.props.href.split('?')[0] === 'mailto:support@weftplan.com'));
  assert.ok(contacts.some(n => n.props.href === 'mailto:support@weftplan.com?subject=Weft%20privacy%20request'));
  assert.ok(tree.some(n => n.type === 'a' && n.props.href === 'https://myaccount.google.com/connections'));
  const source = await readFile('app/privacy/page.tsx', 'utf8');
  assert.doesNotMatch(source, /getAuthenticatedUser|requireProject|fetch\(|from ['"]@\/auth/);
  for (const statement of ['Benji Wojin', 'Groq', 'unrelated or personal messages', 'handled manually', 'does not delete previously imported', 'Limited Use', 'train general-purpose AI models']) {
    assert.ok(source.includes(statement), statement);
  }
});

test('privacy and support links are reachable from public and connected-account entry points', async () => {
  const links = await readFile('components/privacy-links.tsx', 'utf8');
  assert.match(links, /href="mailto:support@weftplan\.com"/);
  assert.doesNotMatch(links, /gathertemporary@gmail\.com/);
  for (const file of ['components/welcome.tsx', 'app/signup/page.tsx', 'app/signin-with-chatgpt/page.tsx', 'app/settings/settings-client.tsx', 'app/account/account-client.tsx']) {
    assert.match(await readFile(file, 'utf8'), /<PrivacyLinks\s*\/>/, file);
  }
});
