import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
let TeamClient, Invitations, CreateAccountButton;
before(async () => {
  const result = await build({
    stdin: {
      contents:
        "export {TeamClient} from './app/team/team-client'; export {Invitations} from './components/projects/Invitations'; export {CreateAccountButton} from './app/signup/signup-client';",
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    plugins: [
      {
        name: 'ui',
        setup(b) {
          b.onResolve(
            { filter: /^react(?:\/jsx-runtime)?$|^@\/components\/ui\// },
            (args) => ({ path: args.path, namespace: 'mock' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
            loader: 'js',
            contents:
              args.path === 'react'
                ? 'export const useState=v=>globalThis.__selfserviceState(v),useRef=v=>({current:v}),useEffect=()=>{};'
                : args.path === 'react/jsx-runtime'
                  ? 'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";'
                  : 'export const Button="button",Input="input",Label="label";',
          }));
        },
      },
    ],
  });
  ({ TeamClient, Invitations, CreateAccountButton } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(result.outputFiles[0].text).toString('base64')
  ));
});
const text = (n) =>
  typeof n === 'string'
    ? n
    : typeof n === 'number'
      ? String(n)
      : !n || typeof n !== 'object'
        ? ''
        : Array.isArray(n)
          ? n.map(text).join('')
          : text(n.props.children);
const nodes = (n, parents = []) =>
  !n || typeof n !== 'object'
    ? []
    : Array.isArray(n)
      ? n.flatMap((x) => nodes(x, parents))
      : [{ ...n, parents }, ...nodes(n.props.children, [...parents, n.type])];
function render(component, props, values = []) {
  let index = 0;
  const state = [...values];
  globalThis.__selfserviceState = (initial) => {
    const id = index++;
    if (!(id in state)) state[id] = initial;
    return [
      state[id],
      (value) => {
        state[id] = typeof value === 'function' ? value(state[id]) : value;
      },
    ];
  };
  return { tree: nodes(component(props)), state };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
test('in-app invite is available without email delivery and no Gmail setup is offered', async () => {
  const previous = globalThis.fetch,
    calls = [];
  const team = {
    name: 'QA event',
    projectId: 'p_test',
    owner: { name: 'Owner', email: 'qa@example.com' },
    members: [],
    invitations: [],
    sender: { configured: true, connected: false, email: '' },
  };
  try {
    const { tree } = render(TeamClient, { projectId: 'p_test' }, [
      team,
      '',
      'person@example.com',
      false,
      '',
    ]);
    const submit = tree.find(
      (n) => n.type === 'button' && text(n) === 'Invite teammate',
    );
    assert.equal(submit.props.disabled, false);
    assert.doesNotMatch(tree.map(text).join(''), /Connect invitation Gmail|Optional email delivery/);
    assert.match(tree.map(text).join(''), /In-app invitations still work/);
    assert.doesNotMatch(tree.map(text).join(''), /Private site access/);
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return Response.json(team);
    };
    const form = tree.find((n) => n.type === 'form');
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/team?project=p_test');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.action, 'invite');
    assert.equal(body.email, 'person@example.com');
    assert.equal(body.senderEmail, undefined);
  } finally {
    globalThis.fetch = previous;
    delete globalThis.__selfserviceState;
  }
});
test('signup submits no caller identity and repeated clicks issue one guarded request', async () => {
  const previous = { fetch: globalThis.fetch, window: globalThis.window };
  const calls = [],
    destinations = [];
  try {
    globalThis.window = {
      location: { assign: (url) => destinations.push(url) },
    };
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return Response.json({ created: true });
    };
    const { tree } = render(CreateAccountButton, { returnTo: '/' });
    const button = tree.find((n) => n.type === 'button');
    button.props.onClick();
    button.props.onClick();
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/signup');
    assert.equal(calls[0].options.headers['X-Gather-Request'], '1');
    assert.deepEqual(JSON.parse(calls[0].options.body), {});
    assert.deepEqual(destinations, ['/']);
  } finally {
    Object.assign(globalThis, previous);
    delete globalThis.__selfserviceState;
  }
});
test('invitation accept uses its ID once and navigates only after server confirms membership', async () => {
  const previous = { fetch: globalThis.fetch, window: globalThis.window };
  const calls = [],
    destinations = [];
  const invite = {
    id: 'fixture-invite',
    name: 'QA event',
    organizer: 'Organizer',
    expiresAt: Date.now() + 86400000,
  };
  try {
    globalThis.window = {
      location: { assign: (url) => destinations.push(url) },
    };
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return Response.json({ projectId: 'p_confirmed' });
    };
    const { tree } = render(Invitations, {}, [[invite], '', false, '']);
    const button = tree.find(
      (n) => n.type === 'button' && text(n) === 'Join project',
    );
    button.props.onClick();
    button.props.onClick();
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/invitations');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      id: invite.id,
      action: 'accept',
    });
    assert.deepEqual(destinations, ['/project?project=p_confirmed']);
    calls.length = 0;
    destinations.length = 0;
    globalThis.fetch = async () =>
      Response.json({ error: 'Invitation expired.' }, { status: 410 });
    const failed = render(Invitations, {}, [[invite], '', false, '']);
    failed.tree
      .find((n) => n.type === 'button' && text(n) === 'Join project')
      .props.onClick();
    await settle();
    assert.deepEqual(destinations, []);
    assert.equal(failed.state[1], 'Invitation expired.');
    assert.equal(failed.state[0].length, 1);
  } finally {
    Object.assign(globalThis, previous);
    delete globalThis.__selfserviceState;
  }
});
