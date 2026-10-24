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
    let state = null,
      host = null,
      tab = 'guests',
      query = '',
      type = '',
      arrival = '',
      archived = false,
      timer,
      loadTicket = 0;
    const G = root.GatherGuests;
    const endpoint = (extra = {}) => {
      const p = new URLSearchParams(extra);
      if (root.GatherMode?.demo) {
        p.set('demo', '1');
        p.set('as', root.GatherMode.actor);
      } else p.set('project', root.GatherMode?.projectId || 'main');
      return '/api/info?' + p;
    };
    const opts = (values, value) =>
      values
        .map(
          (item) =>
            `<option value="${h(item)}" ${item === value ? 'selected' : ''}>${h(item === 'unknown' ? 'Not recorded' : item.charAt(0).toUpperCase() + item.slice(1))}</option>`,
        )
        .join('');
    const bytes = (n) =>
      n < 1024 * 1024
        ? Math.ceil(n / 1024) + ' KB'
        : (n / 1024 / 1024).toFixed(1) + ' MB';
    const stamp = (record) =>
      h(record.updatedName) +
      ' · ' +
      h(new Date(record.updatedAt).toLocaleDateString());
    const availability = { available:'Can attend', maybe:'Maybe', unavailable:'Cannot attend' };
    const dateLabel = date => new Date(date+'T12:00:00Z').toLocaleDateString(undefined,{weekday:'short',year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
    function datePollMarkup() {
      const polls=state.datePolls||[];
      return `<div class="page-heading"><h1>Date availability</h1><div class="header-actions"><button class="btn btn-secondary btn-small" data-info-refresh>Refresh</button>${state.identity.admin?'<button class="btn btn-primary" data-info-new-poll>Propose dates</button>':''}</div></div><div class="filter-tabs" role="group" aria-label="Event info views"><button class="filter-tab" aria-pressed="false" data-info-tab="guests">Guest list</button><button class="filter-tab" aria-pressed="false" data-info-tab="files">Files</button><button class="filter-tab active" aria-pressed="true" data-info-tab="dates">Date availability</button></div><p class="notice">Project-team planning only. Your name and availability responses are visible to project members. This is not a guest RSVP, booking or commitment. No event date, activity time or task changes automatically, and no messages are sent.</p><p class="muted">Only the organizer proposes dates and closes or reopens polls. Each person can change only their own response. Recorded responses may include former project members; missing responses are not a “cannot attend”.</p><div class="availability-polls">${polls.map(poll=>`<section class="panel"><div class="panel-heading"><h2>${h(poll.title)}</h2><span class="chip">${poll.closedAt?'Closed':'Open'}</span></div><p>Dates in ${h(poll.timeZone)} · ${poll.responses.length} recorded response${poll.responses.length===1?'':'s'}</p><p class="muted">Proposed by ${h(poll.createdName)} · ${h(new Date(poll.createdAt).toLocaleDateString())}. Date options stay fixed; propose another poll if they need to change.</p><ul class="availability-dates">${poll.dates.map(date=>{
        const answers=poll.responses.map(response=>({name:response.name,answer:response.answers.find(answer=>answer.date===date)?.availability||''}));
        const key=poll.id+'-'+date;
        return `<li><strong>${h(dateLabel(date))}</strong><p>${Object.entries(availability).map(([value,label])=>`${answers.filter(row=>row.answer===value).length} ${h(label.toLowerCase())}`).join(' · ')}</p><details data-info-responses="${h(key)}"><summary data-info-poll-summary="${h(key)}">Recorded responses for ${h(dateLabel(date))}</summary>${answers.length?`<ul>${answers.map(row=>`<li>${h(row.name)} · ${h(availability[row.answer]||'No response for this date')}</li>`).join('')}</ul>`:'<p class="muted">No responses recorded.</p>'}</details></li>`;
      }).join('')}</ul><div class="inline">${!poll.closedAt?`<button class="btn btn-secondary" data-info-poll-vote="${h(poll.id)}">${poll.responses.some(row=>row.actor===state.identity.actor)?'Edit':'Record'} my availability<span class="sr-only"> for ${h(poll.title)}</span></button>`:''}${state.identity.admin?`<button class="text-button" data-info-poll-close="${h(poll.id)}">${poll.closedAt?'Reopen':'Close'} poll<span class="sr-only"> ${h(poll.title)}</span></button>`:''}</div></section>`).join('')||'<section class="panel"><h2>No date options yet</h2><p>The organizer can propose dates for the team to compare before agreeing when to meet.</p></section>'}</div>`;
    }
    async function request(data, extra) {
      const response = await fetch(endpoint(extra), {
        method: data ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: data
          ? {
              'X-Gather-Request': '1',
              ...(data instanceof FormData
                ? {}
                : { 'Content-Type': 'application/json' }),
            }
          : {},
        body: data
          ? data instanceof FormData
            ? data
            : JSON.stringify(data)
          : undefined,
      });
      let value;
      try {
        value = await response.json();
      } catch {
        throw new Error(
          'Event info could not be loaded. Retry when your connection returns.',
        );
      }
      if (!response.ok) {
        const error = new Error(value.error || 'Unable to save event info.');
        error.status = response.status;
        throw error;
      }
      return value;
    }
    function error(form, error) {
      let node = form.querySelector('.form-error');
      if (!node) {
        node = document.createElement('p');
        node.className = 'form-error';
        node.setAttribute('role', 'alert');
        form.prepend(node);
      }
      node.textContent = error.message;
    }
    const accessDenied = error => [401, 403, 404].includes(error.status);
    function loadError(error) {
      // A denial invalidates the cache too: remounting must not reveal it
      // while the next request is pending. Ignore any older in-flight load.
      const ownedDialog = isDialogOpen('info');
      const restoreFocus = ownedDialog || host?.contains(document.activeElement);
      ++loadTicket;
      state = null;
      if (accessDenied(error) && ownedDialog) closeDialog();
      if (host?.isConnected) host.innerHTML =
        '<h1>Event info</h1><p class="notice" role="alert">' +
        h(error.message) +
        '</p><button class="btn btn-secondary" data-info-refresh>Retry</button>';
      if (restoreFocus && !isDialogOpen()) host?.querySelector('[data-info-refresh]')?.focus();
    }
    async function submit(form, event, action) {
      event.preventDefault();
      event.stopPropagation();
      if (form.dataset.saving) return;
      const release = saveLock(
        form.closest('#dialog') || form,
        event.submitter,
      );
      try {
        await action();
      } catch (e) {
        if (accessDenied(e)) {
          loadError(e);
        } else error(form, e);
      } finally {
        release();
      }
    }
    function markup() {
      return '<div id="eventInfo"><h1>Event info</h1><p class="muted" role="status">Loading…</p></div>';
    }
    function rows() {
      return (state?.guests || []).filter(
        (g) =>
          Boolean(g.archivedAt) === archived &&
          (!type || g.type === type) &&
          (!arrival || (arrival === 'arrived') === !!g.arrival?.at) &&
          (!query ||
            [g.name, g.email, g.group, g.phone]
              .join(' ')
              .toLowerCase()
              .includes(query.toLowerCase())),
      );
    }
    function list() {
      if (tab === 'files') {
        const files = state.files.filter(
          (f) => Boolean(f.archivedAt) === archived,
        );
        return files.length
          ? '<ul class="info-files">' +
              files
                .map(
                  (f) =>
                    `<li><div><strong>${h(f.name)}</strong><p class="muted">${bytes(f.size)} · ${stamp(f)}</p></div><div class="info-file-actions">${!archived ? `<a class="btn btn-secondary btn-small" href="${h(endpoint({ file: f.id }))}" download>Download</a>` : ''}${f.canArchive ? `<button class="text-button" data-info-archive-file="${h(f.id)}">${archived ? 'Restore' : 'Archive'}</button>` : ''}</div></li>`,
                )
                .join('') +
              '</ul>'
          : '<p class="notice">' +
              (archived ? 'No archived files.' : 'No files yet.') +
              '</p>';
      }
      const guests = rows();
      return (
        `<div class="info-count muted">${guests.length} ${guests.length === 1 ? 'guest' : 'guests'}</div>` +
        (guests.length
          ? `<div class="info-table-wrap"><table class="info-table"><thead><tr><th>Name / contact</th><th>Type</th><th>Group</th><th>RSVP response</th><th>Arrival record</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${guests.map((g) => `<tr><td><strong>${h(g.name)}</strong><span>${h(g.email || g.phone || 'No contact details')}</span></td><td>${h(g.type)}</td><td>${h(g.group || '—')}</td><td>${h(g.attendance === 'unknown' ? 'Not recorded' : g.attendance)}</td><td>${g.arrival?.at ? `<strong>Arrival recorded</strong><span>${h(new Date(g.arrival.at).toLocaleString())} · ${h(g.arrival.name)}</span>` : 'No arrival recorded'}${!archived ? `<button class="text-button" data-info-arrival="${h(g.id)}" aria-label="${g.arrival?.at ? 'Review arrival for ' : 'Record arrival for '}${h(g.name)}">${g.arrival?.at ? 'Review / undo' : 'Record arrival'}</button>` : ''}</td><td><button class="text-button" data-info-guest="${h(g.id)}">${archived ? 'View' : 'Edit'}</button></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="notice">' +
            (query || type || arrival
              ? 'No guests match these filters.'
              : archived
                ? 'No archived guests.'
                : 'No guests yet. Add one or import a CSV.') +
            '</p>')
      );
    }
    function render() {
      if (!host?.isConnected || !state) return;
      const active = document.activeElement;
      const focus = host.contains(active)
        ? [...active.attributes].find((attribute) =>
            attribute.name.startsWith('data-info-'),
          )
        : null;
      const selection =
        focus && active.tagName === 'INPUT'
          ? [active.selectionStart, active.selectionEnd]
          : null;
      const summary = G.arrivalSummary(state.guests);
      const expanded=new Set([...(host.querySelectorAll?.('details[data-info-responses][open]')||[])].map(el=>el.dataset.infoResponses));
      if(tab==='dates') host.innerHTML=datePollMarkup();
      else host.innerHTML = `<div class="page-heading"><h1>Event info</h1><div class="header-actions"><button class="btn btn-secondary btn-small" data-info-refresh>Refresh</button>${tab === 'guests' && !archived ? '<button class="btn btn-secondary" data-info-import>Import CSV</button><button class="btn btn-primary" data-info-add>Add guest</button>' : tab === 'files' && !archived && state.uploadsAvailable === true ? '<button class="btn btn-primary" data-info-upload>Upload file</button>' : ''}</div></div><section class="panel"><div class="toolbar"><div class="filter-tabs" role="group" aria-label="Event info views">${[
        ['guests', 'Guest list'],
        ['files', 'Files'],
        ['dates', 'Date availability'],
      ]
        .map(
          ([key, label]) =>
            `<button class="filter-tab ${tab === key ? 'active' : ''}" aria-pressed="${tab === key}" data-info-tab="${key}">${label}</button>`,
        )
        .join(
          '',
        )}</div><label class="check-field"><input type="checkbox" data-info-archived ${archived ? 'checked' : ''}> Archived</label></div><p class="info-access muted">${tab === 'guests' ? 'Guests are contacts, not project members. No messages are sent. Arrival records are manual, separate from RSVP responses, and are not a live headcount or a release/safeguarding system.' : 'Shared with project members. Downloads require sign-in.'}</p>${tab === 'files' && state.uploadsAvailable !== true ? '<p class="notice" role="status">File uploads are unavailable. You can still manage the guest list.</p>' : ''}${tab === 'guests' ? `<p class="info-arrival-summary" role="status">Active guest list: <strong>${summary.arrived} arrival record${summary.arrived === 1 ? '' : 's'}</strong> · ${summary.attending} RSVP attending · ${summary.total} guest record${summary.total === 1 ? '' : 's'}. Totals exclude archived guests and do not change with filters.</p><div class="info-filters"><label class="field"><span class="sr-only">Find a guest</span><input type="search" data-info-search value="${h(query)}" placeholder="Find a guest, email or group…"></label><select data-info-type aria-label="Filter guest type"><option value="">All types</option>${opts(G.types, type)}</select><select data-info-arrival-filter aria-label="Filter arrival records"><option value="" ${!arrival ? 'selected' : ''}>All arrival records</option><option value="waiting" ${arrival === 'waiting' ? 'selected' : ''}>No arrival recorded</option><option value="arrived" ${arrival === 'arrived' ? 'selected' : ''}>Arrival recorded</option></select></div>` : ''}<div data-info-list>${list()}</div></section>`;
      for(const el of host.querySelectorAll?.('details[data-info-responses]')||[])el.open=expanded.has(el.dataset.infoResponses);
      if (focus) {
        const next = [...host.querySelectorAll('button,input,select,summary')].find(
          (element) => element.getAttribute(focus.name) === focus.value,
        );
        next?.focus({ preventScroll: true });
        if (selection && next?.setSelectionRange && selection[0] !== null)
          next.setSelectionRange(...selection);
      }
    }
    async function load(quiet = false) {
      const target = host;
      const ticket = ++loadTicket;
      try {
        const next = await request();
        if (ticket !== loadTicket || host !== target || !target?.isConnected)
          return;
        const identityChanged = state && JSON.stringify(next.identity) !== JSON.stringify(state.identity);
        if (identityChanged && isDialogOpen('info')) {
          closeDialog();
          toast('Your project identity changed. Reopen the editor to review the current values.');
        }
        if (!state || next.revision !== state.revision || next.uploadsAvailable !== state.uploadsAvailable || identityChanged || !quiet) {
          state = next;
          render();
        }
      } catch (e) {
        if (
          ticket === loadTicket &&
          host === target &&
          target?.isConnected &&
          (!quiet || accessDenied(e))
        ) {
          loadError(e);
        }
      }
    }
    async function save(data, message = 'Event info saved.') {
      ++loadTicket;
      state = await request(data);
      ++loadTicket;
      render();
      closeDialog();
      toast(message);
    }
    function pollForm(title,contents,onSave,message) {
      const revision=state.revision,requestId=crypto.randomUUID();
      openDialog(title,`<form id="datePollForm">${contents}<p class="notice">Shared with this project’s members only. No event settings or tasks change.</p><div class="form-actions"><button class="btn btn-primary" type="submit">Save</button><button class="text-button" type="button" data-poll-reload>Reload saved polls</button></div></form>`,'',false,'info');
      const form=document.getElementById('datePollForm');
      form.addEventListener('submit',event=>{
        // Disabled controls are omitted by native FormData. Capture first;
        // submit's save lock then protects exactly these reviewed values.
        const data=new FormData(form);
        return submit(form,event,()=>save({...onSave(data),revision,requestId},message));
      });
      form.querySelector('[data-poll-reload]').addEventListener('click',()=>{if(form.dataset.saving)return;closeDialog();void load();});
      return form;
    }
    function newPollDialog() {
      if(!state.identity.admin)return;
      const zone=getWorkspace?.()?.event?.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;
      const option=index=>`<label class="field" for="poll-option-${index}">Proposed date ${index}<input id="poll-option-${index}" name="date" type="date" ${index<=2?'required':''}></label>`;
      const form=pollForm('Propose event dates',`<label class="field">Poll title<input name="title" required maxlength="160"></label><label class="field section-gap">Dates are in this time zone<input name="timeZone" value="${h(zone)}" required maxlength="100"></label><p class="muted">Choose 2–12 different dates. Leave extra rows blank. These options will stay fixed so saved responses keep their meaning.</p><div data-poll-options class="form-grid">${option(1)+option(2)}</div><button class="text-button section-gap" type="button" data-poll-add-date>Add another date</button>`,data=>({action:'createDatePoll',poll:{title:data.get('title'),timeZone:data.get('timeZone'),dates:data.getAll('date').filter(Boolean)}}),'Date options saved. No event date was changed.');
      let count=2;
      const add=form.querySelector('[data-poll-add-date]');
      add.addEventListener('click',()=>{
        if(form.dataset.saving||count>=12)return;
        const box=document.createElement('div');box.innerHTML=option(++count);
        const label=box.firstElementChild;form.querySelector('[data-poll-options]').append(label);
        label.querySelector('input').focus();add.hidden=count>=12;
      });
    }
    function pollVoteDialog(id) {
      const poll=(state.datePolls||[]).find(row=>row.id===id);
      if(!poll||poll.closedAt)return;
      const own=poll.responses.find(row=>row.actor===state.identity.actor);
      pollForm('Your date availability',`<h3>${h(poll.title)}</h3><p>Calendar dates in ${h(poll.timeZone)}. Your name and choices will be visible to the project team.</p>${poll.dates.map(date=>`<label class="field section-gap">${h(dateLabel(date))}<select name="${h(date)}"><option value="">No response for this date</option>${Object.entries(availability).map(([value,label])=>`<option value="${h(value)}" ${own?.answers.some(answer=>answer.date===date&&answer.availability===value)?'selected':''}>${h(label)}</option>`).join('')}</select></label>`).join('')}<p class="muted">Saving replaces only your answers. Choose “No response” for every date to clear your response.</p>`,data=>({action:'respondDatePoll',id,answers:poll.dates.filter(date=>data.get(date)).map(date=>({date,availability:data.get(date)}))}),'Your availability was saved.');
    }
    function pollCloseDialog(id) {
      const poll=(state.datePolls||[]).find(row=>row.id===id);
      if(!poll||!state.identity.admin)return;
      pollForm(poll.closedAt?'Reopen date poll':'Close date poll',`<h3>${h(poll.title)}</h3><p>${poll.closedAt?'Members will be able to edit their own availability again.':'Members will no longer be able to edit availability in this poll. Saved responses are kept.'} This does not select a date. Agree the date with your team, then update Project settings separately.</p>`,()=>({action:'closeDatePoll',id,closed:!poll.closedAt}),poll.closedAt?'Date poll reopened.':'Date poll closed. Responses kept.');
    }
    function arrivalDialog(id) {
      const guest = state.guests.find((g) => g.id === id && !g.archivedAt);
      if (!guest) return;
      const arrived = !!guest.arrival?.at,
        revision = state.revision,
        requestId = crypto.randomUUID();
      openDialog(
        arrived ? 'Review guest arrival' : 'Record guest arrival',
        `<form id="guestArrivalForm"><h3>${h(guest.name)}</h3><p class="muted">RSVP response: ${h(guest.attendance === 'unknown' ? 'Not recorded' : guest.attendance)}</p>${arrived ? `<p>Arrival recorded by ${h(guest.arrival.name)} · ${h(new Date(guest.arrival.at).toLocaleString())}</p>` : '<p>Only record an arrival you have confirmed. No arrival time is inferred from an RSVP.</p>'}<p class="notice">${arrived ? 'Clear this record if the arrival was recorded by mistake. This does not record a departure.' : 'This records arrival now, using your signed-in project identity.'} RSVP response, task status and project access stay unchanged. Visible to the project team.</p><div class="form-actions"><button class="btn ${arrived ? 'btn-secondary' : 'btn-primary'}" type="submit">${arrived ? 'Clear arrival record' : 'Confirm arrival'}</button><button class="text-button" type="button" data-arrival-reload>Reload guest list</button></div></form>`,
        '', false, 'info',
      );
      const form = document.getElementById('guestArrivalForm');
      form.addEventListener('submit', (event) => submit(form, event, () => save({
        action: 'arrival', id, arrived: !arrived, revision, requestId,
      }, arrived ? 'Arrival record cleared. RSVP response unchanged.' : 'Arrival recorded. RSVP response unchanged.')));
      form.querySelector('[data-arrival-reload]').addEventListener('click', () => {
        if (form.dataset.saving) return;
        closeDialog();
        void load();
      });
    }
    function guestDialog(id) {
      const guest = state.guests.find((g) => g.id === id),
        value = guest || {
          name: '',
          email: '',
          phone: '',
          type: 'attendee',
          group: '',
          attendance: 'unknown',
          notes: '',
        };
      const revision = state.revision,
        requestId = crypto.randomUUID(),
        inactive = !!guest?.archivedAt;
      openDialog(
        guest ? 'Guest details' : 'Add guest',
        `<form id="guestInfoForm"><div class="form-grid">${[
          ['name', 'Name', 120],
          ['email', 'Email', 254],
          ['phone', 'Phone', 40],
          ['group', 'Group', 80],
        ]
          .map(
            ([field, label, max]) =>
              `<label class="field">${label}<input name="${field}" maxlength="${max}" ${field === 'name' ? 'required' : ''} ${field === 'email' ? 'type="email"' : ''} ${inactive ? 'disabled' : ''} value="${h(value[field])}"></label>`,
          )
          .join(
            '',
          )}<label class="field">Type<select name="type" ${inactive ? 'disabled' : ''}>${opts(G.types, value.type)}</select></label><label class="field">RSVP response<select name="attendance" ${inactive ? 'disabled' : ''}>${opts(G.attendance, value.attendance)}</select></label><label class="field full-width">Notes<textarea name="notes" rows="3" maxlength="500" ${inactive ? 'disabled' : ''}>${h(value.notes)}</textarea><small>Visible to the project team.</small></label></div>${guest ? '<p class="muted">Updated by ' + stamp(guest) + '</p>' : ''}<div class="form-actions">${!inactive ? '<button class="btn btn-primary" type="submit">Save guest</button>' : ''}${guest && state.identity.admin ? '<button class="text-button" type="button" data-info-archive-guest="' + h(guest.id) + '">' + (inactive ? 'Restore guest' : 'Archive guest') + '</button>' : ''}</div></form>`,
        '',
        false,
        'info',
      );
      const form = document.getElementById('guestInfoForm');
      form.addEventListener('submit', (event) => {
        const data = Object.fromEntries(new FormData(form));
        submit(form, event, () =>
          save({
            action: guest ? 'edit' : 'add',
            ...(guest ? { id: guest.id } : {}),
            guest: data,
            revision,
            requestId,
          }),
        );
      });
      form
        .querySelector('[data-info-archive-guest]')
        ?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          submit(form, event, () =>
            save({
              action: 'archiveGuest',
              id: guest.id,
              archived: !inactive,
              revision,
              requestId,
            }),
          );
        });
    }
    function importDialog() {
      const revision = state.revision,
        requestId = crypto.randomUUID();
      let csv = '',
        filename = '',
        preview = null;
      openDialog(
        'Import guest list',
        '<form id="guestImportForm"><label class="field">CSV file<input type="file" accept=".csv,text/csv" required name="csv"></label><p class="muted">Up to 100 guests / 40 KB. Existing emails are skipped, never overwritten.</p><button type="button" class="text-button" data-csv-template>Download template</button><div data-import-preview class="section-gap" aria-live="polite"></div><div class="form-actions"><button class="btn btn-primary" type="submit" disabled>Import guests</button></div></form>',
        '',
        true,
        'info',
      );
      const form = document.getElementById('guestImportForm'),
        box = form.querySelector('[data-import-preview]'),
        button = form.querySelector('[type=submit]');
      let selection = 0;
      form.elements.csv.addEventListener('change', async () => {
        const ticket = ++selection;
        preview = null;
        csv = '';
        button.disabled = true;
        box.innerHTML = '';
        const file = form.elements.csv.files[0];
        if (!file) return;
        try {
          if (file.size > 40000) throw new Error('Use a CSV up to 40 KB.');
          const raw = await file.text();
          const result = await request({
            action: 'preview',
            csv: raw,
            revision,
          });
          if (ticket !== selection || !form.isConnected) return;
          csv = raw;
          filename = file.name.slice(0, 120);
          preview = result;
          box.innerHTML = `<p><strong>${result.added} to add</strong> · ${result.duplicates} duplicate emails · ${result.invalid} invalid rows</p><div class="info-table-wrap"><table class="info-table"><thead><tr><th>Row</th><th>Guest</th><th>Result</th></tr></thead><tbody>${result.rows.map((row) => `<tr><td>${row.line}</td><td>${h(row.guest?.name || '—')}<span>${h(row.guest?.email || '')}</span></td><td>${h(row.message || 'Add guest')}</td></tr>`).join('')}</tbody></table></div>`;
          button.disabled = !!result.invalid || !result.added;
        } catch (e) {
          if (ticket === selection)
            box.innerHTML =
              '<p class="form-error" role="alert">' + h(e.message) + '</p>';
        }
      });
      form
        .querySelector('[data-csv-template]')
        .addEventListener('click', () => {
          const url = URL.createObjectURL(
            new Blob(['Name,Email,Phone,Type,Group,Attendance,Notes\r\n'], {
              type: 'text/csv',
            }),
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = 'weft-guest-template.csv';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
      form.addEventListener('submit', (event) =>
        submit(form, event, async () => {
          if (!preview || preview.invalid || !preview.added)
            throw new Error('Preview a valid guest list first.');
          await save({ action: 'import', csv, filename, revision, requestId });
        }),
      );
    }
    function uploadDialog() {
      if (state?.uploadsAvailable !== true) {
        toast('File uploads are unavailable.');
        return;
      }
      const revision = state.revision,
        requestId = crypto.randomUUID();
      openDialog(
        'Upload project file',
        '<form id="projectUploadForm"><label class="field">File<input name="file" type="file" accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.docx,.xlsx" required></label><p class="muted">Up to 4 MB. PDF, text, CSV, images, Word or Excel.</p><p class="notice">Only upload information the project team may access. Files are not malware-scanned.</p><div class="form-actions"><button class="btn btn-primary" type="submit">Upload file</button></div></form>',
        '',
        false,
        'info',
      );
      const form = document.getElementById('projectUploadForm');
      form.addEventListener('submit', (event) => {
        const file = form.elements.file.files[0];
        submit(form, event, async () => {
          if (!file || !file.size || file.size > 4 * 1024 * 1024)
            throw new Error('Choose a non-empty file up to 4 MB.');
          const data = new FormData();
          data.set('file', file);
          data.set('revision', revision);
          data.set('requestId', requestId);
          ++loadTicket;
          state = await request(data, { upload: '1' });
          ++loadTicket;
          render();
          closeDialog();
          toast('File uploaded.');
        });
      });
    }
    function fileArchive(id) {
      const file = state.files.find((f) => f.id === id),
        revision = state.revision,
        requestId = crypto.randomUUID();
      openDialog(
        archived ? 'Restore file' : 'Archive file',
        `<form id="archiveFileForm"><p>${h(file.name)}</p><p class="muted">Archived files remain recoverable and count toward storage.</p><div class="form-actions"><button type="submit" class="btn btn-primary">${archived ? 'Restore' : 'Archive'}</button></div></form>`,
        '',
        false,
        'info',
      );
      const form = document.getElementById('archiveFileForm');
      form.addEventListener('submit', (event) =>
        submit(form, event, () =>
          save({
            action: 'archiveFile',
            id,
            archived: !archived,
            revision,
            requestId,
          }),
        ),
      );
    }
    function mount(element) {
      host = element;
      if (!host) return;
      clearInterval(timer);
      if (state) render();
      load();
      host.addEventListener('click', (event) => {
        const el = event.target.closest('button');
        if (!el) return;
        if (el.hasAttribute('data-info-refresh')) load();
        if (el.dataset.infoTab) {
          tab = el.dataset.infoTab;
          archived = false;
          render();
        }
        if (el.hasAttribute('data-info-add')) guestDialog();
        if (el.dataset.infoGuest) guestDialog(el.dataset.infoGuest);
        if (el.dataset.infoArrival) arrivalDialog(el.dataset.infoArrival);
        if (el.hasAttribute('data-info-import')) importDialog();
        if (el.hasAttribute('data-info-upload')) uploadDialog();
        if (el.dataset.infoArchiveFile) fileArchive(el.dataset.infoArchiveFile);
        if (el.hasAttribute('data-info-new-poll')) newPollDialog();
        if (el.dataset.infoPollVote) pollVoteDialog(el.dataset.infoPollVote);
        if (el.dataset.infoPollClose) pollCloseDialog(el.dataset.infoPollClose);
      });
      host.addEventListener('input', (event) => {
        if (event.target.hasAttribute('data-info-search')) {
          query = event.target.value;
          host.querySelector('[data-info-list]').innerHTML = list();
        }
      });
      host.addEventListener('change', (event) => {
        if (event.target.hasAttribute('data-info-type')) {
          type = event.target.value;
          host.querySelector('[data-info-list]').innerHTML = list();
        }
        if (event.target.hasAttribute('data-info-arrival-filter')) {
          arrival = event.target.value;
          host.querySelector('[data-info-list]').innerHTML = list();
        }
        if (event.target.hasAttribute('data-info-archived')) {
          archived = event.target.checked;
          render();
        }
      });
      timer = setInterval(() => {
        if (!host?.isConnected) {
          clearInterval(timer);
          return;
        }
        if (!document.hidden && !isDialogOpen()) load(true);
      }, 10000);
    }
    return { markup, mount };
  }
  root.GatherInfoUI = { create };
})(window);
