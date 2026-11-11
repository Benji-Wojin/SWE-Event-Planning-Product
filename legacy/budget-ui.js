(function (root) {
  'use strict';
  function create({
    h,
    openDialog,
    closeDialog,
    toast,
    saveLock,
    isDialogOpen,
    getWorkspace,
  }) {
    const B = root.GatherBudget;
    let host = null,
      state = null,
      archived = false,
      ticket = 0,
      timer;
    const endpoint = () => {
      const params = new URLSearchParams(
        root.GatherMode?.demo
          ? { demo: '1', as: root.GatherMode.actor }
          : { project: root.GatherMode?.projectId || 'main' },
      );
      return '/api/info?' + params;
    };
    async function request(data) {
      const controller = new AbortController(),
        timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(endpoint(), {
          method: data ? 'POST' : 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          headers: data
            ? { 'X-Gather-Request': '1', 'Content-Type': 'application/json' }
            : {},
          body: data ? JSON.stringify(data) : undefined,
        });
        const next = await response.json();
        if (!response.ok) {
          const error = new Error(next.error || 'Budget could not be saved.');
          error.status = response.status;
          throw error;
        }
        return next;
      } catch (error) {
        if (error.name === 'AbortError')
          throw new Error(
            'The request timed out. Your edits are still here. Retry the same save safely, or close and reload to check whether it saved.',
          );
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    const money = (value) => h(B.format(value, state.budget.currency));
    function subtotal(value) {
      return (
        money(value.known) +
        (value.unknown
          ? `<small>Partial · ${value.unknown} missing</small>`
          : '')
      );
    }
    function render() {
      if (!host?.isConnected || !state) return;
      const active = document.activeElement;
      const focus = host.contains?.(active)
        ? [...active.attributes].find(
            (attribute) =>
              attribute.name.startsWith('data-budget-') ||
              attribute.name === 'data-id',
          )
        : null;
      const expanded = new Set(
        [...(host.querySelectorAll?.('details[open]') || [])].map(
          (details) => details.dataset.budgetDetails,
        ),
      );
      const focusedDetails =
        active?.tagName === 'SUMMARY'
          ? active.parentElement.dataset.budgetDetails
          : '';
      const budget = state.budget,
        admin = state.identity.admin,
        totals = B.totals(budget);
      const rows = budget.items.filter(
          (row) => Boolean(row.archivedAt) === archived,
        ),
        workspace = getWorkspace();
      const targetNote = budget.target === null ? 'No target set' : totals.remaining === null ? 'Remaining budget unknown' : totals.remaining === 0 ? 'On target' : totals.remaining > 0 ? `${money(totals.remaining)} below target` : `${money(-totals.remaining)} over target`;
      host.innerHTML = `<div class="page-heading"><h1>Budget</h1><div class="header-actions">${admin ? '<button class="btn ' + (budget.enabled ? 'btn-secondary' : 'btn-primary') + '" data-budget-settings>' + (budget.enabled ? 'Settings' : 'Set up budget') + '</button>' : ''}${admin && budget.enabled && !archived ? '<button class="btn btn-primary" data-budget-add>Add cost</button>' : ''}</div></div><p class="muted">Shared with your project. Weft tracks amounts you enter and never moves money.</p>${
        !budget.enabled
          ? `<section class="panel"><h2>${budget.items.length ? 'Budget tracking is off' : 'Keep costs in view, when you need to'}</h2><p>${budget.items.length ? 'Saved costs are preserved. The organizer can enable tracking again in Budget settings.' : 'Track estimates, commitments and payments you record yourself. Skip this page if your event does not need a budget.'}</p>${!admin ? '<p class="muted">Only the organizer can enable or edit this tracker.</p>' : ''}</section>`
          : `<div class="budget-totals"><section class="panel budget-forecast"><h2>Expected total</h2><strong>${subtotal(totals.forecast)}</strong></section><section class="panel"><h2>Paid so far</h2><strong>${subtotal(totals.paid)}</strong></section><section class="panel"><h2>Budget target</h2><strong>${money(budget.target)}<small>${targetNote}</small></strong></section></div><section class="panel section-gap"><div class="toolbar"><h2>${archived ? 'Archived costs' : 'Costs'}</h2><label class="check-field"><input type="checkbox" data-budget-archived ${archived ? 'checked' : ''}> Show archived</label></div>${!admin ? '<p class="muted">View only. Ask the organizer to update costs.</p>' : ''}${
              rows.length
                ? `<ul class="budget-items">${rows
                    .map((row) => {
                      const task = workspace.tasks.find(
                          (task) => task.id === row.taskId,
                        ),
                        owner = workspace.members.find(
                          (member) => member.id === row.owner,
                        );
                      const metadata=[owner?.name || (row.owner ? 'Former / unavailable member' : ''),row.dueDate ? 'Due '+row.dueDate : ''].filter(Boolean);
                      return `<li><div class="budget-item-heading"><h3>${h(row.title)}</h3>${row.status === 'cancelled' ? '<span class="chip">Cancelled</span>' : ''}${admin ? `<button class="text-button" data-budget-edit="${h(row.id)}">${archived ? 'View / restore' : 'Edit'}<span class="sr-only"> ${h(row.title)}</span></button>` : ''}</div><dl class="budget-amounts">${[
                        ['estimate', 'Estimate'],
                        ['committed', 'Committed'],
                        ['paid', 'Paid'],
                      ]
                        .map(
                          ([key, label]) =>
                            `<div><dt>${label}</dt><dd>${money(row[key])}</dd></div>`,
                        )
                        .join('')}</dl>${metadata.length ? `<p class="muted">${h(metadata.join(' · '))}</p>` : ''}${task ? `<button class="text-button" data-action="task" data-id="${h(task.id)}">Task: ${h(task.title)}</button>` : row.taskId ? '<p class="muted">Linked task is no longer available.</p>' : ''}</li>`;
                    })
                    .join('')}</ul>`
                : `<p class="notice">${archived ? 'No archived costs.' : 'No costs yet. Add a quote, deposit or other expected expense.'}</p>`
            }</section>`
      }<section class="panel section-gap budget-reference">${budget.enabled ? `<details data-budget-details="totals"><summary>How totals work</summary><p>Estimates ${subtotal(totals.estimate)} · Commitments ${subtotal(totals.committed)}</p><p>Expected total uses each committed amount or, if blank, its estimate. It is never less than what’s recorded as paid. Cancelled costs contribute only recorded payments. Archived costs still count. Blank is unknown, not zero.</p></details>` : ''}<details data-budget-details="history"><summary>Recent budget changes (${budget.history.length})</summary><p class="muted">Latest 100 changes. This is a planning record, not a bank statement.</p><ol class="budget-history">${
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
      if (focus)
        [...host.querySelectorAll('button,input')]
          .find((control) => control.getAttribute(focus.name) === focus.value)
          ?.focus({ preventScroll: true });
    }
    async function load(quiet = false) {
      const mine = ++ticket,
        target = host;
      try {
        const next = await request();
        if (mine !== ticket || target !== host || !target?.isConnected) return;
        const unchanged =
          state &&
          JSON.stringify(state.budget) === JSON.stringify(next.budget) &&
          state.identity.admin === next.identity.admin;
        state = next;
        if (!quiet || !unchanged) render();
      } catch (error) {
        if (mine !== ticket || target !== host || !target?.isConnected) return;
        // Never leave a stale budget visible after revoked access or a failed refresh.
        state = null;
        target.innerHTML = `<h1>Budget</h1><p class="notice" role="alert">${h(error.message)}</p><button class="btn btn-secondary" data-budget-refresh>Retry</button>`;
      }
    }
    function dialog(title, markup, action, fields) {
      const revision = state.revision,
        ids = new Map();
      openDialog(
        title,
        `<form id="budgetForm">${markup}<p class="muted">Shared with project members. Saving only records information; it never moves money.</p><div class="form-error" role="alert"></div><div class="form-actions">${fields ? '<button class="btn btn-primary" type="submit">Save</button>' : ''}<button class="btn btn-secondary" type="button" data-budget-close>Cancel</button></div></form>`,
        '',
        false,
        'budget',
      );
      const form = document.getElementById('budgetForm');
      form
        .querySelector('[data-budget-close]')
        .addEventListener('click', closeDialog);
      async function submit(event, build) {
        event.preventDefault();
        event.stopPropagation();
        if (form.dataset.saving) return;
        // Capture successful controls before saveLock disables them.
        const data = { ...build(), revision },
          key = JSON.stringify(data);
        form.dataset.saving = 'true';
        const release = saveLock(
          form.closest('#dialog') || form,
          event.submitter || event.currentTarget,
        );
        const errorNode = form.querySelector('.form-error');
        errorNode.textContent = '';
        try {
          if (!ids.has(key)) ids.set(key, crypto.randomUUID());
          ++ticket;
          const next = await request({ ...data, requestId: ids.get(key) });
          state = next;
          render();
          closeDialog();
          toast('Budget saved. No payment was made.');
        } catch (error) {
          errorNode.textContent = error.message;
          if (error.status === 409) {
            const reload = document.createElement('button');
            reload.type = 'button';
            reload.className = 'text-button';
            reload.textContent = 'Discard this edit & reload latest budget';
            reload.addEventListener('click', () => {
              closeDialog();
              load();
            });
            errorNode.append(reload);
          }
          if (
            error.status === 401 ||
            error.status === 403 ||
            error.status === 404
          ) {
            state = null;
            closeDialog();
            await load();
          }
        } finally {
          delete form.dataset.saving;
          release();
        }
      }
      form.addEventListener('submit', (event) =>
        submit(event, () => action(Object.fromEntries(new FormData(form)))),
      );
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
      const owners = workspace.members.filter(
        (member) =>
          member.active !== false && !member.role.startsWith('Former'),
      );
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
          )}<label class="field">Owner<select name="owner">${option('', 'No owner', !value.owner)}${value.owner && !owners.some((owner) => owner.id === value.owner) ? option(value.owner, 'Former / unavailable member — choose a new owner', true) : ''}${owners.map((owner) => option(owner.id, owner.name, owner.id === value.owner)).join('')}</select></label><label class="field">Linked task<select name="taskId">${option('', 'No task', !value.taskId)}${value.taskId && !workspace.tasks.some((task) => task.id === value.taskId) ? option(value.taskId, 'Unavailable task — choose another', true) : ''}${workspace.tasks.map((task) => option(task.id, task.title, task.id === value.taskId)).join('')}</select></label><label class="field">Due date<input name="dueDate" type="date" value="${h(value.dueDate)}"></label><label class="field">Status<select name="status">${option('active', 'Active', value.status === 'active')}${option('cancelled', 'Cancelled', value.status === 'cancelled')}</select></label></div></fieldset><p class="muted">Blank = not recorded, not zero. Enter plain numbers with up to ${B.currencies[budget.currency]} decimal places. Committed means an agreed cost; payment recorded means a payment you manually report. Record net paid after any refunds. Cancelling keeps recorded payments in totals.</p>${row ? `<button class="text-button" type="button" data-budget-archive>${inactive ? 'Restore cost' : 'Archive cost (still included in totals)'}</button>` : ''}`,
        (data) => ({ action: 'budgetItem', id: row?.id || '', item: data }),
        !inactive,
      );
      form.dataset.itemId = row?.id || '';
    }
    function unmount() {
      ++ticket;
      clearInterval(timer);
      host = null;
      state = null;
    }
    function mount(element) {
      unmount();
      host = element;
      if (!host) return;
      host.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.hasAttribute('data-budget-refresh')) load();
        if (button.hasAttribute('data-budget-settings')) settingsDialog();
        if (button.hasAttribute('data-budget-add')) itemDialog();
        if (button.dataset.budgetEdit) itemDialog(button.dataset.budgetEdit);
      });
      host.addEventListener('change', (event) => {
        if (event.target.hasAttribute('data-budget-archived')) {
          archived = event.target.checked;
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
        '<div id="eventBudget"><h1>Budget</h1><p role="status">Loading budget…</p></div>',
      mount,
      unmount,
    };
  }
  root.GatherBudgetUI = { create };
})(window);
