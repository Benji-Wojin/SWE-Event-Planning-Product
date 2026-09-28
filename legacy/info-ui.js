(function (root) {
  'use strict';
  function create({
    h,
    openDialog,
    closeDialog,
    toast,
    saveLock,
    isDialogOpen,
  }) {
    let state = null,
      host = null,
      tab = 'guests',
      query = '',
      type = '',
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
        error(form, e);
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
          ? `<div class="info-table-wrap"><table class="info-table"><thead><tr><th>Name / contact</th><th>Type</th><th>Group</th><th>Attendance</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${guests.map((g) => `<tr><td><strong>${h(g.name)}</strong><span>${h(g.email || g.phone || 'No contact details')}</span></td><td>${h(g.type)}</td><td>${h(g.group || '—')}</td><td>${h(g.attendance === 'unknown' ? 'Not recorded' : g.attendance)}</td><td><button class="text-button" data-info-guest="${h(g.id)}">${archived ? 'View' : 'Edit'}</button></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="notice">' +
            (query || type
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
      host.innerHTML = `<div class="page-heading"><h1>Event info</h1><div class="header-actions"><button class="btn btn-secondary btn-small" data-info-refresh>Refresh</button>${tab === 'guests' && !archived ? '<button class="btn btn-secondary" data-info-import>Import CSV</button><button class="btn btn-primary" data-info-add>Add guest</button>' : tab === 'files' && !archived ? '<button class="btn btn-primary" data-info-upload>Upload file</button>' : ''}</div></div><section class="panel"><div class="toolbar"><div class="filter-tabs" role="group" aria-label="Event info views">${[
        ['guests', 'Guest list'],
        ['files', 'Files'],
      ]
        .map(
          ([key, label]) =>
            `<button class="filter-tab ${tab === key ? 'active' : ''}" aria-pressed="${tab === key}" data-info-tab="${key}">${label}</button>`,
        )
        .join(
          '',
        )}</div><label class="check-field"><input type="checkbox" data-info-archived ${archived ? 'checked' : ''}> Archived</label></div><p class="info-access muted">${tab === 'guests' ? 'Guests are contacts, not project members. No messages are sent.' : 'Shared with project members. Downloads require sign-in.'}</p>${tab === 'guests' ? `<div class="info-filters"><label class="field"><span class="sr-only">Find a guest</span><input type="search" data-info-search value="${h(query)}" placeholder="Find a guest, email or group…"></label><select data-info-type aria-label="Filter guest type"><option value="">All types</option>${opts(G.types, type)}</select></div>` : ''}<div data-info-list>${list()}</div></section>`;
      if (focus) {
        const next = [...host.querySelectorAll('button,input,select')].find(
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
        if (!state || next.revision !== state.revision || !quiet) {
          state = next;
          render();
        }
      } catch (e) {
        if (
          ticket === loadTicket &&
          host === target &&
          target?.isConnected &&
          (!quiet || e.status === 401 || e.status === 403)
        ) {
          if (e.status === 401 || e.status === 403) state = null;
          target.innerHTML =
            '<h1>Event info</h1><p class="notice" role="alert">' +
            h(e.message) +
            '</p><button class="btn btn-secondary" data-info-refresh>Retry</button>';
        }
      }
    }
    async function save(data) {
      ++loadTicket;
      state = await request(data);
      ++loadTicket;
      render();
      closeDialog();
      toast('Event info saved.');
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
          )}<label class="field">Type<select name="type" ${inactive ? 'disabled' : ''}>${opts(G.types, value.type)}</select></label><label class="field">Attendance<select name="attendance" ${inactive ? 'disabled' : ''}>${opts(G.attendance, value.attendance)}</select></label><label class="field full-width">Notes<textarea name="notes" rows="3" maxlength="500" ${inactive ? 'disabled' : ''}>${h(value.notes)}</textarea><small>Visible to the project team.</small></label></div>${guest ? '<p class="muted">Updated by ' + stamp(guest) + '</p>' : ''}<div class="form-actions">${!inactive ? '<button class="btn btn-primary" type="submit">Save guest</button>' : ''}${guest && state.identity.admin ? '<button class="text-button" type="button" data-info-archive-guest="' + h(guest.id) + '">' + (inactive ? 'Restore guest' : 'Archive guest') + '</button>' : ''}</div></form>`,
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
          link.download = 'gather-guest-template.csv';
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
      const revision = state.revision,
        requestId = crypto.randomUUID();
      openDialog(
        'Upload project file',
        '<form id="projectUploadForm"><label class="field">File<input name="file" type="file" accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.docx,.xlsx" required></label><p class="muted">Up to 5 MB. PDF, text, CSV, images, Word or Excel.</p><p class="notice">Only upload information the project team may access. Files are not malware-scanned.</p><div class="form-actions"><button class="btn btn-primary" type="submit">Upload file</button></div></form>',
        '',
        false,
        'info',
      );
      const form = document.getElementById('projectUploadForm');
      form.addEventListener('submit', (event) => {
        const file = form.elements.file.files[0];
        submit(form, event, async () => {
          if (!file || !file.size || file.size > 5 * 1024 * 1024)
            throw new Error('Choose a non-empty file up to 5 MB.');
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
        if (el.hasAttribute('data-info-import')) importDialog();
        if (el.hasAttribute('data-info-upload')) uploadDialog();
        if (el.dataset.infoArchiveFile) fileArchive(el.dataset.infoArchiveFile);
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
