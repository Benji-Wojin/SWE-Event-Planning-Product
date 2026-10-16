import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
mkdirSync('public/gather-assets', { recursive: true });
let html = readFileSync('legacy/index.html', 'utf8')
  .replace('favicon.svg', '/favicon.svg')
  .replace('href="lovable-ui.css"', 'href="/gather-assets/lovable-ui.css"')
  .replace('src="theme.js"', 'src="/gather-assets/theme.js"')
  .replace('styles.css?v=coordination-1', '/gather-assets/styles.css');
html = html
  .replace('calendar.js?v=coordination-1', '/gather-assets/calendar.js')
  .replace('navigation.js?v=coordination-1', '/gather-assets/navigation.js')
  .replace('priorities.js?v=coordination-1', '/gather-assets/priorities.js')
  .replace('recovery-ui.js?v=coordination-1', '/gather-assets/recovery-ui.js')
  .replace('schedule-ui.js?v=coordination-1', '/gather-assets/schedule-ui.js')
  .replace('<script src="store.js?v=coordination-1"></script>', '')
  .replace(
    '<script src="app.js?v=coordination-1"></script>',
    '<script src="/gather-assets/hosted-store.js"></script>',
  );
html = html
  .replace('Local demo</button>', 'Workspace info</button>')
  .replace(
    '<label class="actor-control">',
    '<label class="actor-control" hidden>',
  );
html = html.replace(
  '<div class="top-actions">',
  '<div class="top-actions"><a class="btn btn-secondary btn-small" href="/demo" target="_top">4-person demo</a><a class="btn btn-secondary btn-small" href="/account" target="_top">Account</a>',
);
html = html.replace('<div class="nav-label">Review</div>', '<a class="nav-item project-setup-link" href="/setup" target="_top"><span class="nav-icon" data-icon="calendar"></span>Project settings</a><a class="nav-item" href="/" target="_top"><span class="nav-icon" data-icon="arrow"></span>All projects</a><div class="nav-label">Review</div>');
html = html.replace(
  'Browser storage is unavailable. Changes will last for this visit only. You can export a backup from Local demo.',
  'Connection interrupted. Your last saved plan is still on the server. Reload to reconnect.',
);
html=html.replace('<script src="/gather-assets/hosted-store.js"></script>','<script src="/gather-assets/inbox.js"></script><script src="/gather-assets/resources-ui.js"></script><script src="/gather-assets/guests.js"></script><script src="/gather-assets/info-ui.js"></script><script src="/gather-assets/hosted-store.js"></script>');
html = html.replace('<div class="top-actions">', '<div class="top-actions"><a class="btn btn-secondary btn-small" href="/feedback" target="_top">Feedback</a>');
// The hosted shell has no project identity until the authenticated snapshot loads.
html = html.replaceAll('Field Day 2026', 'Project')
  .replace('<span class="event-symbol">FD</span>', '<span class="event-symbol" aria-hidden="true">…</span>')
  .replace('<div class="app-shell" id="appShell">', '<main id="workspaceBoot" style="max-width:640px;margin:64px auto;padding:24px" aria-busy="true"><p role="status">Loading project…</p><a href="/" target="_top">All projects</a></main><div class="app-shell" id="appShell" hidden>');
