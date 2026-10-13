export async function selfserviceTests({
  t,
  assert,
  sqlite,
  db,
  request,
  security,
  signupApi,
  invitationsApi,
  projectsApi,
  teamApi,
  workspace,
  privateApi,
  gmailApi,
  senderApi,
  owner,
}) {
  const setUser = (id) => {
    globalThis.__gatherUser = {
      userId: 'signup-' + id,
      email: id + '@example.com',
      displayName: 'QA ' + id,
    };
  };
  const signup = () => signupApi.POST(request('/api/signup', {}));
  const read = () => invitationsApi.GET();
  const respond = (id, action = 'accept', extra = {}) =>
    invitationsApi.POST(request('/api/invitations', { id, action, ...extra }));
  const projectRead = (id) =>
    workspace.GET(
      new Request('https://gather.example/api/workspace?project=' + id),
    );
  const invite = async (project, email, id = crypto.randomUUID()) => {
    const response = await teamApi.POST(
      request('/api/team?project=' + project, {
        action: 'invite',
        email,
        requestId: id,
      }),
    );
    assert.equal(response.status, 200, await response.clone().text());
    return id;
  };
  const create = async (
    name = 'Private self-service event',
    requestId = crypto.randomUUID(),
  ) => {
    const response = await projectsApi.POST(
      request('/api/projects', { requestId, event: { name } }),
    );
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).id;
  };
  let project;
  await t.test(
    'registration is explicit, session-bound, idempotent and grants no global administration',
    async () => {
      globalThis.__gatherUser = null;
      assert.equal((await signup()).status, 401);
      assert.equal((await read()).status, 401);
      setUser('alice');
      assert.equal(
        (
          await signupApi.POST(
            request('/api/signup', {
              role: 'admin',
              email: 'owner@example.com',
            }),
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await signupApi.POST(
            request('/api/signup', {}, 'https://evil.example'),
          )
        ).status,
        403,
      );
      assert.equal(
        sqlite
          .prepare('SELECT 1 FROM members WHERE user_id=?')
          .get('signup-alice'),
        undefined,
      );
      const results = await Promise.all([signup(), signup()]);
      results.forEach((r) => assert.equal(r.status, 200));
      const member = await security.principal();
      assert.equal(member.role, 'member');
      assert.notEqual(member.actorId, 'jack');
      assert.equal(security.isAppOwner(member), false);
      assert.equal((await projectRead('main')).status, 404);
      assert.deepEqual((await (await projectsApi.GET()).json()).projects, []);
      project = await create();
      const snap = await (await projectRead(project)).json();
      assert.equal(snap.identity.role, 'admin');
      assert.equal(snap.identity.actorId, 'jack');
      assert.equal(snap.state.tasks.length, 0);
      assert.equal(
        (
          await privateApi.GET(
            new Request(
              'https://gather.example/api/private/records?project=' + project,
            ),
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await gmailApi.GET(
            new Request('https://gather.example/api/gmail/status'),
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await gmailApi.POST(
            request('/api/gmail/configure', {
              clientId: 'evil',
              clientSecret: 'evil',
            }),
          )
        ).status,
        403,
      );
      assert.equal((await security.principal()).role, 'member');
    },
  );
  await t.test(
    'in-app invitations work before signup without sending email or revealing tokens',
    async () => {
      const oldFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error('In-app invitations must not send email');
      };
      try {
        setUser('alice');
        const id = await invite(project, 'bob@example.com');
        setUser('bob');
        assert.equal((await signup()).status, 200);
        const data = await (await read()).json();
        assert.equal(data.invitations.length, 1);
        assert.deepEqual(Object.keys(data.invitations[0]).sort(), [
          'expiresAt',
          'id',
          'name',
          'organizer',
        ]);
        assert.equal(data.invitations[0].id, id);
        assert.equal((await projectRead(project)).status, 404);
        setUser('eve');
        await signup();
        assert.deepEqual((await (await read()).json()).invitations, []);
        assert.equal((await respond(id)).status, 410);
        assert.equal(
          (await respond(id, 'accept', { role: 'admin' })).status,
          400,
        );
        setUser('bob');
        assert.equal(
          (
            await invitationsApi.POST(
              request(
                '/api/invitations',
                { id, action: 'accept' },
                'https://evil.example',
              ),
            )
          ).status,
          403,
        );
        const accepted = await Promise.all([respond(id), respond(id)]);
        accepted.forEach((r) => assert.equal(r.status, 200));
        assert.equal(
          sqlite
            .prepare(
              "SELECT COUNT(*) AS n FROM project_members WHERE project_id=? AND user_id=? AND revoked_at=''",
            )
            .get(project, 'signup-bob').n,
          1,
        );
        assert.deepEqual((await (await read()).json()).invitations, []);
        const snap = await (await projectRead(project)).json();
        assert.equal(snap.identity.role, 'member');
        assert.equal(
          (
            await privateApi.GET(
              new Request(
                'https://gather.example/api/private/records?project=' + project,
              ),
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await senderApi.POST(
              request('/api/sender?project=' + project, { action: 'connect' }),
            )
          ).status,
          403,
        );
        const own = await create('Bob owns this');
        assert.equal(
          (await (await projectRead(own)).json()).identity.role,
          'admin',
        );
        setUser('alice');
        assert.equal((await projectRead(own)).status, 404);
      } finally {
        globalThis.fetch = oldFetch;
      }
    },
  );
  await t.test(
    'declined, expired and revoked invitations cannot grant access; decline is recipient-bound',
    async () => {
      setUser('alice');
      const declined = await invite(project, 'decliner@example.com');
      const revoked = await invite(project, 'revoked-signup@example.com');
      const expired = await invite(project, 'expired-signup@example.com');
      setUser('eve');
      await respond(declined, 'decline');
      assert.equal(
        sqlite
          .prepare('SELECT revoked_at FROM project_invites WHERE id=?')
          .get(declined).revoked_at,
        '',
      );
      setUser('decliner');
      await signup();
      await respond(declined, 'decline');
      await respond(declined, 'decline');
      assert.deepEqual((await (await read()).json()).invitations, []);
      assert.equal((await respond(declined)).status, 410);
      setUser('alice');
      await teamApi.POST(
        request('/api/team?project=' + project, {
          action: 'revokeInvite',
          id: revoked,
        }),
      );
      sqlite
        .prepare('UPDATE project_invites SET expires_at=? WHERE id=?')
        .run(Date.now() - 1, expired);
      for (const [user, id] of [
        ['revoked-signup', revoked],
        ['expired-signup', expired],
      ]) {
        setUser(user);
        await signup();
        assert.deepEqual((await (await read()).json()).invitations, []);
        assert.equal((await respond(id)).status, 410);
        assert.equal((await projectRead(project)).status, 404);
      }
    },
  );
  await t.test(
    'public project creation limits are atomic and retry-safe',
    async () => {
      setUser('quota');
      await signup();
      const ids = Array.from({ length: 7 }, () => crypto.randomUUID());
      const results = await Promise.all(
        ids.map((requestId) =>
          projectsApi.POST(
            request('/api/projects', {
              requestId,
              event: { name: 'Quota event' },
            }),
          ),
        ),
      );
      assert.equal(results.filter((r) => r.status === 201).length, 5);
      assert.equal(results.filter((r) => r.status === 409).length, 2);
      const index = results.findIndex((r) => r.status === 201);
      assert.equal(
        (
          await projectsApi.POST(
            request('/api/projects', {
              requestId: ids[index],
              event: { name: 'Quota event' },
            }),
          )
        ).status,
        201,
      );
      assert.equal(
        sqlite
          .prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_id=?')
          .get('signup-quota').n,
        5,
      );
    },
  );
  owner();
}
