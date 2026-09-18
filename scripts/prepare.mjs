import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('public/gather-assets', { recursive: true });
let html = readFileSync('legacy/index.html', 'utf8')
  .replace('favicon.svg', '/favicon.svg')
  .replace('styles.css?v=coordination-1', '/gather-assets/styles.css');
html = html
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
  '<div class="top-actions"><a class="btn btn-secondary btn-small" href="/demo" target="_top">4-person demo</a><a class="btn btn-secondary btn-small" href="/settings" target="_top">Gmail &amp; account</a>',
);
html = html.replace(
  'Browser storage is unavailable. Changes will last for this visit only. You can export a backup from Local demo.',
  'Connection interrupted. Your last saved plan is still on the server. Reload to reconnect.',
);
html=html.replace('<script src="/gather-assets/hosted-store.js"></script>','<script src="/gather-assets/inbox.js"></script><script src="/gather-assets/hosted-store.js"></script>');
writeFileSync('public/workspace.html', html);
writeFileSync('public/gather-assets/inbox.js',readFileSync('legacy/inbox.js','utf8'));
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
  'Gmail originals stay private to the organizer. Set up your connection in Gmail &amp; account. Pasted messages are shared: do not paste private confirmation emails here.',
);
app = app.replace(
  '<div class="intake-demo">',
  '<div class="section-gap"><a class="btn btn-secondary" href="/mail" target="_top">Open private Gmail inbox →</a></div><div class="intake-demo">',
);
app = app.replace(
  'The original message is attached to the task.',
  'The reviewed update is attached to the task. Gmail originals remain organizer-only.',
);
app = app.replace(
  'Local response preview only. This is not a shareable guest link; real guest access needs the hosted sign-in setup.',
  'Only the signed-in task owner can respond. Guest access is not enabled.',
);
app = app.replace(
  'Switch the demo member to this task’s owner to try their response.',
  'Only this task’s assigned account can submit its response.',
);
app = app.replace('[add your shared workspace link]', '${location.origin}${window.GatherMode?.demo?"/demo?as="+encodeURIComponent(ui.actor):""}');
app = app.replace(
  'Team invitations are a draft in this local prototype. No invite or email will be sent.',
  'Private to your account. Invitation drafts do not send messages or grant access; team onboarding is not enabled.',
);
app = app.replace(
  /if\(action==='demo-info'\).*?;\n/,
  `if(action==='demo-info')openDialog('Workspace info',window.GatherMode?.demo?'<p>This is the same app with separate sample data. Open profiles in separate tabs to show task claiming, reporting, and organizer review.</p><p>Gmail is not connected here. Suggestions are rule-based. Only enter fictional booking details.</p>':'<p>Private to your account. Changes are saved on the server. Sample teammates are not real accounts.</p><p>Gmail requires setup. Suggestions are rule-based; no AI model is connected. Nothing is sent automatically.</p><p>Bookings and Gmail originals are excluded from shared exports. This pilot has not had an independent security review.</p>','<button class="btn btn-secondary" data-action="export">Export shared plan</button>');\n`,
);
app = app
  .replace('Original email preserved.', 'Reviewed update saved.')
  .replace(
    'A completion report waits for Jack’s verification.',
    'A completion report waits for the organizer’s verification.',
  );
app = app.replace(
  '  setDrawer(false);\n  navigate',
  "  window.addEventListener('gather-tool-updated',()=>{closeDialog();render();});\n  const inboxRefreshTimer=setInterval(()=>refreshInbox(),window.GatherMode?.demo?4000:20000);\n  window.addEventListener('focus',()=>refreshInbox());\n  window.addEventListener('pagehide',()=>clearInterval(inboxRefreshTimer),{once:true});\n  setDrawer(false);\n  navigate",
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
