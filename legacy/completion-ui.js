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
      '<section class="completion-fields submission-attachments" aria-label="Attachments optional"><h4>Add a file or link <span class="muted">optional</span></h4><p class="muted">Shared with your project team. Leave this blank if your note is enough.</p><label class="field">File<input name="completionUpload" type="file" accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.docx,.xlsx"></label><p class="muted">Up to 4 MB · PDF, text, CSV, image, Word or Excel. Uploaded only when you submit; files are not malware-scanned.</p><span class="submission-or">or</span><label class="field">Link<textarea name="completionLinks" rows="2" maxlength="10300" placeholder="https://">' +
      h((value.links || []).join('\n')) +
      '</textarea></label><p class="muted">Use a public HTTPS link. Keep passwords and private booking details out.</p><select name="completionFileIds" multiple hidden aria-label="Attached project files">' +
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
      '</select><div data-submission-files>'+(value.fileIds||[]).map(id=>'<p class="submission-file"><span>Attached file</span><button type="button" class="text-button" data-remove-submission-file="'+h(id)+'">Remove file</button></p>').join('')+'</div><p class="muted" role="status" data-submission-status></p></section>'
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
  const uploadAttempts = new WeakMap();
  async function prepare(form, details, file) {
    if (!file || !file.size && !file.name) return details;
    if (!file.size || file.size > 4 * 1024 * 1024 || !/\.(pdf|txt|csv|png|jpe?g|docx|xlsx)$/i.test(file.name))
      throw new Error('Choose a non-empty PDF, TXT, CSV, image, Word or Excel file up to 4 MB.');
    if (!root.GatherMode) throw new Error('File uploads are unavailable in this offline demo. You can submit a note or link.');
    const url = endpoint(), status = form.querySelector('[data-submission-status]');
    let attempt = uploadAttempts.get(file);
    if (details.fileIds.length >= 5 && !details.fileIds.includes(attempt?.fileId)) throw new Error('Remove a file before attaching another. Up to 5 files per submission.');
    if (attempt && attempt.url !== url) throw new Error('The project changed. Choose the file again.');
    if (!attempt) {
      let response,info;
      try {response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});info=await response.json();}
      catch {throw new Error('File uploads could not be reached. Your completion has not been submitted. Try again.');}
      if (!response.ok || !info.uploadsAvailable) throw new Error('File uploads are unavailable. Your completion has not been submitted.');
      attempt = {url,revision:info.revision,requestId:crypto.randomUUID(),fileId:null};
      uploadAttempts.set(file, attempt);
    }
    if (!attempt.fileId) {
      if(status)status.textContent='Uploading your file…';
      const body=new FormData();body.set('file',file);body.set('revision',attempt.revision);body.set('requestId',attempt.requestId);
      let response,info;
      try {
        response=await fetch(url+'&upload=1',{method:'POST',credentials:'same-origin',headers:{'X-Gather-Request':'1'},body,signal:AbortSignal.timeout(20000)});
        info=await response.json();
      } catch {
        throw new Error('The upload could not be confirmed. Your completion was not submitted. Retry with this same file to check the saved upload.');
      }
      if(!response.ok){
        // Explicit rejection is safe to retry from a fresh revision; ambiguous transport failures retain the receipt.
        if(response.status===400||response.status===409)uploadAttempts.delete(file);
        throw new Error(info.error||'The file could not be uploaded. Your completion was not submitted.');
      }
      if(!info.uploadedFileId||!info.files?.some(row=>row.id===info.uploadedFileId&&!row.archivedAt))
        throw new Error('The uploaded file could not be identified. Your completion was not submitted. Check Event info before trying again.');
      attempt.fileId=info.uploadedFileId;
    }
    form.dataset.completionUploaded='true';
    if(status)status.textContent='File uploaded. Saving your completion…';
    return {...details,fileIds:[...new Set([...details.fileIds,attempt.fileId])]};
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
  function section(task, canEdit, organizer=false) {
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
      (review?'<section class="notice" aria-label="Completion changes requested"><h4>Changes requested</h4><p>'+h(review.note)+'</p><p class="muted">Organizer review · '+h(new Date(review.at).toLocaleString())+'. The owner can update the work and submit again. Nothing was verified; earlier submissions remain below.</p></section>':'')+
      (value && task.verifiedAt && task.completionEvidenceReviewAt!==task.verifiedAt
        ? '<p class="completion-amendment">This submission was amended after task verification. The amendment has not been reviewed; task verification is unchanged.</p>'
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
        : review?'<p class="muted">No current completion report. Earlier submissions are retained below.</p>':'<p class="muted">No file or link attached.</p>') +
      (organizer && task.status==='done' && value && task.verifiedAt && task.completionEvidenceReviewAt!==task.verifiedAt
        ? '<div class="completion-amendment-review"><p class="muted">Record review of this submission only. This does not reverify the task or check whether linked files are available.</p><button type="button" class="btn btn-secondary" data-action="review-completion-evidence" data-id="'+h(task.id)+'" data-revision="'+h(task.revision)+'">I reviewed this amendment</button></div>'
        : '') +
      (canEdit && (task.status === 'done' || task.reportedAt)
        ? '<details class="completion-edit"><summary>Edit submission</summary><form id="completionEvidenceForm" data-id="' +
          h(task.id) +
          '"><label class="field">Completion note <span class="muted">optional</span><textarea name="completionNote" rows="3" maxlength="3000">' +
          h(value?.note || task.completionResult?.text || '') +
          '</textarea></label>' +
          fields(value || {}) +
          '<button class="btn btn-secondary" type="submit">Save submission</button></form></details>'
        : '') +
      ((task.completionEvidenceHistory || []).length
        ? '<details class="completion-history"><summary>Earlier submissions · ' +
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
    for(const button of host.querySelectorAll('[data-remove-submission-file]')){
      // Sibling-form saves restore dirty selections after markup is rebuilt from the saved task.
      const selected=[...button.closest('form').elements.completionFileIds.options].some(row=>row.value===button.dataset.removeSubmissionFile&&row.selected);
      if(!selected){button.closest('.submission-file')?.remove();continue;}
      button.onclick=()=>{
      const form=button.closest('form'),option=[...form.elements.completionFileIds.options].find(row=>row.value===button.dataset.removeSubmissionFile);
      if(option)option.selected=false;button.closest('.submission-file')?.remove();
      };
    }
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
  root.GatherCompletionUI = { fields, collect, prepare, section, mount, celebrate };
})(typeof window !== 'undefined' ? window : globalThis);
