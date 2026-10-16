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
test('invitation states remain textual, distinct and recoverable with scanable badges', () => {
  const expected = {sent:'Email accepted',sending:'Sending…',unknown:'Sending not confirmed',failed:'Not sent',none:'In-app only · Email not sent'};
  for (const [status,label] of Object.entries(expected)) {
    const team={name:'QA event',projectId:'p_test',members:[],owner:{name:'QA',email:'qa@example.com'},sender:{connected:true,configured:true,email:'invites@weft.example'},
      invitations:[{id:'i_test',email:'person@example.com',expiresAt:1792200000000,delivery:{status,sentAt:1792100000000,sender:'invites@weft.example',canRetry:['none','failed'].includes(status),issue:status==='failed'?'Fictional provider failure.':''}}]};
    const {tree}=render(TeamClient,{projectId:'p_test'},[team,'','',false,'']);
    const badge=tree.find(n=>n.props.className==='invitation-status');
    assert.equal(badge.props['data-delivery'],status);assert.equal(text(badge),label);
    assert.ok(tree.some(n=>n.props.role==='status'&&text(n).includes(label)));
    const retry=tree.find(n=>n.type==='button'&&['Retry sending','Send invitation email'].includes(text(n)));
    assert.equal(Boolean(retry),['none','failed'].includes(status));
    if(status==='sent')assert.match(tree.map(text).join(''),/inbox delivery is not guaranteed/);
    if(status==='failed')assert.match(tree.map(text).join(''),/Fictional provider failure/);
  }
  delete globalThis.__selfserviceState;
});
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
      (n) => n.type === 'button' && text(n) === 'Invite in Weft',
    );
    assert.equal(submit.props.disabled, false);
    assert.doesNotMatch(
      tree.map(text).join(''),
      /Connect invitation Gmail|Optional email delivery/,
    );
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
test('inviting sends email by default and reports the durable delivery result', async () => {
  const previous = globalThis.fetch;
  const team = { name: 'QA event', projectId: 'p_test', owner: {name:'Owner',email:'qa@example.com'},
    members: [], invitations: [], sender: {configured:true,connected:true,email:'invites@weft.example'} };
  try {
    for (const status of ['sent', 'failed', 'unknown', 'sending']) {
      const rendered = render(TeamClient, {projectId:'p_test'}, [team,'','person@example.com',false,'']);
      const checkbox = rendered.tree.find(n => n.type === 'input' && n.props.type === 'checkbox');
      assert.equal(checkbox.props.checked, true);
      assert.ok(rendered.tree.some(n => n.type === 'button' && text(n) === 'Invite and send email'));
      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.action, 'sendInvite');
        assert.equal(body.senderEmail, 'invites@weft.example');
        assert.equal(body.email, 'person@example.com');
        return Response.json({...team,invitations:[{id:body.requestId,delivery:{status,issue:'Fixture rejection.'}}]});
      };
      await rendered.tree.find(n => n.type === 'form').props.onSubmit({preventDefault(){}});
      assert.equal(rendered.state[2], '');
      if (status === 'sent') assert.match(rendered.state[4], /email service accepted/);
      if (status === 'sending') assert.match(rendered.state[4], /Sending email/);
      if (status === 'failed' || status === 'unknown') {
        assert.equal(rendered.state[4], '');
        assert.match(rendered.state[1], status === 'failed' ? /email was not sent/ : /could not be confirmed/);
      }
    }
  } finally { globalThis.fetch = previous; delete globalThis.__selfserviceState; }
});
test('explicit in-app-only invite never dispatches email even with a configured sender', async () => {
  const previous = globalThis.fetch;
  const team = { name:'QA', owner:{name:'Owner',email:'owner@example.com'}, members:[],invitations:[],
    sender:{configured:true,connected:true,email:'invites@weft.example'} };
  try {
    const rendered = render(TeamClient,{projectId:'p_test'},[team,'','person@example.com',false,'',false]);
    assert.ok(rendered.tree.some(n => n.type === 'button' && text(n) === 'Invite in Weft'));
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.action, 'invite'); assert.equal(body.senderEmail, undefined);
      return Response.json(team);
    };
    await rendered.tree.find(n => n.type === 'form').props.onSubmit({preventDefault(){}});
    assert.match(rendered.state[4], /No email sent/);
  } finally { globalThis.fetch = previous; delete globalThis.__selfserviceState; }
});
test('lost send response reloads status without dispatching again and keeps the typed address', async () => {
  const previous = globalThis.fetch;
  const team = { name:'QA', owner:{name:'Owner',email:'owner@example.com'}, members:[],invitations:[],
    sender:{configured:true,connected:true,email:'invites@weft.example'} };
  const calls=[];
  try {
    const rendered = render(TeamClient,{projectId:'p_test'},[team,'','person@example.com',false,'']);
    globalThis.fetch = async (url, options) => {
      calls.push(options.method);
      if (options.method === 'POST') throw new Error('Lost response');
      return Response.json({...team,name:'Recovered team'});
    };
    await rendered.tree.find(n => n.type === 'form').props.onSubmit({preventDefault(){}});
    assert.deepEqual(calls,['POST','GET']); assert.equal(rendered.state[0].name,'Recovered team');
    assert.equal(rendered.state[2],'person@example.com');
    assert.match(rendered.state[1],/may have completed.*Reload to check/);
    assert.doesNotMatch(rendered.state[1],/Lost response/);
  } finally { globalThis.fetch = previous; delete globalThis.__selfserviceState; }
});
test('email invite times out safely, checks status, and keeps its request ID for an explicit retry', async (t) => {
  t.mock.timers.enable({apis:['setTimeout']});
  const previous=globalThis.fetch;
  const team={name:'QA',owner:{name:'Owner',email:'owner@example.com'},members:[],invitations:[],
    sender:{configured:true,connected:true,email:'invites@weft.example'}};
  const calls=[];let release;
  try {
    const rendered=render(TeamClient,{projectId:'p_test'},[team,'','person@example.com',false,'']);
    globalThis.fetch=(url,options)=>{
      calls.push(options);
      if(options.method==='POST')return new Promise(resolve=>{release=resolve;});
      return Promise.resolve(Response.json({...team,name:'Recovered status'}));
    };
    const submit=rendered.tree.find(n=>n.type==='form').props.onSubmit;
    const pending=submit({preventDefault(){}});
    assert.equal(rendered.state[3],true);
    t.mock.timers.tick(30001);await pending;
    assert.deepEqual(calls.map(c=>c.method),['POST','GET']);
    assert.equal(calls[0].signal.aborted,true);
    assert.equal(rendered.state[3],false);
    assert.equal(rendered.state[0].name,'Recovered status');
    assert.equal(rendered.state[2],'person@example.com');
    assert.match(rendered.state[1],/may have completed.*Reload to check/);
    release(Response.json({...team,name:'Late old response'}));await settle();
    assert.equal(rendered.state[0].name,'Recovered status');
    globalThis.fetch=async(url,options)=>{calls.push(options);return Response.json(team);};
    await submit({preventDefault(){}});
    assert.equal(JSON.parse(calls[0].body).requestId,JSON.parse(calls[2].body).requestId);
  } finally {globalThis.fetch=previous;delete globalThis.__selfserviceState;}
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

test('signup recovers from a stalled request without retrying or navigating', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = { fetch: globalThis.fetch, window: globalThis.window };
  const calls = [],
    destinations = [];
  try {
    globalThis.window = {
      location: { assign: (url) => destinations.push(url) },
    };
    globalThis.fetch = (url, options) => {
      calls.push({ url, options });
      return new Promise(() => {});
    };
    const { tree, state } = render(CreateAccountButton, { returnTo: '/' });
    tree.find((n) => n.type === 'button').props.onClick();
    assert.equal(state[0], true);
    t.mock.timers.tick(30_001);
    await settle();
    assert.equal(state[0], false, 'the signup button must stop spinning');
    assert.match(state[1], /may have completed.*[Rr]eload/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.signal.aborted, true);
    assert.deepEqual(destinations, []);
  } finally {
    Object.assign(globalThis, previous);
    delete globalThis.__selfserviceState;
  }
});

test('accepting an invite recovers when the response body stalls', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = { fetch: globalThis.fetch, window: globalThis.window };
  const destinations = [];
  let calls = 0;
  try {
    globalThis.window = {
      location: { assign: (url) => destinations.push(url) },
    };
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, json: () => new Promise(() => {}) };
    };
    const invite = {
      id: 'fixture-invite',
      name: 'QA event',
      organizer: 'Organizer',
      expiresAt: Date.now() + 86400000,
    };
    const { tree, state } = render(Invitations, {}, [[invite], '', false, '']);
    tree
      .find((n) => n.type === 'button' && text(n) === 'Join project')
      .props.onClick();
    await settle();
    t.mock.timers.tick(30_001);
    await settle();
    assert.equal(state[3], '', 'the invitation action must stop spinning');
    assert.match(state[1], /may have completed.*[Rr]eload/);
    assert.equal(calls, 1);
    assert.deepEqual(destinations, []);
    assert.equal(state[0].length, 1);
  } finally {
    Object.assign(globalThis, previous);
    delete globalThis.__selfserviceState;
  }
});
