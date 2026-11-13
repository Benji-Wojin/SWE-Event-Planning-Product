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
  function captureDraft(form) {
    return {
      ...collect(form, form.elements.note?.value),
      rawLinks:form.elements.completionLinks?.value||'',
      file:form.elements.completionUpload?.files?.[0],
      attachmentRecovery:form.dataset.completionAttachmentRecovery,
    };
  }
  function carryUploadAttempt(original,replacement) {
    const attempt=original&&uploadAttempts.get(original);
    if(attempt&&replacement&&attempt.url===endpoint())uploadAttempts.set(replacement,attempt);
  }
  function restoreSelectedFile(input,file) {
    const attempt=file&&uploadAttempts.get(file),reusable=attempt?.url===endpoint()?attempt:null;
    if(!file)return '';
    try{
      const transfer=new DataTransfer();
      transfer.items.add(file);input.files=transfer.files;
      if(!input.files?.[0])throw new Error();
      carryUploadAttempt(file,input.files[0]);
      return reusable&&!reusable.fileId?'pending':'selected';
    }catch{return reusable?.fileId?{fileId:reusable.fileId}:reusable?'check-file':'select-file';}
  }
  function restoreFileSelection(form,ids) {
    // Rebuild the visible Remove controls together with the actual selection.
    const choices=form.elements.completionFileIds,defaults=[...choices.options].filter(option=>option.defaultSelected).map(option=>option.value);
    choices.innerHTML=[...new Set([...defaults,...ids])].map(id=>'<option value="'+h(id)+'"'+
      (defaults.includes(id)?' selected':'')+'>Saved project file · '+h(id.slice(0,8))+'</option>').join('');
    for(const option of choices.options)option.selected=ids.includes(option.value);
    form.querySelector('[data-submission-files]').innerHTML=ids.map(id=>'<p class="submission-file"><span>Attached file</span><button type="button" class="text-button" data-remove-submission-file="'+h(id)+'">Remove file</button></p>').join('');
  }
  function restoreDraft(form,draft) {
    const {file}=draft,attempt=file&&uploadAttempts.get(file),reusable=attempt?.url===endpoint()?attempt:null;
    const ids=[...new Set([...draft.fileIds,...(reusable?.fileId?[reusable.fileId]:[])])];
    const note=form.elements.note||form.elements.completionNote;
    note.value=draft.note;
    form.elements.completionLinks.value=draft.rawLinks;
    restoreFileSelection(form,ids);
    if(reusable?.fileId)return 'saved';
    if(!file)return draft.attachmentRecovery||'';
    return restoreSelectedFile(form.elements.completionUpload,file);
  }
  async function prepare(form, details, file, {stillCurrent=()=>true}={}) {
    function checkReview() {
      if(!stillCurrent())throw new Error('This task review changed. The completion was not submitted.');
    }
    checkReview();
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
      checkReview();
      if (!response.ok || !info.uploadsAvailable) throw new Error('File uploads are unavailable. Your completion has not been submitted.');
      attempt = {url,revision:info.revision,requestId:crypto.randomUUID(),fileId:null};
      uploadAttempts.set(file, attempt);
    }
    if (!attempt.fileId) {
      checkReview();
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
    checkReview();
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
  function section(task, canEdit, organizer=false, {canPrepareRevision=false,completionBlocked=false,workspaceRevision,completionSource,
    completionHistorySources=[],memberName}={}) {
    const review=task.status!=='done'&&!task.reportedAt?task.completionReview:null;
    const earlierSources=new Map(completionHistorySources.filter(message=>message?.appliedTaskId===task.id).map(message=>[message.id,message]));
    const earlierEmails=(task.completionReportEmailHistory||[]).filter(id=>id!==task.completionReportSourceId)
      .map(id=>earlierSources.get(id)).filter(Boolean);
    if (
      task.status !== 'done' &&
      !task.reportedAt &&
      !(task.completionEvidenceHistory || []).length &&
      !earlierEmails.length &&
      !review
    )
      return '';
    const value = task.completionEvidence;
    const recordedBy=item=>{
      const name=memberName?.(item.actor);
      return name?'Recorded by '+h(name):'Recorder not available';
    };
    const openEmail=message=>'<button type="button" class="text-button" data-action="source" data-id="'+h(message.id)+'"'+
      (message.subject?' aria-label="Open in Email briefing: '+h(message.subject)+'"':'')+'>Open in Email briefing</button>';
    const source=completionSource&&completionSource.id===task.completionReportSourceId
      ? '<p class="muted">Completion reported by '+h(completionSource.sender||'the sender')+' in Email briefing. '+openEmail(completionSource)+'</p>'
      : '';
    return (
      '<section class="completion-evidence section-gap"><h3 tabindex="-1">Completion details</h3><p class="muted">Shared context, not independent verification.</p>' +
      source +
      (review?'<section class="notice" aria-label="Completion changes requested"><h4 tabindex="-1">Changes requested</h4><p>'+h(review.note)+'</p><p class="muted">Organizer review · '+h(new Date(review.at).toLocaleString())+'. The owner can update the work and submit again. Nothing was verified; earlier submissions remain below.</p>'+
        (canPrepareRevision?(completionBlocked?'<p>Finish required work before preparing a revised report.</p>':'<button type="button" class="btn btn-secondary" data-action="prepare-revised-completion" data-id="'+h(task.id)+'">Prepare revised report</button>'):'')+'</section>':'')+
      (value && task.verifiedAt && task.completionEvidenceReviewAt!==task.verifiedAt
        ? '<p class="completion-amendment">This submission was amended after task verification. The amendment has not been reviewed; task verification is unchanged.</p>'
        : '') +
      '' +
      (value
        ? '<div class="completion-evidence-body"><p>' +
          h(value.note || 'No additional note.') +
          '</p>' +
          links(value) +
          '<p class="muted">Submission dated ' +
          h(new Date(value.at).toLocaleString()) +
          ' · '+recordedBy(value)+
          '</p></div>'
        : review?'<p class="muted">No current completion report. Earlier submissions are retained below.</p>':'<p class="muted">No file or link attached.</p>') +
      (organizer && task.status==='done' && value && task.verifiedAt && task.completionEvidenceReviewAt!==task.verifiedAt
        ? '<div class="completion-amendment-review"><p class="muted">Record review of this submission only. This does not reverify the task or check whether linked files are available.</p><button type="button" class="btn btn-secondary" data-action="review-completion-evidence" data-id="'+h(task.id)+'" data-revision="'+h(task.revision)+'"'+
          (Number.isSafeInteger(workspaceRevision)?' data-workspace-revision="'+workspaceRevision+'"':'')+'>I reviewed this amendment</button></div>'
        : '') +
      (canEdit && (task.status === 'done' || task.reportedAt)
        ? '<details class="completion-edit"><summary>Edit submission</summary><form id="completionEvidenceForm" data-id="' +
          h(task.id) +
          '" data-revision="'+h(task.revision)+'"'+
          (Number.isSafeInteger(workspaceRevision)?' data-workspace-revision="'+workspaceRevision+'"':'')+
          '><label class="field">Completion note <span class="muted">optional</span><textarea name="completionNote" rows="3" maxlength="3000">' +
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
              (item) => item ?
                '<article><p>' +
                h(item.note || 'No note.') +
                '</p>' +
                links(item) +
                '<small>Submission dated ' +
                h(new Date(item.at).toLocaleString()) +
                ' · '+recordedBy(item)+
                '</small></article>' : '',
            )
            .join('') +
          '</details>'
        : '') +
      (earlierEmails.length?'<details class="completion-history completion-email-history"><summary>Earlier completion emails · '+earlierEmails.length+
        '</summary><p class="muted">These reviewed emails are no longer the current report. They are listed separately from the files and links in Earlier submissions.</p><ul>'+
        earlierEmails.map(message=>'<li>'+h(message.sender||'Unknown sender')+
          (message.subject?' · '+h(message.subject):'')+' '+openEmail(message)+'</li>').join('')+'</ul></details>':'')+
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
  root.GatherCompletionUI = { fields, collect, prepare, section, mount, celebrate, captureDraft, restoreDraft, restoreSelectedFile, restoreFileSelection };
})(typeof window !== 'undefined' ? window : globalThis);