writeFileSync('public/gather-assets/calendar.js',readFileSync('legacy/calendar.js','utf8'));
writeFileSync('public/gather-assets/navigation.js',readFileSync('legacy/navigation.js','utf8'));
writeFileSync('public/gather-assets/lovable-ui.css',readFileSync('legacy/lovable-ui.css','utf8'));
writeFileSync('public/gather-assets/theme.js',readFileSync('legacy/theme.js','utf8'));
writeFileSync('public/gather-assets/priorities.js',readFileSync('legacy/priorities.js','utf8'));
writeFileSync('public/gather-assets/recovery-ui.js',readFileSync('legacy/recovery-ui.js','utf8'));
writeFileSync('public/gather-assets/schedule-ui.js',readFileSync('legacy/schedule-ui.js','utf8'));
writeFileSync('public/gather-assets/inbox.js',readFileSync('legacy/inbox.js','utf8'));
writeFileSync('public/gather-assets/resources-ui.js',readFileSync('legacy/resources-ui.js','utf8'));
for(const name of ['guests','info-ui'])writeFileSync('public/gather-assets/'+name+'.js',readFileSync('legacy/'+name+'.js','utf8'));
let app = readFileSync('legacy/app.js', 'utf8');
const inboxStart=app.indexOf('  function inboxView(s) {');
const inboxEnd=app.indexOf('  function teamView(s) {',inboxStart);
if(inboxStart<0||inboxEnd<0)throw new Error('Inbox view insertion point is missing.');
app=app.slice(0,inboxStart)+readFileSync('legacy/inbox-view.js','utf8')+'\n'+app.slice(inboxEnd);
app=app.replace("messageId:''", "messageId:new URLSearchParams(location.search).get('message')||''")
  .replace('ui.reviewDirty=false;', 'clearPrivateOriginal();ui.reviewDirty=false;')
  .replace("if(action==='refresh-inbox')", "if(action==='private-original')await showPrivateOriginal(id);\n      if(action==='refresh-inbox')")
  .replace("if(document.hidden)lockPrivate();", "if(document.hidden){lockPrivate();clearPrivateOriginal();}");
const mutations = [
  'setNextUp', 'requestRecovery', 'resolveRecovery',
  'setTaskPriority',
  'setTaskSchedule',
  'resolveHandoff',
  'addDependency', 'removeDependency', 'resumeTask',
  'claimTask',
  'resetDemo',
  'addTask',
  'updateTask',
  'addComment',
  'saveDraft',
  'addMessage',
  'applyMessage',
  'refreshProposal',
  'ignoreMessage',
  'acceptTask',
  'reportCompletion',
  'verifyTask',
  'recordFollowup',
  'updateEvent',
  'addMemory',
  'updateMemory',
  'acceptSuggestion',
  'dismissSuggestion',
];
app = app
  .replace(
    new RegExp('store\\.(' + mutations.join('|') + ')\\(', 'g'),
    'await store.$1(',
  )
  .replace(
    "document.addEventListener('change',event=>{",
    "document.addEventListener('change',async event=>{",
  );
app = app.replace("actor:'jack'", 'actor:window.GatherIdentity.actorId');
app = app.replace(
  "'X-Gather-CSRF':session?.csrf||''",
  "'X-Gather-Request':'1'",
);
app = app.replace(
  /if\(ui\.privateState!=='unlocked'\)return heading\+.*?;\n/,
  `if(ui.privateState!=='unlocked')return heading+'<section class="panel private-panel"><h2>Private details hidden</h2><p>Organizer access is required to view these records.</p><button class="btn btn-primary" data-action="reload-private">Show private details</button>'+(window.GatherMode?.demo?'':'<a class="btn btn-secondary" href="/signout-with-chatgpt?return_to=%2F" target="_top">Sign out &amp; lock</a>')+'</section>';\n`,
);
app = app.replace(
  'Signed in as the local administrator · encrypted on this computer · session expires in 15 minutes. Team login and cloud sharing are not connected.',
  'Organizer-only · encrypted server storage · hidden after 15 minutes of viewing. Sign out to end account access.',
);
app = app.replace('Private details locked after the administrator session ended.', 'Private details hidden after 15 minutes. Sign out to end account access.');
app = app
  .replaceAll('authenticated local administrator', 'signed-in organizer')
  .replaceAll('local administrator', 'organizer')
  .replace(
    'Checking the local private-details service',
    'Checking your organizer access',
  )
  .replace(
    'Private details are not available on this preview server.',
    'Private details could not be loaded.',
  );
