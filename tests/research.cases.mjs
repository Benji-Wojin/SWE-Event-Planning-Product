import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
export function researchTests(d) {
  const created = [];
  afterEach(() => {
    for (const id of created.splice(0))
      d.sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);
  });
  const setup = () => {
    d.owner();
    const id = 'p_' + crypto.randomUUID();
    created.push(id);
    d.sqlite
      .prepare(
        'INSERT INTO projects (id,owner_id,request_payload,created_at) VALUES (?,?,?,?)',
      )
      .run(id, 'owner-1', '{}', new Date().toISOString());
    return '?project=' + id;
  };
  const get = (q) =>
    d.api.GET(new Request('https://gather.example/api/research' + q));
  const post = (q, v) => d.api.POST(d.request('/api/research' + q, v));
  const input = (
    revision = '',
    query = 'Public park rain planning checklist',
  ) => ({
    query,
    revision,
    requestId: crypto.randomUUID(),
    consent: true,
    consentVersion: 'groq-research-v1',
  });
  const fixture = () => ({
    status: 'completed',
    output: [
      { type: 'web_search_call', status: 'completed' },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Check the official forecast and prepare a rain plan.',
            annotations: [
              {
                type: 'url_citation',
                url: 'https://www.weather.gov/safety/',
                title: 'Weather safety',
                start_index: 0,
                end_index: 5,
              },
            ],
          },
        ],
      },
    ],
  });
  test('research is private per member and revocation during a provider call blocks the result', async () => {
    const q = setup(),
      project = q.slice(9),
      member = 'research-' + crypto.randomUUID();
    d.sqlite
      .prepare(
        'INSERT INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)',
      )
      .run(
        member,
        'u_' + member,
        member + '@example.com',
        'Fictional researcher',
        'member',
      );
    d.sqlite
      .prepare(
        'INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at) VALUES (?,?,?,?,?,?)',
      )
      .run(
        member,
        project,
        member,
        'u_' + member,
        'fixture',
        new Date().toISOString(),
      );
    const oldFetch = globalThis.fetch;
    let release;
    d.env.GROQ_API_KEY = 'fixture';
    d.env.GROQ_WEB_SEARCH_ENABLED = 'verified';
    globalThis.fetch = async () => {
      await new Promise((resolve) => (release = resolve));
      return Response.json(fixture());
    };
    try {
      globalThis.__gatherUser = {
        userId: member,
        email: member + '@example.com',
        displayName: 'Fictional researcher',
      };
      const pending = post(q, input());
      while (!release) await new Promise((resolve) => setImmediate(resolve));
      d.owner();
      assert.equal((await (await get(q)).json()).status, 'empty');
      d.sqlite
        .prepare(
          'UPDATE project_members SET revoked_at=?,revision=revision+1 WHERE id=?',
        )
        .run(new Date().toISOString(), member);
      release();
      assert.equal((await pending).status, 403);
      globalThis.__gatherUser = {
        userId: member,
        email: member + '@example.com',
        displayName: 'Fictional researcher',
      };
      assert.equal((await get(q)).status, 404);
    } finally {
      globalThis.fetch = oldFetch;
      d.owner();
      delete d.env.GROQ_API_KEY;
      delete d.env.GROQ_WEB_SEARCH_ENABLED;
    }
  });
  test('research requires explicit consent and a verified operator gate; GET never calls a provider', async () => {
    const q = setup(),
      oldFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw Error('unexpected');
    };
    try {
      delete d.env.GROQ_WEB_SEARCH_ENABLED;
      delete d.env.GROQ_API_KEY;
      assert.equal((await (await get(q)).json()).configured, false);
      assert.equal((await post(q, { ...input(), consent: false })).status, 400);
      assert.equal((await post(q, input())).status, 503);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
  test('research sends only explicit question, encrypts actor-private results, reconciles retries and isolates projects', async () => {
    const q = setup(),
      q2 = setup(),
      oldFetch = globalThis.fetch;
    let calls = 0,
      sent;
    d.env.GROQ_API_KEY = 'fictional-test-key';
    d.env.GROQ_WEB_SEARCH_ENABLED = 'verified';
    globalThis.fetch = async (url, options) => {
      calls++;
      sent = JSON.parse(options.body);
      assert.equal(url, 'https://api.groq.com/openai/v1/responses');
      return Response.json(fixture());
    };
    try {
      const v = input(),
        response = await post(q, v);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.sources.length, 1);
      assert.equal(calls, 1);
      assert.deepEqual(JSON.parse(sent.input), { question: v.query });
      assert.ok(!JSON.stringify(sent).includes('Fictional school'));
      assert.equal(sent.tools[0].type, 'browser_search');
      assert.equal((await post(q, v)).status, 200);
      assert.equal(calls, 1);
      assert.equal(
        (await post(q, { ...v, query: 'Changed question' })).status,
        409,
      );
      assert.equal((await post(q, input('stale'))).status, 409);
      assert.equal(calls, 1);
      assert.equal((await (await get(q2)).json()).answer, '');
      const stored = d.sqlite
        .prepare('SELECT payload FROM task_resources WHERE lease=?')
        .all(result.revision);
      assert.equal(stored.length, 1);
      assert.ok(stored.every((row) => !row.payload.includes(v.query)));
      assert.match(stored[0].payload, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
      const newer = input(result.revision, 'A second public question');
      d.sqlite
        .prepare(
          "UPDATE task_resources SET started_at=0,status='loading' WHERE lease=?",
        )
        .run(result.revision);
      assert.equal((await (await get(q)).json()).status, 'interrupted');
      assert.equal((await (await post(q, v)).json()).status, 'interrupted');
      assert.equal(calls, 1);
      assert.equal((await post(q, newer)).status, 200);
      assert.equal((await post(q, v)).status, 409);
      assert.equal(calls, 2);
      const latest = await (await get(q)).json();
      d.sqlite
        .prepare('UPDATE task_resources SET expires_at=0 WHERE lease=?')
        .run(latest.revision);
      assert.equal((await (await get(q)).json()).answer, '');
      assert.equal(
        d.sqlite
          .prepare('SELECT payload FROM task_resources WHERE lease=?')
          .get(latest.revision).payload,
        '',
      );
      assert.equal((await post(q, newer)).status, 409);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = oldFetch;
      delete d.env.GROQ_API_KEY;
      delete d.env.GROQ_WEB_SEARCH_ENABLED;
    }
  });
  test('research rejects uncited responses without retrying or changing workspace; receipt cannot resend', async () => {
    const q = setup(),
      oldFetch = globalThis.fetch;
    let calls = 0;
    d.env.GROQ_API_KEY = 'fixture';
    d.env.GROQ_WEB_SEARCH_ENABLED = 'verified';
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ status: 'completed', output: [] });
    };
    try {
      const v = input(),
        r = await post(q, v);
      assert.equal(r.status, 503);
      assert.equal(calls, 1);
      assert.equal((await (await post(q, v)).json()).status, 'error');
      assert.equal(calls, 1);
      assert.equal(
        d.sqlite
          .prepare('SELECT data FROM workspaces WHERE id=?')
          .get(q.slice(9)),
        undefined,
      );
    } finally {
      globalThis.fetch = oldFetch;
      delete d.env.GROQ_API_KEY;
      delete d.env.GROQ_WEB_SEARCH_ENABLED;
    }
  });
  test('research CAS allows one concurrent attempt; quota and revoked access fail closed', async () => {
    const q = setup(),
      oldFetch = globalThis.fetch;
    let calls = 0,
      release;
    d.env.GROQ_API_KEY = 'fixture';
    d.env.GROQ_WEB_SEARCH_ENABLED = 'verified';
    globalThis.fetch = async () => {
      calls++;
      await new Promise((resolve) => (release = resolve));
      return Response.json(fixture());
    };
    try {
      const first = post(q, input());
      while (!release) await new Promise((resolve) => setImmediate(resolve));
      const second = await post(q, input());
      assert.equal(second.status, 409);
      assert.equal(calls, 1);
      release();
      assert.equal((await first).status, 200);
      const result = await (await get(q)).json();
      d.sqlite
        .prepare('UPDATE task_resources SET started_at=0 WHERE lease=?')
        .run(result.revision);
      const quota = 'owner-1:' + new Date().toISOString().slice(0, 10);
      d.sqlite
        .prepare(
          'INSERT INTO resource_usage (id,count) VALUES (?,25) ON CONFLICT(id) DO UPDATE SET count=25',
        )
        .run(quota);
      assert.equal((await post(q, input(result.revision))).status, 409);
      assert.equal(calls, 1);
      d.sqlite.prepare('DELETE FROM projects WHERE id=?').run(q.slice(9));
      assert.equal((await get(q)).status, 404);
      d.sqlite.prepare('DELETE FROM resource_usage WHERE id=?').run(quota);
    } finally {
      globalThis.fetch = oldFetch;
      delete d.env.GROQ_API_KEY;
      delete d.env.GROQ_WEB_SEARCH_ENABLED;
    }
  });
}
