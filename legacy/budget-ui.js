(function (root) {
  'use strict';
  function create({
    h,
    openDialog,
    closeDialog,
    toast,
    saveLock,
    confirmClose = () => true,
    isDialogOpen,
    getWorkspace,
    refreshWorkspace,
    getActor = () => '',
    focusControl = (target) => { if (!target) return false; target.focus({preventScroll:true}); return true; },
    onLoaded,
  }) {
    const B = root.GatherBudget;
    let host = null,
      state = null,
      archived = false,
      reviewingIncomplete = false,
      ticket = 0,
      timer,
      pendingFocus = null,
      disclosureScope = '',
      expanded = new Set();
    const scopeKey = () => JSON.stringify([!!root.GatherMode?.demo, root.GatherMode?.projectId || 'main', getActor()]);
    const mode = () => archived ? 'archived' : 'active';
    const costGroup = () => archived ? 'archived' : 'current';
    const showsCost = row => Boolean(row.archivedAt) === archived &&
      (!reviewingIncomplete || B.forecastAmount(row).missing);
    function linkedTaskOrigin(opener) {
      const data = opener?.dataset;
      if (!data || data.budgetScope !== scopeKey()) return null;
      if (['active','archived'].includes(data.budgetReviewIncomplete))
        return {review:data.budgetReviewIncomplete,mode:mode(),scope:data.budgetScope};
      const control = data.budgetShowAll === mode() ? '[data-budget-show-all]' :
        data.budgetMode === mode() && Object.hasOwn(data,'budgetArchived') ? '[data-budget-archived]' :
        data.budgetMode === mode() && opener.id === 'budgetCostsHeading' ? '#budgetCostsHeading' : '';
      if (control) return {control,mode:mode(),scope:data.budgetScope};
      const costId = data.budgetTask || data.budgetCostHeading || data.budgetEdit;
      if (!costId || data.budgetMode !== mode()) return null;
      return {costId,taskId:data.budgetTask ? data.id : '',edit:!!data.budgetEdit,mode:data.budgetMode,scope:data.budgetScope};
    }
    function resolveLinkedTask(opener) {
      const origin = linkedTaskOrigin(opener);
      if (!origin?.taskId || root.GatherAccessLost || !host?.isConnected || !opener.isConnected || !host.contains(opener) ||
        opener.closest('[hidden],[inert]') || !state?.budget.enabled) return '';
      const cost = state.budget.items.find(row => row.id === origin.costId && Boolean(row.archivedAt) === archived);
      return cost?.taskId === origin.taskId && getWorkspace().tasks.some(task => task.id === origin.taskId) ? origin.taskId : '';
    }
    function focusLinkedCost(origin) {
      if (!host?.isConnected || root.GatherAccessLost || isDialogOpen() || origin.mode !== mode() || origin.scope !== scopeKey()) return false;
      const linked = origin.control ? host.querySelector(origin.control) : origin.review
        ? [...host.querySelectorAll('[data-budget-review-incomplete]')].find(el => el.dataset.budgetReviewIncomplete === origin.review)
        : origin.edit ? [...host.querySelectorAll('[data-budget-edit]')].find(el => el.dataset.budgetEdit === origin.costId)
        : [...host.querySelectorAll('[data-budget-task]')].find(el => el.dataset.budgetTask === origin.costId && el.dataset.id === origin.taskId);
      const cost = origin.costId && [...host.querySelectorAll('[data-budget-cost-heading]')].find(el => el.dataset.budgetCostHeading === origin.costId);
      const next = origin.costId && reviewingIncomplete && host.querySelector('[data-budget-cost-heading]');
      return [linked,cost,next,host.querySelector('#budgetCostsHeading'),host.querySelector('#budgetHeading')]
        .some(el => el && !el.closest('[hidden],[inert]') && focusControl(el));
    }
    function restoreLinkedTaskFocus(opener) {
      const origin = linkedTaskOrigin(opener);
      if (!origin || !host?.isConnected || root.GatherAccessLost || isDialogOpen()) return false;
      if (state) return focusLinkedCost(origin);
      const placeholder = host.querySelector('#budgetHeading');
      if (placeholder) focusControl(placeholder);
      pendingFocus = {origin,from:document.activeElement};
      return true;
    }
    function mayFinishLinkedTaskFocus() {
      return pendingFocus && (document.activeElement === pendingFocus.from || document.activeElement === document.body);
    }
    function finishLinkedTaskFocus(allowed) {
      const pending = pendingFocus;
      pendingFocus = null;
      if (pending && allowed) focusLinkedCost(pending.origin);
    }
    function rememberDisclosures() {
      if (state && host?.isConnected) expanded = new Set(
        [...(host.querySelectorAll?.('details[open]') || [])].map(details => details.dataset.budgetDetails),
      );
    }
    const endpoint = () => {
      const params = new URLSearchParams(
        root.GatherMode?.demo
          ? { demo: '1', as: root.GatherMode.actor }
          : { project: root.GatherMode?.projectId || 'main' },
      );
      return '/api/info?' + params;
    };
    async function request(body) {
      const controller = new AbortController(),
        timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(endpoint(), {
          method: body ? 'POST' : 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          headers: body
            ? { 'X-Gather-Request': '1', 'Content-Type': 'application/json' }
            : {},
          body,
        });
        const next = await response.json().catch(error => {
          if (response.ok) throw error;
          return null;
        });
        if (!response.ok) {
          const error = new Error(next?.error || 'Budget request failed.');
          error.status = response.status;
          error.code = next?.code;
          throw error;
        }
        return next;
      } catch (error) {
        if (error.name === 'AbortError')
          throw new Error(
            'The Budget request timed out.',
          );
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    const money = (value) => h(B.format(value, state.budget.currency));
    const ownerAvailability = member => B.ownerAvailability(member, !!root.GatherMode && !root.GatherMode.demo);
    const isOwnerLink = key => key === 'owner';
    const costLinkKeys = ['owner','taskId'];
    const isCostLink = key => costLinkKeys.includes(key);
    const linkCandidates = (key, workspace) => isOwnerLink(key) ? workspace.members : workspace.tasks;
    const linkAvailability = (key, item) => isOwnerLink(key) ? ownerAvailability(item) : B.taskAvailability(item);
    const linkIsCurrent = (key, id, workspace) =>
      linkAvailability(key, linkCandidates(key, workspace).find(item => item.id === id)) === 'current';
    function linkLabel(key, item) {
      const availability = linkAvailability(key, item);
      if (isOwnerLink(key)) {
        if (availability === 'missing') return 'Unavailable owner';
        if (availability === 'former') return item.name + ' (former teammate)';
        if (availability === 'example') return item.name + ' (example only)';
        return item.name;
      }
      return availability === 'missing' ? 'Unavailable task' :
        availability === 'archived' ? 'Archived task: ' + item.title : item.title;
    }
    function linkChoices(key, saved, workspace) {
      const candidates = linkCandidates(key, workspace);
      const current = candidates.filter(item => linkAvailability(key, item) === 'current');
      const historical = saved && !current.some(item => item.id === saved);
      const existing = historical && candidates.find(item => item.id === saved);
      const historicalLabel = existing && linkAvailability(key, existing) !== 'former'
        ? linkLabel(key, existing)
        : isOwnerLink(key) ? 'Unavailable owner' : 'Unavailable task';
      return [
        ['', isOwnerLink(key) ? 'No owner' : 'No task'],
        ...(historical ? [[saved, historicalLabel + ' (kept unless changed)']] : []),
        ...current.map(item => [item.id, linkLabel(key, item)]),
      ];
    }
    function replaceLinkOptions(field, choices, baseline, selected, unavailable) {
      field.options.length = 0;
      for (const [id,label] of choices) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = label;
        option.disabled = id === unavailable;
        option.defaultSelected = id === baseline;
        field.append(option);
      }
      field.value = selected;
    }
    function subtotal(value) {
      return (
        money(value.known) +
        (value.unknown
          ? `<small>Partial · ${value.unknown} missing</small>`
          : '')
      );
    }
    function forecastSummary(forecast) {
      if (!forecast.unknown) return money(forecast.known);
      const missing = forecast.unknown;
      return `At least ${money(forecast.known)}<small>${missing} ${missing === 1 ? 'cost is' : 'costs are'} still incomplete</small>`;
    }
    function incompleteForecast(budget) {
      return budget.items.filter(row => B.forecastAmount(row).missing);
    }
    function incompleteReviewMarkup(budget) {
      const missing = incompleteForecast(budget);
      if (!missing.length) return '';
      const counts = {active:0,archived:0};
      for (const row of missing) counts[row.archivedAt ? 'archived' : 'active']++;
      return `<div class="budget-incomplete-review">${Object.entries(counts).filter(([,count])=>count).map(([key,count])=>
        `<button type="button" class="text-button" data-budget-review-incomplete="${key}" data-budget-scope="${h(scopeKey())}">Review ${count} incomplete ${key==='active'?'current':'archived'} ${count===1?'cost':'costs'}</button>`).join('')}</div>`;
    }
    const incompleteCostId = id => 'budget-incomplete-'+String(id).replace(/[^a-zA-Z0-9-]/g,value=>'_'+value.charCodeAt(0).toString(16)+'_');
    function incompleteCostMarkup(row) {
      const {missing} = B.forecastAmount(row);
      if (!missing) return '';
      const reason = missing === 'payment' ? 'Cancelled: no net payment recorded.' :
        row.paid === null ? 'Missing an estimate or committed amount.' :
        'Missing an estimate or committed amount. The payment is only a minimum.';
      return `<p class="budget-incomplete-cost" id="${h(incompleteCostId(row.id))}"><strong>Incomplete forecast.</strong> ${reason}</p>`;
    }
    function canChangeReview(control) {
      return !root.GatherAccessLost && !isDialogOpen() && disclosureScope === scopeKey() &&
        control.dataset.budgetScope === scopeKey() && host?.isConnected &&
        control.isConnected && host.contains(control) && state?.budget.enabled;
    }
    function reviewIncompleteCosts(button) {
      const key = button.dataset.budgetReviewIncomplete;
      if (!['active','archived'].includes(key) || !canChangeReview(button)) return;
      const nextArchived = key === 'archived';
      const first = incompleteForecast(state.budget).find(row => Boolean(row.archivedAt) === nextArchived);
      if (!first) return;
      archived = nextArchived;
      reviewingIncomplete = true;
      render({preserveFocus:false});
      focusLinkedCost({costId:first.id,taskId:'',mode:mode(),scope:scopeKey()});
    }
    function showAllCosts(button) {
      if (!reviewingIncomplete || button.dataset.budgetShowAll !== mode() || !canChangeReview(button)) return;
      reviewingIncomplete = false;
      render({preserveFocus:false});
      focusControl(host.querySelector('#budgetCostsHeading'));
    }
    function targetComparison(target, totals) {
      if (target === null) return 'No target set';
      if (totals.remaining === null) {
        const over = totals.forecast.known - target;
        return over > 0 ? `At least ${money(over)} over target` : 'Target comparison incomplete';
      }
      if (totals.remaining === 0) return 'On target';
      return totals.remaining > 0
        ? `${money(totals.remaining)} below target`
        : `${money(-totals.remaining)} over target`;
    }
    function render({preserveFocus=true}={}) {
      if (!host?.isConnected || !state) return;
      const active = preserveFocus ? document.activeElement : null;
      const focus = host.contains?.(active)
        ? [...active.attributes].find(
            (attribute) =>
              attribute.name.startsWith('data-budget-') ||
              attribute.name === 'data-id',
          )
        : null;
      const linkedFocus = host.contains?.(active) ? linkedTaskOrigin(active) : null;
      const headingFocus = host.contains?.(active) && ['budgetHeading','budgetCostsHeading'].includes(active.id) ? active.id : '';
      if (host.querySelector?.('details')) rememberDisclosures();
      const focusedDetails =
        active?.tagName === 'SUMMARY'
          ? active.parentElement.dataset.budgetDetails
          : '';
      const budget = state.budget,
        admin = state.identity.admin,
        totals = B.totals(budget);
      const rows = budget.items.filter(showsCost),
        workspace = getWorkspace();
      const targetNote = targetComparison(budget.target, totals);
      const costScope = `data-budget-mode="${mode()}" data-budget-scope="${h(scopeKey())}"`;
      const reviewTools = reviewingIncomplete ? `<div class="budget-review-tools"><p class="muted" id="budgetReviewStatus" role="status">${rows.length ? `${rows.length} incomplete ${rows.length === 1 ? 'cost' : 'costs'} to review.` : `No incomplete ${costGroup()} costs to review.`} Totals still include all costs.</p><button type="button" class="text-button" data-budget-show-all="${mode()}" ${costScope}>Show all ${costGroup()} costs</button></div>` : '';
      host.innerHTML = `<div class="page-heading"><h1 id="budgetHeading" tabindex="-1">Budget</h1><div class="header-actions">${admin ? '<button class="btn ' + (budget.enabled ? 'btn-secondary' : 'btn-primary') + '" data-budget-settings>' + (budget.enabled ? 'Settings' : 'Set up budget') + '</button>' : ''}${admin && budget.enabled && !archived ? '<button class="btn btn-primary" data-budget-add>Add cost</button>' : ''}</div></div><p class="muted">Shared with your project. Weft tracks amounts you enter and never moves money.</p>${
        !budget.enabled
          ? `<section class="panel"><h2>${budget.items.length ? 'Budget tracking is off' : 'Keep costs in view, when you need to'}</h2><p>${budget.items.length ? 'Saved costs are preserved. The organizer can enable tracking again in Budget settings.' : 'Track estimates, commitments and payments you record yourself. Skip this page if your event does not need a budget.'}</p>${!admin ? '<p class="muted">Only the organizer can enable or edit this tracker.</p>' : ''}</section>`
          : `<div class="budget-totals"><section class="panel budget-forecast"><h2>Expected total</h2><strong>${forecastSummary(totals.forecast)}</strong>${incompleteReviewMarkup(budget)}</section><section class="panel"><h2>Payments recorded</h2><strong>${subtotal(totals.paid)}</strong></section><section class="panel"><h2>Budget target</h2><strong>${money(budget.target)}<small>${targetNote}</small></strong></section></div><section class="panel section-gap"><div class="toolbar"><h2 id="budgetCostsHeading" tabindex="-1" ${costScope}${reviewingIncomplete ? ' aria-describedby="budgetReviewStatus"' : ''}>${reviewingIncomplete ? 'Incomplete '+costGroup()+' costs' : archived ? 'Archived costs' : 'Costs'}</h2><label class="check-field"><input type="checkbox" data-budget-archived ${archived ? 'checked' : ''} ${costScope}> Show archived</label></div>${reviewTools}${!admin ? '<p class="muted">View only. Ask the organizer to update costs.</p>' : ''}${
              rows.length
                ? `<ul class="budget-items">${rows
                    .map((row) => {
                      const task = workspace.tasks.find(
                          (task) => task.id === row.taskId,
                        ),
                        owner = workspace.members.find(
                          (member) => member.id === row.owner,
                        );
                      const ownerLabel = row.owner ? linkLabel('owner',owner) : '';
                      const taskLabel = task ? (task.archivedAt ? linkLabel('taskId',task) : 'Task: '+task.title) : '';
                      const metadata=[ownerLabel,row.dueDate ? 'Due '+row.dueDate : ''].filter(Boolean);
                      return `<li><div class="budget-item-heading"><h3 tabindex="-1" data-budget-cost-heading="${h(row.id)}"${B.forecastAmount(row).missing?` aria-describedby="${h(incompleteCostId(row.id))}"`:''} ${costScope}>${h(row.title)}</h3>${row.status === 'cancelled' ? '<span class="chip">Cancelled</span>' : ''}${admin ? `<button class="text-button" data-budget-edit="${h(row.id)}" ${costScope}>${archived ? 'View / restore' : 'Edit'}<span class="sr-only"> ${h(row.title)}</span></button>` : ''}</div><dl class="budget-amounts">${[
                        ['estimate', 'Estimate'],
                        ['committed', 'Committed'],
                        ['paid', 'Paid'],
                      ]
                        .map(
                          ([key, label]) =>
                            `<div><dt>${label}</dt><dd>${money(row[key])}</dd></div>`,
                        )
                        .join('')}</dl>${incompleteCostMarkup(row)}${metadata.length ? `<p class="muted">${h(metadata.join(' · '))}</p>` : ''}${task ? `<button type="button" class="text-button" data-action="budget-linked-task" data-id="${h(task.id)}" data-budget-task="${h(row.id)}" aria-label="${h(taskLabel+' · Cost: '+row.title)}" ${costScope}>${h(taskLabel)}</button>` : row.taskId ? '<p class="muted">Linked task is no longer available.</p>' : ''}</li>`;
                    })
                    .join('')}</ul>`
                : reviewingIncomplete ? '' : `<p class="notice">${archived ? 'No archived costs.' : 'No costs yet. Add a quote, deposit or other expected expense.'}</p>`
            }</section>`
      }<section class="panel section-gap budget-reference">${budget.enabled ? `<details data-budget-details="totals"><summary>How totals work</summary><p>Estimates ${subtotal(totals.estimate)} · Commitments ${subtotal(totals.committed)}</p><p>Expected total uses each committed amount or, if blank, its estimate, and never counts less than the payment recorded. An active cost with only a payment recorded counts toward the minimum, but its final amount is still unknown. Cancelled costs contribute only recorded payments. Archived costs still count. Blank is unknown, not zero.</p></details>` : ''}<details data-budget-details="history"><summary>Recent budget changes (${budget.history.length})</summary><p class="muted">Latest 100 changes. This is a planning record, not a bank statement.</p><ol class="budget-history">${
        budget.history
          .slice()
          .reverse()
          .map(
            (entry) =>
              `<li><strong>${h(entry.name)}</strong> · ${h(new Date(entry.at).toLocaleString())}<p>${h(entry.action === 'budgetSettings' ? 'Updated settings' : entry.action === 'budgetArchive' ? (entry.after.archivedAt ? 'Archived ' : 'Restored ') + entry.after.title : (entry.before ? 'Edited ' : 'Added ') + entry.after.title)}</p>${entry.action === 'budgetItem' ? `<p class="muted">Estimate ${money(entry.after.estimate)} · Committed ${money(entry.after.committed)} · Payment recorded ${money(entry.after.paid)}</p>` : ''}</li>`,
          )
          .join('') || '<li>No budget changes yet.</li>'
      }</ol></details></section>`;
      [...(host.querySelectorAll?.('details') || [])].forEach((details) => {
        details.open = expanded.has(details.dataset.budgetDetails);
        if (focusedDetails === details.dataset.budgetDetails)
          details.querySelector('summary')?.focus({ preventScroll: true });
      });
      if (linkedFocus) focusLinkedCost(linkedFocus);
      else if (headingFocus && !isDialogOpen()) focusControl(host.querySelector('#'+headingFocus)||host.querySelector('#budgetHeading'));
      else if (focus) {
        const control = [...host.querySelectorAll('button,input')]
          .find(el => el.getAttribute(focus.name) === focus.value);
        if (control) control.focus({ preventScroll: true });
      }
    }
    async function load(quiet = false) {
      const mine = ++ticket,
        target = host,
        scope = scopeKey();
      try {
        const next = await request();
        if (mine !== ticket || target !== host || !target?.isConnected || scope !== scopeKey() || root.GatherAccessLost) return;
        const unchanged =
          state &&
          JSON.stringify(state.budget) === JSON.stringify(next.budget) &&
          state.identity.admin === next.identity.admin;
        state = next;
        if (!next.budget.enabled) reviewingIncomplete = false;
        const allowFocus = mayFinishLinkedTaskFocus();
        if (!quiet || !unchanged) render();
        finishLinkedTaskFocus(allowFocus);
        if (!quiet || !unchanged) onLoaded?.();
      } catch (error) {
        if (mine !== ticket || target !== host || !target?.isConnected || scope !== scopeKey() || root.GatherAccessLost) return;
        // Never leave a stale budget visible after revoked access or a failed refresh.
        const allowFocus = mayFinishLinkedTaskFocus();
        state = null;
        target.innerHTML = `<h1 id="budgetHeading" tabindex="-1">Budget</h1><p class="notice" role="alert">${h(error.message)}</p><button class="btn btn-secondary" data-budget-refresh>Retry</button>`;
        finishLinkedTaskFocus(allowFocus);
      }
    }
    function dialog(title, markup, action, fields, cost = null) {
      let revision = state.revision, opening = cost?.row, blocked = false, checked = null, checking = false, pending = null;
      let staleLinkError = false, newLinkChoices = null;
      const currency = state.budget.currency;
      const scope = scopeKey(), identity = state.identity.actor, allowReplay = !root.GatherMode?.demo;
      const demoGeneration = root.GatherMode?.demo ? getWorkspace().demoGeneration : undefined;
      openDialog(
        title,
        `<form id="budgetForm">${markup}<p class="muted">Shared with project members. Saving only records information; it never moves money.</p><div class="form-error" role="alert" tabindex="-1"></div><div class="form-actions">${fields ? '<button class="btn btn-primary" type="submit">Save</button>' : ''}<button class="btn btn-secondary" type="button" data-budget-close>Cancel</button></div></form>`,
        '',
        false,
        'budget',
      );
      const form = document.getElementById('budgetForm');
      const live = () => !root.GatherAccessLost && scopeKey() === scope && form.isConnected !== false &&
        document.getElementById('budgetForm') === form;
      const labels = {title:'Cost name',estimate:'Estimate',committed:'Committed amount',paid:'Payment recorded',
        owner:'Owner',taskId:'Linked task',dueDate:'Due date',status:'Status'};
      const forecastKeys = ['status','estimate','committed','paid'];
      let recoveryVersion = 0;
      function message(text) {
        recoveryVersion++;
        const node = form.querySelector('.form-error');
        const hadFocus = node.contains?.(document.activeElement);
        node.textContent = text;
        if (hadFocus && document.activeElement !== node) node.focus();
      }
      function recoveryButton(attribute, text, callback) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary btn-small';
        button.setAttribute(attribute, '');
        button.textContent = text;
        const version = recoveryVersion;
        button.addEventListener('click', () => {
          if (version === recoveryVersion && button.isConnected !== false) return callback(button);
        });
        form.querySelector('.form-error').append(button);
      }
      function costFields() {
        return Object.fromEntries([...new FormData(form)].filter(([key])=>Object.hasOwn(labels,key)));
      }
      function readDraft() {
        return B.item(costFields(),cost.currency);
      }
      function compare(draft = readDraft()) {
        const comparison = B.compareCostEdits(opening, checked.row, draft);
        const workspace = getWorkspace();
        const unavailable = costLinkKeys.filter(key=>draft[key] && draft[key] !== opening[key] && draft[key] !== checked.row[key] &&
          !linkIsCurrent(key,draft[key],workspace));
        return {...comparison,unavailable,conflicts:[...new Set([...comparison.conflicts,...unavailable])]};
      }
      function displayValue(row, key) {
        const value = row[key];
        if (['estimate','committed','paid'].includes(key)) return B.format(value,cost.currency);
        if (isCostLink(key)) {
          if (!value) return 'None';
          return linkLabel(key,linkCandidates(key,getWorkspace()).find(item=>item.id===value));
        }
        return value||'Not recorded';
      }
      function choiceMarkup(draft, {conflicts,coupled,unavailable}) {
        const groups = conflicts.filter(key=>!coupled||!forecastKeys.includes(key)).map(key=>({key,keys:[key]}));
        if (coupled) groups.unshift({key:'forecast',keys:forecastKeys});
        const controls = [];
        for (const {key,keys} of groups) {
          const fieldset = document.createElement('fieldset'), legend = document.createElement('legend');
          fieldset.className = 'budget-resolution-choice';
          legend.textContent = key==='forecast'?'Status and amounts':labels[key];
          fieldset.append(legend);
          const options = [];
          for (const [value,row,label] of [['saved',checked.row,'Use latest saved'],['draft',draft,'Keep my draft']]) {
            const input = document.createElement('input'), option = document.createElement('label'), copy = document.createElement('span');
            input.type = 'radio';
            input.name = 'budget-resolution-'+key;
            input.value = value;
            input.disabled = value==='draft' && unavailable.includes(key);
            option.className = 'check-field';
            const facts = keys.map(field=>labels[field]+': '+displayValue(row,field)).join(' · ');
            const forecast = key==='forecast'?B.forecastAmount(row):null;
            copy.textContent = (input.disabled ? 'Draft selection no longer available' : label)+' — '+facts+(forecast?' · Expected contribution: '+
              (forecast.missing?'at least ':'')+B.format(forecast.minimum,cost.currency)+(forecast.missing?' (incomplete)':''):'');
            option.append(input,copy);
            fieldset.append(option);
            options.push(input);
          }
          form.querySelector('.form-error').append(fieldset);
          controls.push({keys,options});
        }
        return controls;
      }
      function setBlocked(value) {
        blocked=value;
        for (const selector of ['button[type="submit"]','[data-budget-archive]'])
          form.querySelector(selector)?.setAttribute('aria-disabled',String(value));
      }
      const refreshChoices = () => refreshWorkspace((_revision,workspace) => live() && blocked && checking &&
        !form.dataset.saving && Array.isArray(workspace?.members) && Array.isArray(workspace?.tasks) &&
        (!root.GatherMode?.demo || workspace.demoGeneration === demoGeneration));
      const validBudgetForReview = next => typeof identity === 'string' && !!identity &&
        next?.identity?.actor === identity && next.identity.admin === true &&
        next.budget?.enabled === true && next.budget.currency === currency && Array.isArray(next.budget.items) &&
        Array.isArray(next.budget.history) && Number.isSafeInteger(next.revision) && next.revision >= revision;
      function drawNewLinkRefresh(text) {
        message(text);
        recoveryButton('data-budget-refresh-links','Refresh project choices',reviewNewLinks);
      }
      function validateNewLinkChoices() {
        const invalid = [];
        for (const key of costLinkKeys) {
          const field = form.elements.namedItem(key);
          if (!field || !newLinkChoices[key].has(field.value)) {
            field?.setAttribute('aria-invalid','true');
            invalid.push(key);
          } else field.removeAttribute('aria-invalid');
        }
        setBlocked(invalid.length > 0);
        return invalid;
      }
      function showNewLinkStatus() {
        const invalid = validateNewLinkChoices();
        message(invalid.length
          ? 'Choose a current option or explicitly choose none for: '+invalid.map(key=>labels[key]).join(', ')+'. Your other entries are unchanged.'
          : 'Project choices refreshed. Review your draft, then choose Save.');
        return invalid;
      }
      async function reviewNewLinks() {
        if (!live() || !blocked || newLinkChoices || !refreshWorkspace || checking || form.dataset.saving) return;
        checking = true;
        message('Refreshing project choices. Nothing will be saved.');
        try {
          const next = await request();
          if (!live()) return;
          if (accessChanged(next)) { await hideUnavailableBudget(); return; }
          if (!validBudgetForReview(next)) {
            drawNewLinkRefresh('Could not confirm the current Budget settings. Your draft is unchanged. Check again or copy your entries before closing.');
            return;
          }
          const result = await refreshChoices();
          if (!live()) return;
          if (!result?.verified) {
            drawNewLinkRefresh('Could not confirm the latest project choices. Your draft is unchanged.');
            return;
          }
          const workspace = getWorkspace();
          const fields = costLinkKeys.map(key => [key, form.elements.namedItem(key)]);
          if (fields.some(([,field])=>!field?.options)) {
            drawNewLinkRefresh('Could not refresh the choices in this form. Your draft is unchanged.');
            return;
          }
          const focus = document.activeElement === form.querySelector('.form-error');
          newLinkChoices = {};
          for (const [key,field] of fields) {
            const selected = field.value;
            const choices = linkChoices(key,'',workspace);
            newLinkChoices[key] = new Set(choices.map(([id])=>id));
            const unavailable = selected && !newLinkChoices[key].has(selected) ? selected : undefined;
            if (unavailable) choices.splice(1,0,[unavailable,'Previous selection — no longer available']);
            replaceLinkOptions(field,choices,'',selected,unavailable);
          }
          state = next;
          revision = next.revision;
          render();
          const invalid = showNewLinkStatus();
          if (focus && invalid.length) form.elements.namedItem(invalid[0])?.focus();
        } catch (error) {
          if (!live()) return;
          if ([401,403,404].includes(error.status)) { await hideUnavailableBudget(); return; }
          drawNewLinkRefresh('Could not refresh project choices. Your draft is unchanged.');
        } finally { checking = false; }
      }
      async function hideUnavailableBudget() {
        state = null;
        if (host?.isConnected)
          host.innerHTML = '<h1 id="budgetHeading" tabindex="-1">Budget</h1><p role="status">Checking budget access…</p>';
        closeDialog();
        await load();
      }
      function drawRecovery(draft, choicesReset=false) {
        if (!live()) return;
        let text = staleLinkError
          ? 'A selected owner or task is no longer available. Your draft is still here. Review the latest cost and project choices before saving again.'
          : 'The budget changed. Your draft is still here. Review the latest saved cost before saving again.';
        if (checked) {
          const {changed,conflicts,coupled,unavailable} = checked.comparison;
          text = unavailable.length
            ? 'No longer available in your draft: '+unavailable.map(key=>labels[key]).join(', ')+'. Use the latest saved link or choose a different current option in the form.'
            : conflicts.length
            ? 'You and the saved budget changed the same fields: '+conflicts.map(key=>labels[key]).join(', ')+'. Choose which values to keep. Your draft is unchanged until you apply your choices.'
            : changed.length ? 'Use the latest values for fields you did not edit, then review and save.'
            : 'The saved cost fields are unchanged. Keep your draft, review it, then save again.';
          if (coupled) text += ' Status and amount changes affect the forecast together. Choose one set of status and amounts to keep.';
          if (changed.length) text += ' Saved now: '+changed.map(key=>labels[key]+': '+displayValue(checked.row,key)).join(' · ')+'.';
        }
        message((choicesReset?'Your draft changed. Review the updated comparison before applying. ':'')+text);
        recoveryButton('data-budget-check-current','Review latest cost',checkCurrent);
        if (!checked) return;
        if (!checked.comparison.conflicts.length && !checked.comparison.coupled)
          recoveryButton('data-budget-adopt-current','Use latest saved values',()=>adoptCurrent());
        else if (draft) {
          const controls=choiceMarkup(draft,checked.comparison), signature=JSON.stringify(draft);
          const hint=document.createElement('p');
          hint.textContent='Choose an option for each group, then apply. Nothing is saved until you choose Save.';
          hint.setAttribute('role','status');
          form.querySelector('.form-error').append(hint);
          recoveryButton('data-budget-apply-choices','Apply choices to draft',()=>adoptCurrent({controls,signature,hint}));
        }
      }
      async function checkCurrent() {
        if (!live() || !blocked || checking || form.dataset.saving) return;
        checking = true;
        checked = null;
        message('Checking the latest cost. Your draft is unchanged.');
        try {
          const next = await request();
          if (!live()) return;
          if (next.identity?.actor !== identity) {
            await hideUnavailableBudget();
            return;
          }
          const row = validBudgetForReview(next) && next.budget.items.find(item=>item.id===cost.row.id);
          if (!row || row.archivedAt) {
            message('This cost cannot be safely refreshed here. Your draft is still here. Copy your edits before closing.');
            return;
          }
          if (refreshWorkspace) {
            const result = await refreshChoices();
            if (!live()) return;
            if (!result?.verified) {
              message('Could not confirm the latest project members and tasks. Your draft is unchanged.');
              recoveryButton('data-budget-check-current','Try reviewing latest cost again',checkCurrent);
              return;
            }
          }
          checked = {next,row};
          let draft;
          try { draft=readDraft(); checked.comparison = compare(draft); } catch {
            checked = null;
            message('Check your entered fields before comparing. Your draft is unchanged.');
            recoveryButton('data-budget-check-current','Review latest cost',checkCurrent);
            return;
          }
          drawRecovery(draft);
        } catch (error) {
          if (live()) {
            checked = null;
            if ([401,403,404].includes(error.status)) { await hideUnavailableBudget(); return; }
            message('Could not review the latest cost. Your draft is unchanged.');
            recoveryButton('data-budget-check-current','Try reviewing latest cost again',checkCurrent);
          }
        } finally { checking = false; }
      }
      function adoptCurrent(resolution) {
        if (!live() || !blocked || !checked || checking || form.dataset.saving) return;
        let comparison, draft;
        try { draft=readDraft(); comparison = compare(draft); } catch {
          message('Check your entered amounts before using the latest values. Your draft is unchanged.');
          recoveryButton('data-budget-check-current','Review latest cost',checkCurrent);
          return;
        }
        if ((resolution && JSON.stringify(draft)!==resolution.signature) ||
          (!resolution && (comparison.conflicts.length || comparison.coupled))) {
          checked.comparison = comparison;
          drawRecovery(draft,!!resolution);
          return;
        }
        const updates = new Set(comparison.changed);
        if (resolution) {
          const choices=resolution.controls.map(({keys,options})=>({keys,choice:options.filter(option=>option.checked&&!option.disabled)}));
          if (choices.some(({choice})=>choice.length!==1)) {
            resolution.hint.textContent='Choose one option for each group before applying.';
            return;
          }
          for (const {keys,choice:[option]} of choices) {
            const row=option.value==='draft'?draft:checked.row;
            for (const key of keys) { comparison.merged[key]=row[key]; updates.add(key); }
          }
        }
        const fields = Object.keys(labels).map(key=>[key,form.elements.namedItem(key)]);
        const workspace = getWorkspace();
        if (costLinkKeys.some(key=>comparison.merged[key] && comparison.merged[key] !== checked.row[key] &&
          !linkIsCurrent(key,comparison.merged[key],workspace))) {
          checked.comparison = comparison;
          drawRecovery(draft,true);
          return;
        }
        if (fields.some(([key,field])=>!field || (field.options && !isCostLink(key) &&
          ![...field.options].some(option=>!option.disabled&&option.value===comparison.merged[key])))) {
          message('A saved selection is not available in this form. Your draft is unchanged. Copy your edits before closing.');
          return;
        }
        for (const [key,field] of fields) {
          const formatted = value => forecastKeys.includes(key)&&key!=='status'?B.inputAmount(value,cost.currency):value;
          const value=updates.has(key)?formatted(comparison.merged[key]):field.value;
          const baseline=formatted(checked.row[key]);
          // Retain exactly the saved historical link; do not offer other
          // former members or archived tasks as replacement choices.
          if (isCostLink(key) && field.options) {
            replaceLinkOptions(field,linkChoices(key,baseline,workspace),baseline,value);
            continue;
          }
          if (field.options) {
            for (const option of field.options) option.defaultSelected=option.value===baseline;
          } else field.defaultValue=baseline;
          field.value=value;
        }
        state = checked.next;
        revision = state.revision;
        opening = checked.row;
        checked = null;
        setBlocked(false);
        delete form.dataset.budgetRecoveryDraft;
        render();
        message('Latest saved values loaded. Review this draft, then choose Save to apply it.');
        form.elements.namedItem('title')?.focus();
      }
      form
        .querySelector('[data-budget-close]')
        .addEventListener('click', () => { if (confirmClose()) closeDialog(); });
      function draftSignature() {
        return JSON.stringify([...new FormData(form)].filter(([key])=>!key.startsWith('budget-resolution-')));
      }
      function accessChanged(next) {
        return next?.identity?.admin === false ||
          (typeof next?.identity?.actor === 'string' && !!next.identity.actor && next.identity.actor !== identity);
      }
      function validConfirmation(next, attempt) {
        return typeof identity==='string' && !!identity && next?.identity?.actor === identity &&
          next.identity.admin === true && Number.isSafeInteger(next.revision) &&
          next.revision > attempt.data.revision && Array.isArray(next.budget?.items) && Array.isArray(next.budget.history);
      }
      function drawUnconfirmed(prefix='We couldn’t confirm whether your original change saved.') {
        message(prefix+(allowReplay
          ? ' Check Budget history first, or retry the exact original change. Retrying may apply the earlier values, not the ones currently in the form.'
          : ' Check Budget history. Retrying is unavailable here because the demo may have been reset.'));
        recoveryButton('data-budget-check-original','Check if original saved',checkOriginal);
        if (allowReplay) recoveryButton('data-budget-retry-original','Retry original change',button=>{
          if (!live() || !pending || checking || form.dataset.saving) return;
          return send(pending,button,draftSignature());
        });
      }
      function confirmOriginal(next, attempt, currentDraft, receipt, focusNotice = true) {
        pending = null;
        delete form.dataset.budgetUnconfirmed;
        state = next;
        if (!next.budget.enabled) reviewingIncomplete = false;
        render();
        if (currentDraft === attempt.draft) {
          const costId = attempt.data.id;
          const removed = reviewingIncomplete && costId &&
            !next.budget.items.some(row => row.id === costId && showsCost(row));
          const returnTarget = removed && (host?.querySelector('[data-budget-cost-heading]') || host?.querySelector('#budgetCostsHeading'));
          closeDialog(returnTarget || undefined);
          toast('Budget saved. No payment was made.');
          return;
        }
        form.dataset.budgetRecoveryDraft = 'true';
        setBlocked(true);
        if (cost && attempt.data.action === 'budgetItem' && attempt.data.id === cost.row.id) {
          // Compare with the confirmed original, not any later write to this cost.
          opening = receipt?.after || B.item(attempt.data.item,cost.currency);
          revision = next.revision;
          checked = null;
          message('The original change saved. Your newer edits have not been saved. Review the latest cost before saving them.');
          recoveryButton('data-budget-check-current','Review latest cost',checkCurrent);
        } else {
          message('The original change saved. Your newer edits were not saved. Copy anything you want to keep, then close and open the saved Budget entry before making another change.');
        }
        if (focusNotice) form.querySelector('.form-error').focus();
      }
      async function checkOriginal() {
        if (!live() || !pending || checking || form.dataset.saving) return;
        const attempt = pending;
        checking = true;
        message('Checking whether the original change saved. This does not save anything.');
        try {
          ++ticket;
          const next = await request();
          if (!live()) return;
          if (accessChanged(next)) { await hideUnavailableBudget(); return; }
          const {action,id} = attempt.data;
          const receipt = validConfirmation(next,attempt) &&
            next.budget.history.find(row=>row?.id===attempt.id && row.actor===identity && row.action===action &&
              (action==='budgetSettings' ? !!row.after :
                typeof row.after?.id==='string' && !!row.after.id && (!id || row.after.id===id)));
          if (!receipt) {
            drawUnconfirmed('No matching save was found in recent Budget history. The original could still have saved.');
            return;
          }
          const notice = form.querySelector('.form-error');
          confirmOriginal(next,attempt,draftSignature(),receipt,notice === document.activeElement);
        } catch (error) {
          if (!live()) return;
          if ([401,403,404].includes(error.status)) { await hideUnavailableBudget(); return; }
          drawUnconfirmed('Couldn’t check Budget history. The original save is still unconfirmed.');
        } finally { checking = false; }
      }
      async function submit(event, build) {
        event.preventDefault();
        event.stopPropagation();
        if (!live() || form.dataset.saving || checking) return;
        if (!pending && newLinkChoices) {
          const invalid = validateNewLinkChoices();
          if (invalid.length) {
            form.elements.namedItem(invalid[0])?.focus();
            return;
          }
        }
        if (blocked) return;
        // Capture successful controls before saveLock disables them.
        const data = { ...build(), revision }, key = JSON.stringify(data), draft = draftSignature();
        if (pending) {
          if (!allowReplay) {
            drawUnconfirmed();
            form.querySelector('.form-error').focus();
            return;
          }
          if (pending.key !== key || pending.draft !== draft) {
            drawUnconfirmed('Your newer edits have not been sent because the original change is still unconfirmed.');
            form.querySelector('.form-error').focus();
            return;
          }
          return send(pending,event.submitter || event.currentTarget,draft);
        }
        const id = crypto.randomUUID();
        return send({data,key,draft,id,body:JSON.stringify({...data,requestId:id})},event.submitter || event.currentTarget,draft);
      }
      async function send(attempt, submitter, currentDraft) {
        form.dataset.saving = 'true';
        const release = saveLock(
          form.closest('#dialog') || form,
          submitter,
        );
        message('');
        try {
          ++ticket;
          const next = await request(attempt.body);
          if (!live()) return;
          if (accessChanged(next)) { await hideUnavailableBudget(); return; }
          if (!validConfirmation(next,attempt)) throw new Error('Incomplete Budget confirmation.');
          confirmOriginal(next,attempt,currentDraft);
        } catch (error) {
          if (!live()) return;
          if ([401,403,404].includes(error.status)) { await hideUnavailableBudget(); return; }
          if (pending || !error.status || [408,429].includes(error.status) || error.status>=500) {
            pending = attempt;
            form.dataset.budgetUnconfirmed = 'true';
            drawUnconfirmed(error.status===409?'The retry conflicted. The original change is still unconfirmed.':undefined);
            form.querySelector('.form-error').focus();
            return;
          }
          const linkError = error.status === 400 && error.code === 'budget_link_unavailable';
          if (attempt.data.action === 'budgetItem' && (linkError || error.status === 409)) {
            if (cost) {
              staleLinkError = linkError;
              setBlocked(true);
              checked = null;
              drawRecovery();
              if (linkError) form.querySelector('.form-error').focus();
              return;
            }
            if (refreshWorkspace) {
              newLinkChoices = null;
              setBlocked(true);
              drawNewLinkRefresh(linkError
                ? 'A selected owner or task is no longer available. Refresh the choices without losing your draft.'
                : 'Budget changed. Refresh the choices without losing your draft.');
              form.querySelector('.form-error').focus();
              return;
            }
          }
          message(error.message);
          if (error.status === 409) {
            const reload = document.createElement('button');
            reload.type = 'button';
            reload.className = 'text-button';
            reload.textContent = 'Discard this edit & reload latest budget';
            reload.addEventListener('click', () => {
              closeDialog();
              load();
            });
            form.querySelector('.form-error').append(reload);
          }
        } finally {
          delete form.dataset.saving;
          release();
        }
      }
      form.addEventListener('submit', (event) =>
        submit(event, () => action(cost ? costFields() : Object.fromEntries(new FormData(form)))),
      );
      form.addEventListener('change', event => {
        if (newLinkChoices && !pending && live() && isCostLink(event.target.name)) showNewLinkStatus();
      });
      form
        .querySelector('[data-budget-archive]')
        ?.addEventListener('click', (event) =>
          submit(event, () => ({
            action: 'budgetArchive',
            id: form.dataset.itemId,
            archived: !archived,
          })),
        );
      return form;
    }
    function settingsDialog() {
      if (!state?.identity.admin) return;
      const budget = state.budget;
      dialog(
        'Budget settings',
        `<label class="check-field"><input name="enabled" type="checkbox" ${budget.enabled ? 'checked' : ''}> Use budget tracker</label><p class="muted">Turning it off preserves costs and history.</p><label class="field">Event currency<select name="currency" ${budget.items.length ? 'disabled' : ''}>${Object.keys(
          B.currencies,
        )
          .map(
            (code) =>
              `<option ${code === budget.currency ? 'selected' : ''}>${code}</option>`,
          )
          .join(
            '',
          )}</select><small>One currency. Locked after the first cost; no conversions.</small></label><label class="field">Budget target (optional, ${h(budget.currency)})<input name="target" inputmode="decimal" value="${h(B.inputAmount(budget.target, budget.currency))}" maxlength="18" placeholder="Not recorded"></label>`,
        (data) => ({
          action: 'budgetSettings',
          settings: {
            enabled: data.enabled === 'on',
            currency: budget.items.length ? budget.currency : data.currency,
            target: data.target,
          },
        }),
        true,
      );
    }
    function itemDialog(id) {
      if (!state?.identity.admin || !state.budget.enabled) return;
      const budget = state.budget,
        row = budget.items.find((item) => item.id === id),
        inactive = !!row?.archivedAt;
      const value = row || {
          title: '',
          estimate: null,
          committed: null,
          paid: null,
          owner: '',
          taskId: '',
          dueDate: '',
          status: 'active',
        },
        workspace = getWorkspace();
      const option = (id, label, selected) =>
        `<option value="${h(id)}" ${selected ? 'selected' : ''}>${h(label)}</option>`;
      const optionsFor = key => linkChoices(key, value[key], workspace)
        .map(([id,label])=>option(id,label,id===value[key])).join('');
      const ownerOptions = optionsFor('owner'), taskOptions = optionsFor('taskId');
      const historicalNote = !inactive && costLinkKeys.some(key=>value[key] && !linkIsCurrent(key,value[key],workspace))
        ? '<p class="muted">Unavailable links can stay on this cost for reference. You can save other changes, or clear or replace the links here.</p>'
        : '';
      const form = dialog(
        row ? 'Cost details' : 'Add cost',
        `<fieldset ${inactive ? 'disabled' : ''}><div class="form-grid"><label class="field full-width">Cost name<input name="title" required maxlength="120" value="${h(value.title)}" placeholder="e.g. School dance venue deposit"></label>${[
          ['estimate', 'Estimate'],
          ['committed', 'Committed amount'],
          ['paid', 'Payment recorded'],
        ]
          .map(
            ([key, label]) =>
              `<label class="field">${label} (${h(budget.currency)})<input name="${key}" inputmode="decimal" maxlength="18" value="${h(B.inputAmount(value[key], budget.currency))}" placeholder="Not recorded"></label>`,
          )
          .join(
            '',
          )}<label class="field">Owner<select name="owner">${ownerOptions}</select></label><label class="field">Linked task<select name="taskId">${taskOptions}</select></label><label class="field">Due date<input name="dueDate" type="date" value="${h(value.dueDate)}"></label><label class="field">Status<select name="status">${option('active', 'Active', value.status === 'active')}${option('cancelled', 'Cancelled', value.status === 'cancelled')}</select></label></div></fieldset>${historicalNote}<p class="muted">Blank = not recorded, not zero. Enter plain numbers with up to ${B.currencies[budget.currency]} decimal places. Committed means an agreed cost; payment recorded means a payment you manually report. Record net paid after any refunds. Cancelling keeps recorded payments in totals.</p>${row ? `<button class="text-button" type="button" data-budget-archive>${inactive ? 'Restore cost' : 'Archive cost (still included in totals)'}</button>` : ''}`,
        (data) => ({ action: 'budgetItem', id: row?.id || '', item: data }),
        !inactive,
        row && !inactive ? {row,currency:budget.currency} : null,
      );
      form.dataset.itemId = row?.id || '';
    }
    function unmount(keepPendingFocus = false) {
      rememberDisclosures();
      if (!keepPendingFocus || !mayFinishLinkedTaskFocus() || pendingFocus.origin.scope !== scopeKey()) pendingFocus = null;
      ++ticket;
      clearInterval(timer);
      host = null;
      state = null;
    }
    function mount(element) {
      unmount(true);
      if (disclosureScope !== scopeKey()) {
        disclosureScope = scopeKey();
        archived = reviewingIncomplete = false;
        expanded.clear();
      }
      host = element;
      if (!host) return;
      if (pendingFocus && !isDialogOpen()) {
        const heading = host.querySelector('#budgetHeading');
        if (heading) focusControl(heading);
        pendingFocus.from = document.activeElement;
      }
      host.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.budgetReviewIncomplete) reviewIncompleteCosts(button);
        if (button.dataset.budgetShowAll) showAllCosts(button);
        if (button.hasAttribute('data-budget-refresh')) load();
        if (button.hasAttribute('data-budget-settings')) settingsDialog();
        if (button.hasAttribute('data-budget-add')) itemDialog();
        if (button.dataset.budgetEdit) itemDialog(button.dataset.budgetEdit);
      });
      host.addEventListener('change', (event) => {
        if (event.target.hasAttribute('data-budget-archived') && canChangeReview(event.target)) {
          archived = event.target.checked;
          reviewingIncomplete = false;
          render();
        }
      });
      load();
      timer = setInterval(() => {
        if (!host?.isConnected) unmount();
        else if (!document.hidden && !isDialogOpen()) load(true);
      }, 15000);
    }
    return {
      markup: () =>
        '<div id="eventBudget"><h1 id="budgetHeading" tabindex="-1">Budget</h1><p role="status">Loading budget…</p></div>',
      mount,
      unmount,
      resolveLinkedTask,
      restoreLinkedTaskFocus,
    };
  }
  root.GatherBudgetUI = { create };
})(window);