app = app.replace(
  'Local email review · no mailbox is connected. Do not paste private confirmation emails here.',
  'No mailbox is connected. Pasted messages are shared: do not paste private confirmation emails here.',
);
app = app.replace(
  'The original message is attached to the task.',
  'The reviewed update is attached to the task.',
);
app = app.replace(
  'Local response preview only. This is not a shareable guest link; real guest access needs the hosted sign-in setup.',
  'Only the signed-in task owner can respond. Guest access is not enabled.',
);
app = app.replace(
  'Switch the demo member to this task’s owner to try their response.',
  'Only this task’s assigned account can submit its response.',
);
app = app.replace('[add your shared workspace link]', '${location.origin}${window.GatherMode?.demo?"/demo?as="+encodeURIComponent(ui.actor):window.GatherMode.projectUrl("/project")}');
app = app.replace(
  'Team invitations are a draft in this local prototype. No invite or email will be sent.',
  'Private to your account. Invitation drafts do not send messages or grant access; team onboarding is not enabled.',
);
app = app.replace(
  /if\(action==='demo-info'\).*?;\n/,
  `if(action==='demo-info')openDialog('Workspace info',window.GatherMode?.demo?'<p>The full app with separate sample data and simulated profiles. Only enter fictional booking details. No emails are sent.</p>':'<p>Shared with invited project members. Changes are saved on the server. Team access manages invitations.</p><p>This release does not read Gmail. Planning suggestions use rules; optional AI searches use the task name, category and city.</p><p>Private details are excluded from shared exports and AI searches.</p>','<button class="btn btn-secondary" data-action="export">Export shared plan</button>');\n`,
);
app = app
  .replace('Original email preserved.', 'Reviewed update saved.')
  .replace(
    'A completion report waits for Jack’s verification.',
    'A completion report waits for the organizer’s verification.',
  );
app = app.replace(
  '  setDrawer(false);\n  navigate',
  `  window.addEventListener('gather-tool-updated',()=>{if(ui.pendingSave||ui.reviewDirty||(!$('#dialogBackdrop').hidden&&ui.dialogKind!=='thought'))showPendingUpdate();else {if(ui.view!=='details')render();refreshSuggestionSurfaces();}});
  let inboxRefreshTimer;
  function startInboxRefresh(){if(!inboxRefreshTimer)inboxRefreshTimer=setInterval(()=>refreshInbox(),window.GatherMode?.demo?4000:20000);}
  startInboxRefresh();
  window.addEventListener('focus',()=>refreshInbox());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshInbox();});
  window.addEventListener('pagehide',()=>{clearInterval(inboxRefreshTimer);inboxRefreshTimer=null;});
  window.addEventListener('pageshow',event=>{if(event.persisted){startInboxRefresh();refreshInbox();}});
  setDrawer(false);
  navigate`,
);
writeFileSync('public/gather-assets/app.js', app);
writeFileSync(
  'public/gather-assets/styles.css',
  readFileSync('legacy/styles.css', 'utf8') +
    '\n[hidden]{display:none!important}',
);
writeFileSync(
  'public/gather-assets/hosted-store.js',
  readFileSync('legacy/hosted-store.js', 'utf8'),
);

// Cache code, never user snapshots or authenticated pages. Content-addressed URLs
// change on every asset edit, so a new release cannot reuse stale cached bytes.
const versioned = 'public/gather-assets/versioned';
mkdirSync(versioned, { recursive: true });
const assetUrls = new Map();
function versionAsset(name, content) {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 20);
  const url = `/gather-assets/versioned/${hash}-${name}`;
  writeFileSync('public' + url, content);
  assetUrls.set('/gather-assets/' + name, url);
  return url;
}
for (const name of readdirSync('public/gather-assets')) {
  if (!/\.(js|css)$/.test(name) || name === 'hosted-store.js') continue;
  versionAsset(name, readFileSync('public/gather-assets/' + name, 'utf8'));
}
const appUrl = assetUrls.get('/gather-assets/app.js');
versionAsset('hosted-store.js', readFileSync('public/gather-assets/hosted-store.js', 'utf8')
  .replace("'/gather-assets/app.js'", JSON.stringify(appUrl)));
html = html.replace(/\/gather-assets\/[a-z-]+\.(?:js|css)/g, url => assetUrls.get(url) || url)
  .replace('</head>', `<link rel="preload" as="script" href="${appUrl}">\n</head>`)
  // Deferred scripts download together and execute in order, after the DOM exists.
  .replace(/<script src="([^"]+)"/g, (tag, url) => url.endsWith('-theme.js') ? tag : tag.replace('<script ', '<script defer '));
writeFileSync('public/workspace.html', html);
