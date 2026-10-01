// Imported into the server harness so all integration checks use real SQL and encryption.
export function gmailAutomaticTests({
  test,
  assert,
  sqlite,
  db,
  owner,
  request,
  security,
  gmailApi,
  gmailCore,
  automaticCore,
  automaticApi,
  classifierCore,
  newTeamProject,
}) {
  const mailbox = 'organizer@example.com';
  const realFetch = globalThis.fetch;
  let project;
  async function fixture() {
    owner();
    globalThis.__gatherEnv.OPENAI_API_KEY = 'fixture-only-key';
    globalThis.__gatherEnv.GMAIL_BACKGROUND_MODE = 'owner-private';
    for (const table of [
      'gmail_automation',
      'gmail_receipts',
      'resource_usage',
    ])
      sqlite.prepare('DELETE FROM ' + table).run();
    sqlite
      .prepare(
        "DELETE FROM mail_messages WHERE provider_id LIKE 'organizer@example.com:%'",
      )
      .run();
    project = await newTeamProject('Cedar conference');
    const payload = await security.seal(
      {
        email: mailbox,
        accessToken: 'pinned-token',
        refreshToken: 'fixture-refresh',
        expiresAt: Date.now() + 3600000,
      },
      'gmail:owner-1',
    );
    sqlite
      .prepare(
        'INSERT OR REPLACE INTO gmail_connections (user_id,payload,generation) VALUES (?,?,?)',
      )
      .run('owner-1', payload, 'auto-connection');
    await automaticCore.configureAutomatic('owner-1', {
      enabled: true,
      consent: true,
      projectIds: [project],
    });
  }
  const due = () =>
    sqlite
      .prepare('UPDATE gmail_automation SET next_run=0,lease_until=0')
      .run();
  const state = async () =>
    security.unseal(
      sqlite
        .prepare('SELECT payload FROM gmail_automation WHERE user_id=?')
        .get('owner-1').payload,
      'gmail-auto:owner-1',
    );
  const privateRows = () =>
    sqlite
      .prepare(
        "SELECT * FROM mail_messages WHERE provider_id LIKE 'organizer@example.com:%'",
      )
      .all();
  const rawMessage = (id, labels = ['INBOX']) => ({
    id,
    threadId: 'thread-' + id,
    labelIds: labels,
    internalDate: String(Date.now()),
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: mailbox },
        { name: 'To', value: mailbox },
        { name: 'Subject', value: 'Cedar conference catering' },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: {
            data: Buffer.from(
              'Cedar conference menu approved. Private reference ABC987.',
            ).toString('base64url'),
          },
        },
      ],
    },
  });
  const suggestion = (id, relevance = 'match') => ({
    id,
    relevance,
    projectId: relevance === 'unrelated' ? '' : project,
    taskId: '',
    title: relevance === 'unrelated' ? '' : 'Catering confirmed',
    summary: relevance === 'unrelated' ? '' : 'The caterer confirmed the menu.',
    reason: relevance === 'unrelated' ? '' : 'Names this conference.',
  });
  const aiResponse = (values) =>
    Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: JSON.stringify({ messages: values }) },
          ],
        },
      ],
    });
  function provider({
    ids = ['self'],
    labelById = {},
    classify,
    history,
    list,
    onMessage,
  } = {}) {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push(String(url));
      if (url === 'https://api.openai.com/v1/responses') {
        const payload = JSON.parse(options.body),
          input = JSON.parse(payload.input);
        assert.equal(payload.store, false);
        assert.equal(payload.tools, undefined);
        assert.equal(payload.text.format.strict, true);
        assert.deepEqual(
          input.projects.map((p) => p.id),
          [project],
        );
        assert.ok(!JSON.stringify(input.projects).includes('ABC987'));
        return classify
          ? classify(input)
          : aiResponse(input.messages.map((m) => suggestion(m.id)));
      }
      assert.equal(options.headers.Authorization, 'Bearer pinned-token');
      const parsed = new URL(url),
        path = parsed.pathname.split('/users/me/')[1];
      if (path === 'profile')
        return Response.json({ emailAddress: mailbox, historyId: '100' });
      if (path === 'messages')
        return list
          ? list(parsed)
          : Response.json({ messages: ids.map((id) => ({ id })) });
      if (path === 'history')
        return history ? history(parsed) : Response.json({ historyId: '200' });
      if (path.startsWith('messages/')) {
        const id = path.split('/')[1];
        if (onMessage) await onMessage(id);
        return Response.json(rawMessage(id, labelById[id] || ['INBOX']));
      }
      throw new Error('Unexpected provider request');
    };
    return calls;
  }
  const scopedMessages = () =>
    gmailApi.GET(
      new Request(
        'https://gather.example/api/gmail/messages?project=' + project,
      ),
    );

  test('automatic email detection requires separate consent, selected ownership and configured AI; pause needs no provider access', async () => {
    await fixture();
    await automaticCore.configureAutomatic('owner-1', { enabled: false });
    await assert.rejects(
      automaticCore.configureAutomatic('owner-1', {
        enabled: true,
        projectIds: [project],
      }),
    );
    await assert.rejects(
      automaticCore.configureAutomatic('owner-1', {
        enabled: true,
        consent: true,
        projectIds: ['missing'],
      }),
    );
    delete globalThis.__gatherEnv.OPENAI_API_KEY;
    await assert.rejects(
      automaticCore.configureAutomatic('owner-1', {
        enabled: true,
        consent: true,
        projectIds: [project],
      }),
    );
    assert.equal(
      (await automaticCore.automaticStatus('owner-1')).enabled,
      false,
    );
    globalThis.__gatherUser = null;
    assert.equal(
      (
        await gmailApi.POST(
          request('/api/gmail/automatic', {
            enabled: true,
            consent: true,
            projectIds: [project],
          }),
        )
      ).status,
      401,
    );
    owner();
    globalThis.fetch = realFetch;
  });

  test('self-sent and archived incoming emails get private AI drafts; unrelated mail and originals never enter the shared plan', async () => {
    await fixture();
    const originalWorkspace = sqlite
      .prepare('SELECT data FROM workspaces WHERE id=?')
      .get(project).data;
    provider({
      ids: ['self', 'archived', 'noise', 'spam', 'draft'],
      labelById: {
        self: ['SENT', 'INBOX'],
        archived: [],
        spam: ['SPAM'],
        draft: ['DRAFT'],
      },
      classify: (input) =>
        aiResponse(
          input.messages.map((m) =>
            suggestion(
              m.id,
              m.id === 'noise'
                ? 'unrelated'
                : m.id === 'archived'
                  ? 'possible'
                  : 'match',
            ),
          ),
        ),
    });
    try {
      const result = await automaticCore.runAutomatic('owner-1');
      assert.equal(result.imported, 2);
      assert.equal(result.status, 'checked');
      assert.equal((await state()).historyId, '100');
      assert.equal(privateRows().length, 2);
      assert.ok(privateRows().every((row) => !row.payload.includes('ABC987')));
      assert.equal(
        sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get(project)
          .data,
        originalWorkspace,
      );
      const view = await (await scopedMessages()).json();
      assert.equal(view.messages.filter((m) => m.ai).length, 2);
      assert.ok(view.messages.find((m) => m.ai?.relevance === 'possible'));
      const other = await newTeamProject('Other event');
      const otherView = await (
        await gmailApi.GET(
          new Request(
            'https://gather.example/api/gmail/messages?project=' + other,
          ),
        )
      ).json();
      assert.ok(otherView.messages.every((m) => m.mailbox !== mailbox));
      const row = privateRows()[0];
      assert.equal(
        (
          await gmailApi.POST(
            request('/api/gmail/review?project=' + other, {
              id: row.id,
              title: 'Wrong project',
              summary: 'Wrong destination',
              confirmShared: true,
            }),
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await gmailApi.POST(
            request('/api/gmail/move?project=' + project, {
              id: row.id,
              projectId: other,
            }),
          )
        ).status,
        200,
      );
      const moved = await (
        await gmailApi.GET(
          new Request(
            'https://gather.example/api/gmail/messages?project=' + other,
          ),
        )
      ).json();
      assert.equal(
        moved.messages.find((m) => m.id === row.id).ai.projectId,
        other,
      );
      assert.equal(
        sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get(project)
          .data,
        originalWorkspace,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('bootstrap pagination, arrival during bootstrap and history pagination keep the final cursor until all candidates finish', async () => {
    await fixture();
    let page = 0;
    provider({
      list: (url) => {
        page++;
        return url.searchParams.get('pageToken') === 'page2'
          ? Response.json({ messages: [{ id: 'second' }] })
          : Response.json({
              messages: [{ id: 'first' }],
              nextPageToken: 'page2',
            });
      },
      history: (url) => {
        assert.equal(url.searchParams.get('startHistoryId'), '100');
        return url.searchParams.get('pageToken') === 'history2'
          ? Response.json({
              historyId: '250',
              history: [
                {
                  messagesAdded: [
                    { message: { id: 'during' } },
                    { message: { id: 'later' } },
                  ],
                },
              ],
            })
          : Response.json({
              historyId: '225',
              nextPageToken: 'history2',
              history: [
                {
                  messagesAdded: [
                    { message: { id: 'first' } },
                    { message: { id: 'during' } },
                  ],
                },
              ],
            });
      },
    });
    try {
      assert.equal(
        (await automaticCore.runAutomatic('owner-1')).status,
        'catching_up',
      );
      assert.equal((await state()).historyId, '');
      due();
      await automaticCore.runAutomatic('owner-1');
      assert.equal((await state()).historyId, '100');
      assert.equal(page, 2);
      due();
      await automaticCore.runAutomatic('owner-1');
      assert.equal((await state()).historyId, '100');
      due();
      await automaticCore.runAutomatic('owner-1');
      assert.equal((await state()).historyId, '250');
      assert.equal(privateRows().length, 4);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('AI refusal or malformed output retains pending messages and retries without losing the Gmail checkpoint', async () => {
    await fixture();
    const invalid = [
      Response.json({ status: 'incomplete' }),
      aiResponse([suggestion('invented')]),
      aiResponse([{ ...suggestion('self'), projectId: 'not-enrolled' }]),
    ];
    provider({
      classify: () => invalid.shift() || aiResponse([suggestion('self')]),
    });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        due();
        assert.equal(
          (await automaticCore.runAutomatic('owner-1')).status,
          'provider',
        );
        assert.deepEqual((await state()).scan.pending, ['self']);
        assert.equal(privateRows().length, 0);
      }
      due();
      assert.equal((await automaticCore.runAutomatic('owner-1')).imported, 1);
      assert.equal((await state()).historyId, '100');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('text attachments and attachment subtrees are excluded from the Gmail body sent to AI', async () => {
    const text = (value) => ({
      mimeType: 'text/plain',
      body: { data: Buffer.from(value).toString('base64url') },
    });
    const attachment = { ...text('ATTACHMENT SECRET'), filename: 'notes.txt' };
    const html = {
      mimeType: 'text/html',
      body: { data: Buffer.from('<b>Body</b>').toString('base64url') },
    };
    assert.equal(gmailCore.readPlain({ parts: [html, attachment] }), '');
    assert.equal(
      gmailCore.readPlain({
        parts: [
          {
            mimeType: 'multipart/mixed',
            filename: 'attached.eml',
            parts: [text('NESTED SECRET')],
          },
          text('Public body'),
        ],
      }),
      'Public body',
    );
    assert.equal(
      gmailCore.readPlain({
        ...text('SECRET'),
        headers: [
          { name: 'Content-Disposition', value: 'attachment; filename=x.txt' },
        ],
      }),
      '',
    );
    assert.equal(
      gmailCore.readPlain({
        ...text('SECRET'),
        body: { ...text('SECRET').body, attachmentId: 'abc' },
      }),
      '',
    );
  });

  test('expired Gmail history starts bounded recovery; deleted messages are skipped, rate limiting does not consume the checkpoint', async () => {
    await fixture();
    provider();
    try {
      await automaticCore.runAutomatic('owner-1');
      due();
      provider({ history: () => new Response('', { status: 404 }) });
      assert.equal(
        (await automaticCore.runAutomatic('owner-1')).status,
        'recovering',
      );
      assert.equal((await state()).recovery, true);
      due();
      provider({ ids: ['deleted'] });
      const normal = globalThis.fetch;
      globalThis.fetch = (url, options) =>
        String(url).includes('/messages/deleted?')
          ? Promise.resolve(new Response('', { status: 404 }))
          : normal(url, options);
      assert.equal(
        (await automaticCore.runAutomatic('owner-1')).status,
        'checked',
      );
      due();
      provider({ history: () => new Response('', { status: 429 }) });
      assert.equal(
        (await automaticCore.runAutomatic('owner-1')).status,
        'provider',
      );
      assert.equal((await state()).historyId, '100');
      assert.ok(
        sqlite.prepare('SELECT next_run FROM gmail_automation').get().next_run <
          Date.now() + 6 * 60000,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('pause or reconnect during Gmail fetch prevents AI processing and storage for the old enrollment', async () => {
    for (const action of ['pause', 'reconnect']) {
      await fixture();
      const calls = provider({
        onMessage: async () => {
          if (action === 'pause')
            await automaticCore.configureAutomatic('owner-1', {
              enabled: false,
            });
          else
            sqlite
              .prepare(
                'UPDATE gmail_connections SET generation=? WHERE user_id=?',
              )
              .run('new-account-generation', 'owner-1');
        },
      });
      try {
        await automaticCore.runAutomatic('owner-1');
        assert.ok(!calls.includes('https://api.openai.com/v1/responses'));
        assert.equal(privateRows().length, 0);
      } finally {
        globalThis.fetch = realFetch;
      }
    }
  });

  test('pause during AI response prevents committing drafts; concurrent workers share one lease', async () => {
    await fixture();
    let release, entered;
    const started = new Promise((resolve) => (entered = resolve)),
      waiting = new Promise((resolve) => (release = resolve));
    provider({
      classify: async (input) => {
        entered();
        await waiting;
        return aiResponse(input.messages.map((m) => suggestion(m.id)));
      },
    });
    try {
      const running = automaticCore.runAutomatic('owner-1');
      await started;
      assert.equal(
        (await automaticCore.runAutomatic('owner-1')).status,
        'not_due',
      );
      await automaticCore.configureAutomatic('owner-1', { enabled: false });
      release();
      await running;
      assert.equal(privateRows().length, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('AI quota is durable and failure does not advance pending mail', async () => {
    await fixture();
    const calls = provider();
    const quota = 'gmail-ai:owner-1:' + new Date().toISOString().slice(0, 10);
    sqlite
      .prepare('INSERT INTO resource_usage (id,count) VALUES (?,250)')
      .run(quota);
    try {
      assert.equal(
        (await automaticCore.runAutomatic('owner-1')).status,
        'limit',
      );
      assert.ok(!calls.includes('https://api.openai.com/v1/responses'));
      assert.equal((await state()).historyId, '');
      assert.equal(privateRows().length, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('OpenAI billing exhaustion is visible and distinct from the application daily quota', async () => {
    await fixture();
    provider({
      classify: () =>
        Response.json(
          { error: { code: 'insufficient_quota' } },
          { status: 429 },
        ),
    });
    try {
      assert.equal(
        (await automaticCore.runAutomatic('owner-1')).status,
        'billing',
      );
      assert.match(
        (await automaticCore.automaticStatus('owner-1')).issue,
        /billing/,
      );
      assert.equal((await state()).historyId, '');
      assert.equal(privateRows().length, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('background writer is opt-in, rejects browser requests and arbitrary targeting, and returns counts only', async () => {
    await fixture();
    provider();
    const serviceRequest = (body = '{}', extra = {}) =>
      new Request('https://gather.example/api/gmail/automatic-run', {
        method: 'POST',
        headers: { 'X-Weft-Job': 'gmail-detection', ...extra },
        body,
      });
    try {
      delete globalThis.__gatherEnv.GMAIL_BACKGROUND_MODE;
      assert.equal((await automaticApi.POST(serviceRequest())).status, 503);
      globalThis.__gatherEnv.GMAIL_BACKGROUND_MODE = 'owner-private';
      assert.equal(
        (
          await automaticApi.POST(
            serviceRequest('{}', { Origin: 'https://gather.example' }),
          )
        ).status,
        403,
      );
      assert.equal(
        (await automaticApi.POST(serviceRequest('{"userId":"someone"}')))
          .status,
        403,
      );
      assert.equal(
        (
          await automaticApi.POST(
            serviceRequest('{}', { 'oai-authenticated-user-id': 'owner-1' }),
          )
        ).status,
        403,
      );
      const result = await (await automaticApi.POST(serviceRequest())).json();
      assert.equal(result.results[0].imported, 1);
      assert.ok(!JSON.stringify(result).includes(mailbox));
      assert.ok(!JSON.stringify(result).includes('ABC987'));
    } finally {
      globalThis.fetch = realFetch;
      delete globalThis.__gatherEnv.GMAIL_BACKGROUND_MODE;
    }
  });

  test('delayed disconnect cannot delete a replacement Gmail connection', async () => {
    await fixture();
    globalThis.fetch = async (url) => {
      assert.equal(url, 'https://oauth2.googleapis.com/revoke');
      sqlite
        .prepare('UPDATE gmail_connections SET generation=? WHERE user_id=?')
        .run('replacement-generation', 'owner-1');
      return new Response('', { status: 200 });
    };
    try {
      assert.equal(
        (await gmailApi.POST(request('/api/gmail/disconnect', {}))).status,
        200,
      );
      assert.equal(
        (await gmailCore.connection('owner-1')).generation,
        'replacement-generation',
      );
    } finally {
      globalThis.fetch = realFetch;
      delete globalThis.__gatherEnv.OPENAI_API_KEY;
    }
  });
}
