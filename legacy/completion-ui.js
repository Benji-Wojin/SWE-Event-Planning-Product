(function (root) {
  'use strict';
  const h = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  function endpoint(file) {
    const params = new URLSearchParams(
      root.GatherMode?.demo
        ? { demo: '1', as: root.GatherMode.actor }
        : { project: root.GatherMode?.projectId || 'main' },
    );
    if (file) params.set('file', file);
    return '/api/info?' + params;
  }
  function fields(value = {}) {
    return (
      '<details class="completion-fields"><summary>Links &amp; shared files <span class="muted">optional</span></summary><p class="muted">Everyone in this project can see this evidence. Keep booking codes, private confirmations and credentials in Private details.</p><label class="field">Supporting links<textarea name="completionLinks" rows="2" maxlength="10300" placeholder="One public HTTPS link per line">' +
      h((value.links || []).join('\n')) +
      '</textarea></label><p class="muted">Up to 5 links. Weft does not open or verify them automatically.</p><label class="field">Existing shared files<select name="completionFileIds" multiple size="3">' +
      (value.fileIds || [])
        .map(
          (id) =>
            '<option selected value="' +
            h(id) +
            '">Saved project file · ' +
            h(id.slice(0, 8)) +
            '</option>',
        )
        .join('') +
      '</select></label><button type="button" class="btn btn-secondary btn-small" data-load-completion-files>Choose project files</button><p class="muted" data-completion-file-status>Upload files in Event info first. Up to 5 files; choose only material safe for the whole team.</p></details>'
    );
  }
  function collect(form, note) {
    return {
      note: note ?? form.elements.completionNote?.value ?? '',
      links: (form.elements.completionLinks?.value || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      fileIds: [
        ...(form.elements.completionFileIds?.selectedOptions || []),
      ].map((option) => option.value),
    };
  }
  function links(value) {
    return (
      (value.links?.length
        ? '<ul class="completion-links">' +
          value.links
            .map(
              (url) =>
                '<li><a href="' +
                h(url) +
                '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' +
                h(url) +
                '</a></li>',
            )
            .join('') +
          '</ul>'
        : '') +
      (value.fileIds?.length
        ? '<ul>' +
          value.fileIds
            .map(
              (id) =>
                '<li data-completion-file="' +
                h(id) +
                '">Shared file · availability not checked</li>',
            )
            .join('') +
          '</ul><button type="button" class="btn btn-secondary btn-small" data-check-completion-files>Check shared file availability</button>'
        : '')
    );
  }
  function section(task, canEdit) {
    const review=task.status!=='done'&&!task.reportedAt?task.completionReview:null;
    if (
      task.status !== 'done' &&
      !task.reportedAt &&
      !(task.completionEvidenceHistory || []).length &&
      !review
    )
      return '';
    const value = task.completionEvidence;
    return (
      '<section class="completion-evidence section-gap"><h3>Completion details</h3><p class="muted">Shared context, not independent verification.</p>' +
      (review?'<section class="notice" aria-label="Completion changes requested"><h4>Changes requested</h4><p>'+h(review.note)+'</p><p class="muted">Organizer review · '+h(new Date(review.at).toLocaleString())+'. The owner can update the work and submit a new completion report. Nothing was verified; earlier evidence remains below.</p></section>':'')+
      (value && task.verifiedAt && !task.completionEvidenceReviewAt
        ? '<p class="completion-amendment">This evidence was amended after task verification. The amendment has not been reviewed; task verification is unchanged.</p>'
        : '') +
      '' +
      (value
        ? '<div class="completion-evidence-body"><p>' +
          h(value.note || 'No additional note.') +
          '</p>' +
          links(value) +
          '<p class="muted">Recorded ' +
          h(new Date(value.at).toLocaleString()) +
          '</p></div>'
        : review?'<p class="muted">No current completion report. Earlier evidence is retained below.</p>':'<p class="muted">No evidence added for the current completion.</p>') +
      (canEdit && (task.status === 'done' || task.reportedAt)
        ? '<details class="completion-edit"><summary>Add or edit completion evidence</summary><form id="completionEvidenceForm" data-id="' +
          h(task.id) +
          '"><label class="field">Completion note <span class="muted">optional</span><textarea name="completionNote" rows="3" maxlength="3000">' +
          h(value?.note || task.completionResult?.text || '') +
          '</textarea></label>' +
          fields(value || {}) +
          '<button class="btn btn-secondary" type="submit">Save completion evidence</button></form></details>'
        : '') +
      ((task.completionEvidenceHistory || []).length
        ? '<details class="completion-history"><summary>Earlier evidence · ' +
          task.completionEvidenceHistory.length +
          '</summary><p class="muted">Earlier records may describe a previous completion. Shared files may have been archived.</p>' +
          task.completionEvidenceHistory
            .map(
              (item) =>
                '<article><p>' +
                h(item.note || 'No note.') +
                '</p>' +
                links(item) +
                '<small>' +
                h(new Date(item.at).toLocaleString()) +
                '</small></article>',
            )
            .join('') +
          '</details>'
        : '') +
      '</section>'
    );
  }
  function mount(host) {
    for (const button of host.querySelectorAll('[data-load-completion-files]'))
      button.onclick = async () => {
        const form = button.closest('form'),
          select = form.elements.completionFileIds,
          status = form.querySelector('[data-completion-file-status]');
        button.disabled = true;
        status.textContent = 'Loading shared files…';
        try {
          const response = await fetch(endpoint(), {
              credentials: 'same-origin',
              cache: 'no-store',
              signal: AbortSignal.timeout(15000),
            }),
            data = await response.json();
          if (!response.ok)
            throw new Error('Shared files could not be loaded.');
          if (!select.isConnected) return;
          const selected = new Set(
              [...select.selectedOptions].map((option) => option.value),
            ),
            defaults = new Set(
              [...select.options]
                .filter((option) => option.defaultSelected)
                .map((option) => option.value),
            );
          const files = data.files.filter((file) => !file.archivedAt);
          const missing = [...new Set([...selected, ...defaults])].filter(
            (id) => !files.some((file) => file.id === id),
          );
          select.innerHTML =
            files
              .map(
                (file) =>
                  '<option value="' +
                  h(file.id) +
                  '" ' +
                  (defaults.has(file.id) ? 'selected' : '') +
                  '>' +
                  h(file.name) +
                  '</option>',
              )
              .join('') +
            missing
              .map(
                (id) =>
                  '<option value="' +
                  h(id) +
                  '" ' +
                  (defaults.has(id) ? 'selected' : '') +
                  '>Unavailable file · remove before saving</option>',
              )
              .join('');
          for (const option of select.options)
            option.selected = selected.has(option.value);
          status.textContent = files.length
            ? 'Select up to 5 shared files. Hold Command or Ctrl to select more than one.'
            : 'No active shared files. Upload one in Event info first.';
        } catch (error) {
          if (status.isConnected)
            status.textContent =
              error.message || 'Files could not be loaded. Try again.';
        } finally {
          if (button.isConnected) button.disabled = false;
        }
      };
    for (const button of host.querySelectorAll('[data-check-completion-files]'))
      button.onclick = async () => {
        button.disabled = true;
        try {
          const response = await fetch(endpoint(), {
              credentials: 'same-origin',
              cache: 'no-store',
              signal: AbortSignal.timeout(15000),
            }),
            data = await response.json();
          if (!response.ok) throw new Error();
          if (!button.isConnected) return;
          for (const row of host.querySelectorAll('[data-completion-file]')) {
            const id = row.dataset.completionFile,
              file = data.files.find(
                (file) => file.id === id && !file.archivedAt,
              );
            row.innerHTML = file
              ? '<a href="' +
                h(endpoint(id)) +
                '" target="_blank" rel="noopener noreferrer">' +
                h(file.name) +
                '</a>'
              : 'Shared file unavailable or archived';
          }
          button.textContent = 'Recheck shared files';
        } catch {
          button.textContent = 'Could not check files · try again';
        } finally {
          if (button.isConnected) button.disabled = false;
        }
      };
  }
  let feedbackTimer;
  function celebrate(task, state) {
    document.getElementById('completionFeedback')?.remove();
    clearTimeout(feedbackTimer);
    const pending = task.status !== 'done',
      done = state.tasks.filter((t) => t.status === 'done').length,
      total = state.tasks.length;
    const el = document.createElement('aside');
    el.id = 'completionFeedback';
    el.className = 'completion-feedback' + (pending ? ' is-pending' : '');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<span class="completion-feedback-mark" aria-hidden="true">' +
      (pending ? '↗' : '✓') +
      '</span><div><strong>' +
      (pending ? 'Report recorded.' : 'One step closer!') +
      '</strong><p>' +
      h(task.title) +
      '</p><small>' +
      (pending
        ? 'Awaiting organizer verification · not marked complete.'
        : done + ' of ' + total + ' tasks complete · nice work.') +
      '</small><progress aria-label="' +
      done +
      ' of ' +
      total +
      ' tasks complete" value="' +
      done +
      '" max="' +
      Math.max(1, total) +
      '"></progress></div>';
    document.body.append(el);
    feedbackTimer = setTimeout(() => el.remove(), 6000);
  }
  root.GatherCompletionUI = { fields, collect, section, mount, celebrate };
})(typeof window !== 'undefined' ? window : globalThis);
