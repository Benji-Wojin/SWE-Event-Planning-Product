(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GatherStore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const KEY = "gather-workspace-v3";
  const STATUSES = ["todo", "progress", "blocked", "done"];
  const MEMBERS = [
    { id: "jack", name: "Jack Morgan", initials: "JM", role: "Lead organizer", color: "peach" },
    { id: "maya", name: "Maya Singh", initials: "MS", role: "Guests & catering", color: "lavender" },
    { id: "jules", name: "Jules Miller", initials: "JL", role: "Transport & logistics", color: "mint" },
    { id: "dev", name: "Dev Kim", initials: "DK", role: "Program & volunteers", color: "sand" },
  ];
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const clean = (value, max = 2000) => String(value == null ? "" : value).trim().slice(0, max);
  const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const validDate = (value) => value === "" || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value);

  function createStore(options = {}) {
    const clock = typeof options.now === "function" ? options.now : () => options.now == null ? Date.now() : options.now;
    const timestamp = () => {
      const result = new Date(clock());
      if (Number.isNaN(result.getTime())) throw new Error("The workspace clock is invalid.");
      return result.toISOString();
    };
    const day = (offset = 0) => {
      const date = new Date(timestamp());
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const ago = (days = 0, hours = 0) => new Date(new Date(timestamp()).getTime() - (days * 24 + hours) * 3600000).toISOString();
    let counter = 0;
    const id = (prefix) => `${prefix}-${new Date(timestamp()).getTime().toString(36)}-${(++counter).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    let storage;
    try { storage = Object.prototype.hasOwnProperty.call(options, "storage") ? options.storage : rootStorage(); } catch { storage = null; }
    let persistence = storage ? "saved" : "unavailable";
    const subscribers = new Set();
    let lastSavedRaw = null;

    function seed() {
      const specs = [
        ["bus", "Confirm final bus count", "Transport", "jules", "blocked", 0, "Northstar needs our final passenger count before confirming the booking.", 3],
        ["dietary", "Collect dietary needs", "Food & drink", "maya", "progress", 1, "Fourteen guests still need to respond. Maya is following up.", 2],
        ["run-of-show", "Share activity schedule", "Program", "dev", "todo", 3, "Send the final run-of-show to activity leads and volunteers.", 3],
        ["venue", "Reserve Redwood Grove", "Venue", "jack", "done", -5, "Permit and deposit confirmed with the parks team.", 5],
        ["volunteers", "Confirm activity volunteers", "Program", "dev", "todo", 5, "Match six activity stations with named volunteers.", 1],
        ["catering", "Approve the catering menu", "Food & drink", "maya", "blocked", 1, "Waiting for the final dietary count before confirming the menu.", 4],
        ["wayfinding", "Confirm wayfinding signs", "Venue", "", "todo", 4, "Make parking, check-in, and restrooms easy to find.", 3],
        ["first-aid", "Book first-aid volunteer", "Guest care", "jack", "done", -3, "Coverage confirmed for the full event, 10 AM–4 PM.", 3],
        ["rsvp", "Build guest RSVP form", "Guest care", "maya", "done", -6, "RSVP form is ready and invitations have been shared.", 6],
        ["equipment", "Reserve game equipment", "Program", "dev", "done", -2, "Pickup arranged for October 2.", 2],
        ["photographer", "Brief the photographer", "Program", "jack", "progress", 7, "Share the shot list and guest photo-consent notes.", 4],
        ["briefing", "Schedule volunteer briefing", "Program", "dev", "todo", 9, "Set up a thirty-minute run-through with activity leads.", 1],
      ];
      const tasks = specs.map(([taskId, title, category, owner, status, due, note, age]) => ({
        id: taskId, title, category, owner, status, dueDate: day(due), note,
        updatedAt: ago(age), updatedBy: owner || "jack", completedAt: status === "done" ? ago(age) : "",
        completedBy: status === "done" ? owner : "", completionReportedBy: "", completionReportSourceId: "", sourceMessageId: "", memoryId: "", suggestionId: "", comments: [],
      }));
      tasks.find((task) => task.id === "bus").comments.push({ id: "comment-bus-1", actor: "jules", text: "I am waiting for Northstar to confirm availability. I will keep the update here.", at: ago(3) });
      const messages = [
        { id: "email-bus", sender: "Jules Miller", subject: "Northstar update: bus decision needed", body: "Hi Jack, Northstar can hold two buses until tomorrow at noon, but they need a decision on the extra $350. I cannot confirm the booking until the budget is approved. Please keep the transport task blocked for now and move the decision deadline to tomorrow. — Jules", receivedAt: ago(0, 2), suggested: { mode: "update", taskId: "bus", title: "Confirm final bus count", owner: "jules", dueDate: day(1), status: "blocked", note: "Northstar is holding two buses until tomorrow at noon. Jack needs to approve an additional $350 before Jules can confirm." } },
        { id: "email-dietary", sender: "Maya Singh", subject: "Dietary follow-up complete", body: "Hi Jack, all fourteen remaining guests have replied. I have recorded every dietary requirement and shared the list with Green Table. The dietary follow-up is complete. We can move on to approving the menu. — Maya", receivedAt: ago(0, 1), suggested: { mode: "update", taskId: "dietary", title: "Collect dietary needs", owner: "maya", dueDate: day(1), status: "done", note: "Maya reports that all fourteen remaining guests responded and the dietary list was shared with Green Table." } },
        { id: "email-quiet", sender: "Redwood Grove events team", subject: "Quiet space signs for Field Day", body: "Hello Jack, we can reserve the shaded area by the east entrance as your quiet rest area. Could someone on your team prepare signs and mark it on the guest map? Please confirm the owner before we finalize the site layout.", receivedAt: ago(0, 3), suggested: { mode: "new", taskId: "", title: "Prepare quiet-area signs and guest map", owner: "", dueDate: day(4), status: "todo", note: "The venue can reserve the shaded area by the east entrance. Assign someone to make signs and update the guest map." } },
      ];
      messages.forEach(message=>Object.assign(message.suggested,{analysisVersion:4,signal:message.suggested.status==='done'?'completion-report':message.suggested.status==='blocked'?'blocker':'unclear'}));
      return {
        version: 3, event: { name: "Field Day 2026", date: "2026-10-03", location: "Redwood Grove" }, members: copy(MEMBERS), tasks, messages,
        activity: [
          { id: "activity-equipment", actor: "dev", text: "completed Reserve game equipment", taskId: "equipment", at: ago(2), type: "completed" },
          { id: "activity-first-aid", actor: "jack", text: "completed Book first-aid volunteer", taskId: "first-aid", at: ago(3), type: "completed" },
          { id: "activity-photographer", actor: "jack", text: "started Brief the photographer", taskId: "photographer", at: ago(4), type: "status" },
        ],
        memories: [{ id: "memory-quiet", change: "Create a calm space away from the activities and make it easy to find.", wentWell: "Guests appreciated having different activities to choose from.", category: "Guest care", rating: 4, at: "2025-10-06T12:00:00.000Z" }],
        drafts: [], dismissed: [],
      };
    }

    let state = seed();
    try {
      const saved = storage && storage.getItem(KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!validState(parsed)) throw new Error("Invalid saved workspace");
        state = parsed;
        state.tasks.forEach((task) => {
          task.completionReportedBy ??= "";
          task.completionReportSourceId ??= "";
          task.memoryId ??= "";
          task.suggestionId ??= "";
          const legacyMemory = state.memories.find((memory) => task.note.includes(`Event memory ${memory.id}:`));
          if (legacyMemory) {
            task.memoryId = legacyMemory.id;
            task.suggestionId ||= `lesson-${legacyMemory.id}`;
            task.note = task.note.replace(`Event memory ${legacyMemory.id}:`, "From event feedback:");
          }
        });
      } else if (storage) {
        const legacy = JSON.parse(storage.getItem("gather-event-memories") || "[]");
        if (Array.isArray(legacy)) legacy.filter((item) => item && typeof item.change === "string" && item.change.trim()).forEach((item) => state.memories.unshift({ id: id("memory"), change: clean(item.change), wentWell: clean(item.wentWell), category: "Guest care", rating: Number(item.rating) || 0, at: Number.isFinite(Number(item.savedAt)) ? new Date(Number(item.savedAt)).toISOString() : timestamp() }));
      }
    } catch { persistence = "unavailable"; }

    function validState(value) {
      const strings = (item, keys) => item && keys.every((key) => typeof item[key] === "string");
      const validTime = (at) => typeof at === "string" && !Number.isNaN(Date.parse(at));
      const validOwner = (owner) => owner === "" || value.members?.some((member) => member.id === owner);
      const list = (items, predicate) => Array.isArray(items) && items.every(predicate);
      const uniqueIds = (items) => new Set(items.map((item) => item.id)).size === items.length;
      return value && value.version === 3 && strings(value.event, ["name", "date", "location"]) && validDate(value.event.date) &&
        list(value.members, (member) => strings(member, ["id", "name", "initials", "role", "color"])) && uniqueIds(value.members) && MEMBERS.every((member) => value.members.some((item) => item.id === member.id)) &&
        list(value.tasks, (task) => strings(task, ["id", "title", "category", "note", "owner", "updatedBy", "completedBy", "completedAt", "sourceMessageId"]) && ["completionReportedBy", "completionReportSourceId", "memoryId", "suggestionId"].every((field) => task[field] === undefined || typeof task[field] === "string") && STATUSES.includes(task.status) && validDate(task.dueDate) && validOwner(task.owner) && validOwner(task.updatedBy) && validTime(task.updatedAt) && (task.completedAt === "" || validTime(task.completedAt)) && list(task.comments, (comment) => strings(comment, ["id", "actor", "text"]) && validOwner(comment.actor) && validTime(comment.at))) && uniqueIds(value.tasks) &&
        list(value.messages, (message) => strings(message, ["id", "sender", "subject", "body"]) && validTime(message.receivedAt) && strings(message.suggested, ["mode", "taskId", "title", "owner", "dueDate", "status", "note"]) && ["new", "update"].includes(message.suggested.mode) && STATUSES.includes(message.suggested.status) && validOwner(message.suggested.owner) && validDate(message.suggested.dueDate)) && uniqueIds(value.messages) &&
        list(value.activity, (item) => strings(item, ["id", "actor", "text", "taskId", "type"]) && validTime(item.at)) &&
        list(value.memories, (memory) => strings(memory, ["id", "change", "wentWell", "category"]) && validTime(memory.at)) &&
        list(value.drafts, (draft) => strings(draft, ["id", "taskId", "text"]) && validTime(draft.at)) && list(value.dismissed, (dismissed) => typeof dismissed === "string");
    }
    function save(notify = true) {
      if (notify) deliverDependencyResults();
      try {
        if (!storage) throw new Error("Storage is unavailable");
        const serialized = JSON.stringify(state);
        storage.setItem(KEY, serialized);
        lastSavedRaw = serialized;
        persistence = "saved";
      } catch { persistence = "unavailable"; }
      if (notify) subscribers.forEach((subscriber) => { try { subscriber(getState()); } catch (error) { if (typeof console !== "undefined") console.error("Gather view could not refresh", error); } });
    }
    // Additive migration: preserve the existing browser workspace and source history.
    state.event = { outdoor: true, transportNeeded: true, guestCount: 120, dietaryOutstanding: 14, cateringDeadline: day(2), ...state.event };
    const migrateDependencies = state.tasks.filter(task => !Array.isArray(task.dependencies));
    state.tasks.forEach((task) => {
      task.revision = Number.isInteger(task.revision) && task.revision > 0 ? task.revision : 1;
      for (const field of ['acceptedAt','acceptedBy','reportedAt','reportedBy','verifiedAt','verifiedBy','followupAfter']) task[field] = typeof task[field] === 'string' ? task[field] : '';
      task.requiresVerification = Boolean(task.requiresVerification);
      task.dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
      task.blockerFingerprint = typeof task.blockerFingerprint === 'string' ? task.blockerFingerprint : '';
    });
    // Older plans get unambiguous links only. Loading never creates follow-up work.
    for (const task of migrateDependencies.filter(task => task.status === 'blocked')) {
      const specs = blockerSpecs(task);
      for (const spec of specs) {
        const matches = spec.match ? state.tasks.filter(other => other.id !== task.id && spec.match.test(other.title) && !dependsOn(other.id, task.id)) : [];
        if (matches.length === 1) task.dependencies.push({ taskId: matches[0].id, reason: task.note, automatic: true, key: spec.key, createdAt: task.updatedAt, delivered: '' });
      }
      if (task.dependencies.length === specs.length) task.blockerFingerprint = normalize(task.note);
    }
    state.messages.forEach((message) => {
      message.threadId ||= `thread-${message.suggested.taskId || message.id}`;
      message.sourceType ||= 'sample';
      message.suggested.baseRevision ??= state.tasks.find(task => task.id === message.suggested.taskId)?.revision || 0;
    });
    state.memories.forEach((memory) => Object.assign(memory, { scope: 'always', context: '', outcome: 'untested', outcomeNote: '', active: true, ...memory }));
    // Invalid saved data is left untouched until the first user action.
    if (persistence === "saved") save(false);
    function getState() { return { ...copy(state), persistence }; }
    function actorId(actor) {
      assertFresh();
      if (!state.members.some((member) => member.id === actor)) throw new Error("Choose a member of this planning team.");
      return actor;
    }
    function assertFresh() {
      if (storage && lastSavedRaw !== null && storage.getItem(KEY) !== lastSavedRaw) throw new Error('This workspace changed in another tab. Reload before making more changes.');
    }
    function taskById(taskId) {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error("That task could not be found.");
      return task;
    }
    function entry(actor, text, taskId, type) {
      state.activity.unshift({ id: id("activity"), actor, text, taskId: taskId || "", at: timestamp(), type });
    }
    function taskFields(data, previous = {}) {
      const result = { ...previous };
      ["title", "category", "note"].forEach((field) => { if (data[field] !== undefined) result[field] = clean(data[field], field === "title" ? 200 : field === "category" ? 80 : 5000); });
      if (!result.title) throw new Error("Give this task a name.");
      result.category ||= "Guest care";
      result.note ||= "";
      if (data.owner !== undefined) result.owner = clean(data.owner, 80);
      result.owner ??= "";
      if (result.owner && !state.members.some((member) => member.id === result.owner)) throw new Error("Choose a valid task owner.");
      if (data.status !== undefined) result.status = data.status;
      if (result.status === undefined) result.status = "todo";
      if (!STATUSES.includes(result.status)) throw new Error("Choose a valid task status.");
      if (data.dueDate !== undefined) result.dueDate = clean(data.dueDate, 20);
      result.dueDate ??= "";
      if (!validDate(result.dueDate)) throw new Error("Choose a valid due date.");
      if (data.requiresVerification !== undefined) result.requiresVerification = data.requiresVerification === true || data.requiresVerification === 'true' || data.requiresVerification === 'on';
      result.requiresVerification ??= false;
      return result;
    }
    function createTask(data, actor) {
      const fields = taskFields(data);
      const at = timestamp();
      const task = { id: id("task"), ...fields, revision: 1, acceptedAt: '', acceptedBy: '', reportedAt: '', reportedBy: '', verifiedAt: '', verifiedBy: '', followupAfter: '', updatedAt: at, updatedBy: actor, completedAt: fields.status === "done" ? at : "", completedBy: fields.status === "done" ? actor : "", completionReportedBy: "", completionReportSourceId: "", sourceMessageId: "", memoryId: "", suggestionId: "", comments: [], dependencies: [], blockerFingerprint: '' };
      state.tasks.unshift(task);
      if (task.status === 'done') captureCompletion(task, actor);
      return task;
    }
    function patchTask(task, patch, actor) {
      const next = taskFields(patch, task);
      const changed = ["title", "category", "note", "owner", "status", "dueDate", "requiresVerification"].filter((field) => next[field] !== task[field]);
      if (!changed.length) return [];
      const previousStatus = task.status;
      changed.forEach((field) => { task[field] = next[field]; });
      task.revision += 1;
      if (changed.includes('owner')) { task.acceptedAt = ''; task.acceptedBy = ''; task.acceptedSourceId = ''; task.acceptedRecordedBy = ''; task.followupAfter = ''; if (task.status !== 'done') { task.reportedAt = ''; task.reportedBy = ''; } }
      if (changed.includes('status') && task.status !== 'done') { task.verifiedAt = ''; task.verifiedBy = ''; task.reportedAt = ''; task.reportedBy = ''; }
      // A pending report describes its exact note, not a later replacement.
      if (changed.includes('note') && previousStatus !== 'done' && task.reportedAt && !task.verifiedAt) { task.reportedAt = ''; task.reportedBy = ''; }
      task.updatedAt = timestamp();
      task.updatedBy = actor;
      if (task.status === "done" && previousStatus !== "done") { task.completedAt = task.updatedAt; task.completedBy = actor; task.completionReportedBy = ""; task.completionReportSourceId = ""; }
      else if (task.status !== "done") { task.completedAt = ""; task.completedBy = ""; task.completionReportedBy = ""; task.completionReportSourceId = ""; }
      if (task.status === 'done' && previousStatus !== 'done') captureCompletion(task, actor);
      else if (task.status !== 'done') task.completionResult = null;
      return changed;
    }
    function addTask(data, actor = "jack") {
      actorId(actor);
      const task = createTask(data, actor);
      entry(actor, `created ${task.title}`, task.id, "created");
      syncBlocker(task, actor);
      save();
      return copy(task);
    }
    function updateTask(taskId, patch, actor = "jack") {
      actorId(actor);
      const task = taskById(taskId);
      if (actor !== 'jack') {
        if (task.owner !== actor) throw new Error('Only the assigned owner can report progress on this task.');
        if (Object.keys(patch).some(field => !['status', 'note'].includes(field))) throw new Error('Only the organizer can edit task details.');
        if (task.status === 'done') throw new Error('This task is complete. Add a comment or ask the organizer to reopen it.');
        if (patch.status === 'done') throw new Error('Use Report complete to record your completion.');
        if (!['progress', 'blocked'].includes(patch.status) || !clean(patch.note)) throw new Error('Report progress or a blocker with a short note.');
      }
      if (task.requiresVerification && !task.verifiedAt && task.status !== 'done' && patch.status === 'done') throw new Error('This task requires a completion report and organizer verification. Open the task and use Verify completion.');
      if (task.status === 'done' && !task.verifiedAt && !task.requiresVerification && taskFields(patch,task).requiresVerification) throw new Error('Reopen this task before requiring organizer verification.');
      if (patch.requiresVerification !== undefined && taskFields(patch,task).requiresVerification !== task.requiresVerification && actor !== 'jack') throw new Error('Only the organizer can change verification requirements.');
      const previousStatus = task.status;
      const supersedesReport = task.owner === actor && task.reportedAt && Object.keys(patch).every(field => ['status', 'note'].includes(field)) && ['progress', 'blocked'].includes(patch.status) && clean(patch.note);
      const changed = patchTask(task, patch, actor);
      if (supersedesReport) { task.reportedAt = ''; task.reportedBy = ''; task.revision++; task.updatedAt = timestamp(); task.updatedBy = actor; if (!changed.length) changed.push('note'); }
      // Status/assignment edits must not turn an old context note into a blocker.
      const blockerReport = patch.note !== undefined && (changed.includes('note') ||
        patch.status === 'blocked' && Object.keys(patch).every(field => ['status','note'].includes(field)));
      const linked = blockerReport ? syncBlocker(task, actor) : false;
      if (task.status !== 'blocked') task.blockerFingerprint = '';
      if (changed.length || linked) {
        let text = `updated ${task.title}`;
        let type = "updated";
        if (changed.includes("status")) {
          text = task.status === "done" ? `completed ${task.title}` : previousStatus === "done" ? `reopened ${task.title}` : `marked ${task.title} ${task.status === "progress" ? "in progress" : task.status === "blocked" ? "blocked" : "to do"}`;
          type = task.status === "done" ? "completed" : "status";
        } else if (changed.includes("owner")) {
          text = task.owner ? `assigned ${task.title} to ${state.members.find((person) => person.id === task.owner).name}` : `removed the owner from ${task.title}`;
          type = "assigned";
        }
        entry(actor, text, task.id, type);
        save();
      }
      return copy(task);
    }
    function addComment(taskId, text, actor = "jack") {
      actorId(actor);
      const task = taskById(taskId);
      const body = clean(text, 5000);
      if (!body) throw new Error("Write an update before posting.");
      const comment = { id: id("comment"), actor, text: body, at: timestamp() };
      task.comments.push(comment);
      task.updatedAt = comment.at;
      task.updatedBy = actor;
      entry(actor, `posted an update on ${task.title}`, task.id, "comment");
      save();
      return copy(comment);
    }
    function saveDraft(taskId, text, actor = "jack") {
      actorId(actor);
      const task = taskById(taskId);
      if (String(text ?? '').trim().length > 5000) throw new Error('Use 5,000 characters or fewer. Your draft has not been saved.');
      const body = clean(text, 5000);
      if (!body) throw new Error("Write a message before saving a draft.");
      let draft = state.drafts.find((item) => item.taskId === taskId);
      if (draft) { if(draft.text!==body)delete draft.manuallySentAt;Object.assign(draft, { text: body, at: timestamp() }); }
      else { draft = { id: id("draft"), taskId, text: body, at: timestamp() }; state.drafts.unshift(draft); }
      entry(actor, `saved follow-up draft for ${task.title}`, task.id, "draft");
      save();
      return copy(draft);
    }
    function proposeMessage(message, selectedTaskId) {
      // Only inspect the new text; quoted earlier messages must not reassert old claims.
      const fresh = message.body.split(/(?:^|\n)[ \t]*(?:On .+wrote:|From:|>)/i)[0];
      const body = fresh.toLowerCase().replace(/[’‘]/g,"'");
      const subject = message.subject.toLowerCase();
      const threadTasks = [...new Set(state.messages.filter(item => item.id !== message.id && item.threadId === message.threadId && (item.appliedTaskId||item.linkedTaskId)).map(item => item.appliedTaskId||item.linkedTaskId))];
      const topic = /bus|northstar|transport/.test(subject) ? "bus" : /diet|allergen/.test(subject) ? "dietary" : /cater|menu/.test(subject) ? "catering" : /volunteer|briefing/.test(subject) ? "briefing" : "";
      const existing = state.tasks.find(task => task.id === selectedTaskId) || (threadTasks.length === 1 ? state.tasks.find(task => task.id === threadTasks[0]) : null) || (threadTasks.length > 1 ? null : state.tasks.find(task => task.id === topic) || state.tasks.find(task => normalize(message.subject).includes(normalize(task.title))));
      const person = state.members.find((member) => normalize(message.sender).includes(normalize(member.name)) || normalize(message.sender).split(" ").includes(member.name.split(" ")[0].toLowerCase()));
      const blockerText=body.replace(/\b(?:no longer|not) (?:blocked|waiting|pending)\b/g,'');
      const isBlocked = /\b(blocked|waiting|pending|cannot|can't)\b|need.*approv|not (?:yet )?(?:complete|done|confirmed)|still need/.test(blockerText);
      const completionCaveat=/\b(?:not|never|isn't|aren't|wasn't|weren't|haven't|hasn't|can't|cannot|will|would|could|should|please|if|can|after|once|unless|until|might|may|except|but|however|still|remaining)\b|\?/;
      const unresolved=/\b(?:not|never|cannot|except|remaining|pending|waiting|blocked|still need|nobody|no one|none|cancelled|canceled|unconfirmed)\b|\b\w+n't\b/.test(blockerText);
      const partialClaim=sentence=>/\b(?:almost|nearly|partly|partially|mostly|halfway|tentatively)\b/.test(sentence)||[...sentence.matchAll(/\b(\d+(?:\.\d+)?)\s*%/g)].some(match=>Number(match[1])<100);
      const isDone = !unresolved && !partialClaim(body) && (body.match(/[^.!?\n]+[.!?]?/g)||[]).some(sentence => /\b(complete|completed|finished|done|confirmed)\b/.test(sentence) && !completionCaveat.test(sentence));
      const acceptanceCaveat=/\b(?:not|never|cannot|if|after|once|unless|until|might|may|would|could|except|but|however|maybe|possibly)\b|\b\w+n't\b|\?/;
      const accepted = !acceptanceCaveat.test(body)&&/\bi(?:'m| am) on it\b|\bi (?:accept|can take|will handle)\b/.test(body);
      const mentionedDates=[...new Set((body.match(/\b\d{4}-\d{2}-\d{2}\b|\btomorrow\b/g)||[]))];
      const deadlineSentence=(body.match(/[^.!?\n]+[.!?]?/g)||[]).find(sentence=>
        /\b(?:(?:due(?:\s+date)?|deadline)(?:\s+(?:is|on|by|for))?\s*:?\s*|(?:send|submit|finish|finished|complete|completed|deliver|confirm|respond|reply|ready|needed)\b[^.!?\n]{0,60}\bby\s+)(?:\d{4}-\d{2}-\d{2}|tomorrow)\b/.test(sentence)&&
        !/\b(?:no|not|never|old|previous|original|ignore|ignored|cancelled|canceled|obsolete|was|had|if|unless|might|may|could|would|tentative|possibly)\b|\b\w+n't\b|\?/.test(sentence));
      let proposedDate=existing?.dueDate||'';
      if(mentionedDates.length===1&&deadlineSentence){
        if(mentionedDates[0]==='tomorrow'){const tomorrow=new Date(message.receivedAt);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);proposedDate=tomorrow.toISOString().slice(0,10);}
        else if(validDate(mentionedDates[0]))proposedDate=mentionedDates[0];
      }
      return { analysisVersion:4, mode: existing ? "update" : "new", taskId: existing?.id || "", title: existing?.title || clean(message.subject.replace(/^(?:(?:re|fw|fwd):\s*)+/gi, ""), 200), owner: existing?.owner || person?.id || "", dueDate: proposedDate, status: isBlocked ? "blocked" : isDone ? "done" : accepted ? 'progress' : existing?.status || "todo", note: fresh || existing?.note || '', baseRevision: existing?.revision || 0, signal: isBlocked ? 'blocker' : isDone ? 'completion-report' : accepted ? 'acceptance' : 'unclear', reason: threadTasks.length > 1 ? 'This conversation has been linked to multiple tasks. Choose the correct one.' : existing ? `${threadTasks.length ? 'Matched the existing conversation' : 'Matched the subject'}. ${isBlocked ? 'A condition or blocker is still unresolved.' : isDone ? 'The sender reports completion; this is not independent verification.' : accepted ? 'The sender appears to accept the work.' : 'No clear status change. Check the proposal.'}` : 'No reliable existing-task match. Choose a task or create one.' };
    }
    function addMessage(data, actor = "jack") {
      actorId(actor);
      if (data.externalId) { const duplicate = state.messages.find(item => item.externalId === clean(data.externalId, 300)); if (duplicate) return copy(duplicate); }
      const messageId = id('email');
      const receivedAt=data.receivedAt && !Number.isNaN(Date.parse(data.receivedAt)) ? new Date(data.receivedAt).toISOString() : timestamp();
      const message = { id: messageId, sender: clean(data.sender, 200) || "Pasted email", subject: clean(data.subject, 200), body: clean(data.body, 15000), receivedAt, threadId: clean(data.threadId,200) || `thread-${messageId}`, sourceType: data.externalId?.startsWith('review:')?'gmail-reviewed':'pasted', externalId: clean(data.externalId,300) };
      if (!message.subject || !message.body) throw new Error("Add an email subject and message.");
      if(data.taskId){taskById(data.taskId);message.linkedTaskId=data.taskId;}
      message.suggested = proposeMessage(message,data.taskId);
      state.messages.unshift(message);
      entry(actor, `added email for review: ${message.subject}`, "", "email-imported");
      save();
      return copy(message);
    }
    function refreshProposal(messageId, taskId) {
      assertFresh();
      const message = state.messages.find(item => item.id === messageId);
      if (!message || message.appliedTaskId || message.ignoredAt) throw new Error('Only pending messages can be reviewed.');
      if(taskId){taskById(taskId);message.linkedTaskId=taskId;}
      message.suggested = proposeMessage(message, taskId || message.linkedTaskId || message.suggested.taskId);
      save(); return copy(message);
    }
    function ignoreMessage(messageId, actor = 'jack') {
      actorId(actor);
      const message = state.messages.find(item => item.id === messageId);
      if (!message || message.appliedTaskId) throw new Error('This message has already been applied or is unavailable.');
      message.ignoredAt = timestamp(); message.ignoredBy = actor; save(); return copy(message);
    }
    function applyMessage(messageId, approved = {}, actor = "jack") {
      actorId(actor);
      const message = state.messages.find((item) => item.id === messageId);
      if (!message) throw new Error("That email could not be found.");
      if (message.appliedTaskId) return copy(taskById(message.appliedTaskId));
      if (message.ignoredAt) throw new Error('This message was set aside. It cannot change the plan.');
      if (message.suggested.analysisVersion !== 4) throw new Error('Refresh this suggestion before accepting. Its email analysis is out of date.');
      const proposed = Object.fromEntries(['mode','taskId','title','owner','status','dueDate','note','category'].map(field => [field,approved[field] ?? message.suggested[field]]).filter(([,value])=>value!==undefined));
      const completionReport = proposed.status === 'done' && (message.suggested.signal === 'completion-report' || (!message.suggested.signal && message.suggested.status === 'done') || (approved.status === 'done' && message.suggested.status !== 'done'));
      if (!["new", "update"].includes(proposed.mode)) throw new Error("Choose whether to create or update a task.");
      let task, before;
      if (proposed.mode === "update") {
        task = taskById(proposed.taskId);
        const expected = Number(approved.expectedRevision ?? (proposed.taskId === message.suggested.taskId ? message.suggested.baseRevision : task.revision));
        if (expected !== task.revision) throw new Error('The task changed after this proposal. Refresh the comparison and review it again.');
        const newer = state.messages.some(item => item.appliedTaskId === task.id && item.receivedAt > message.receivedAt);
        if (newer && approved.confirmConflict !== true && approved.confirmConflict !== 'on') throw new Error('A newer email is already in the plan. Confirm that you intend to apply this older message.');
        if (task.requiresVerification && proposed.status === 'done' && task.status !== 'done') proposed.status = 'progress';
        before = copy({title:task.title,owner:task.owner,status:task.status,dueDate:task.dueDate,note:task.note,category:task.category,revision:task.revision});
        patchTask(task, proposed, actor);
      } else {
        task = createTask(proposed, actor);
      }
      task.sourceMessageId = message.id;
      task.updatedAt = timestamp();
      task.updatedBy = actor;
      if (before) message.before = before;
      if (completionReport && !task.verifiedAt) {
        task.reportedAt = task.updatedAt; task.reportedBy = message.sender;
        task.verifiedAt = ''; task.verifiedBy = '';
      }
      if (completionReport && proposed.status === "done" && !task.verifiedAt && (!task.completedAt || !task.completionReportedBy)) {
        task.completedAt = task.updatedAt;
        task.completedBy = actor;
        task.completionReportedBy = message.sender;
        task.completionReportSourceId = message.id;
      }
      if (completionReport && task.status === 'done' && !task.verifiedAt) captureCompletion(task, actor, message.sender);
      message.appliedTaskId = task.id;
      if (message.suggested.signal === 'acceptance' && task.owner && normalize(message.sender) === normalize(state.members.find(item=>item.id===task.owner)?.name)) { task.acceptedAt = timestamp(); task.acceptedBy = task.owner; task.acceptedSourceId = message.id; task.acceptedRecordedBy = actor; }
      message.appliedAt = timestamp();
      message.appliedBy = actor;
      message.approved = {...copy(proposed),...Object.fromEntries(['title','owner','status','dueDate','note','category'].map(field=>[field,task[field]]))};
      entry(actor, `applied ${message.sender}’s email to ${task.title}${task.status === "done" ? " and recorded it complete" : ""}`, task.id, "email-applied");
      syncBlocker(task, actor);
      message.appliedRevision = task.revision;
      save();
      return copy(task);
    }
    function claimTask(taskId, actor = 'jack') {
      actorId(actor); const task = taskById(taskId);
      if (task.owner) throw new Error('This task already has an owner. Refresh to see who claimed it.');
      if (task.status === 'done') throw new Error('Completed tasks cannot be claimed.');
      patchTask(task, { owner: actor }, actor);
      task.acceptedAt = timestamp(); task.acceptedBy = actor;
      task.acceptedSourceId = ''; task.acceptedRecordedBy = '';
      entry(actor, `claimed ${task.title}`, task.id, 'claimed');
      save(); return copy(task);
    }
    function acceptTask(taskId, actor = 'jack') {
      actorId(actor); const task = taskById(taskId);
      if (task.owner !== actor) throw new Error('Only the assigned owner can accept this commitment.');
      if (!task.acceptedAt) { task.acceptedAt = timestamp(); task.acceptedBy = actor; task.acceptedSourceId = ''; task.acceptedRecordedBy = ''; task.revision++; entry(actor, `accepted responsibility for ${task.title}`, task.id, 'accepted'); save(); }
      return copy(task);
    }
    function reportCompletion(taskId, note, actor = 'jack') {
      actorId(actor); const task = taskById(taskId);
      if (task.owner !== actor) throw new Error('Only the assigned owner can report this commitment complete.');
      if (!clean(note)) throw new Error('Add a completion note so the organizer knows what happened.');
      if (task.verifiedAt) return copy(task);
      patchTask(task, { status: task.requiresVerification ? 'progress' : 'done', note }, actor);
      task.reportedAt = timestamp(); task.reportedBy = state.members.find(item => item.id === actor).name;
      task.verifiedAt = ''; task.verifiedBy = '';
      task.blockerFingerprint = '';
      if (task.status === 'done') captureCompletion(task, actor, task.reportedBy);
      entry(actor, `reported ${task.title} complete${task.requiresVerification ? '; awaiting organizer verification' : ''}`, task.id, 'reported'); save(); return copy(task);
    }
    function verifyTask(taskId, actor = 'jack') {
      actorId(actor); if (actor !== 'jack') throw new Error('Only the organizer can verify completion in this demo.');
      const task = taskById(taskId); if (!task.reportedAt) throw new Error('There is no completion report to verify.');
      if (task.verifiedAt) return copy(task);
      const report = { reportedAt: task.reportedAt, reportedBy: task.reportedBy };
      patchTask(task, { status: 'done' }, actor); Object.assign(task, report);
      task.verifiedAt = timestamp(); task.verifiedBy = actor; task.revision++;
      captureCompletion(task, actor, task.reportedBy);
      entry(actor, `verified completion of ${task.title}`, task.id, 'verified'); save(); return copy(task);
    }
    function recordFollowup(taskId, afterDate, actor = 'jack') {
      actorId(actor); const task = taskById(taskId);
      if (!validDate(afterDate) || !afterDate) throw new Error('Choose the next follow-up date.');
      task.followupAfter = afterDate;
      const draft = state.drafts.find(item => item.taskId === taskId);
      if (draft) draft.manuallySentAt = timestamp();
      entry(actor, `recorded a follow-up sent outside Gather for ${task.title}; next check ${afterDate}`, taskId, 'followup-recorded'); save();
    }
    function updateEvent(data, actor = 'jack') {
      actorId(actor); const next = {...state.event};
      for (const field of ['guestCount','dietaryOutstanding']) { const value = Number(data[field] ?? next[field]); if (!Number.isInteger(value) || value < 0 || value > 100000) throw new Error('Use a valid guest count.'); next[field] = value; }
      if (next.dietaryOutstanding > next.guestCount) throw new Error('Outstanding dietary responses cannot exceed the guest count.');
      for (const field of ['outdoor','transportNeeded']) if (data[field] !== undefined) next[field] = data[field] === true || data[field] === 'true';
      if (data.cateringDeadline !== undefined) { if (!validDate(data.cateringDeadline)) throw new Error('Choose a valid catering deadline.'); next.cateringDeadline = data.cateringDeadline; }
      state.event = next; entry(actor, 'updated the event context used by planning checks', '', 'event-context'); save(); return copy(next);
    }
    function addMemory(data, actor = "jack") {
      actorId(actor);
      const change = clean(data.change, 3000);
      if (!change) throw new Error("Add one thing to remember for next time.");
      const rating = Number(data.rating) || 0;
      if (!Number.isInteger(rating) || rating < 0 || rating > 5) throw new Error("Choose a rating from 1 to 5.");
      const scope = data.scope || 'always';
      if (!['always','outdoor','transport','same-venue'].includes(scope)) throw new Error('Choose when this lesson applies.');
      const memory = { id: id("memory"), change, wentWell: clean(data.wentWell, 3000), category: clean(data.category, 80) || "Guest care", rating, at: timestamp(), scope, context: clean(data.context,2000), venue: state.event.location, sourceEvent: state.event.name, outcome: 'untested', outcomeNote: '', active: true };
      state.memories.unshift(memory);
      entry(actor, "saved a lesson for future events", "", "memory");
      save();
      return copy(memory);
    }
    function updateMemory(memoryId, data, actor = 'jack') {
      actorId(actor); const memory = state.memories.find(item => item.id === memoryId);
      if (!memory) throw new Error('This lesson could not be found.');
      const scope = data.scope || memory.scope;
      const outcome = data.outcome || memory.outcome;
      if (!['always','outdoor','transport','same-venue'].includes(scope) || !['untested','helped','did-not-help'].includes(outcome)) throw new Error('Choose valid lesson context and outcome.');
      const change = data.change === undefined ? memory.change : clean(data.change,3000);
      if (!change) throw new Error('Keep a useful lesson for the next event.');
      Object.assign(memory,{ change, scope, outcome, context: clean(data.context ?? memory.context,2000), outcomeNote: clean(data.outcomeNote ?? memory.outcomeNote,2000), active: data.active === undefined ? memory.active : data.active === true || data.active === 'true', editedAt: timestamp() });
      entry(actor,'updated a lesson’s applicability and outcome','','memory-updated'); save(); return copy(memory);
    }
    function memoryApplies(memory) { return memory.active && memory.outcome !== 'did-not-help' && (memory.scope === 'always' || memory.scope === 'outdoor' && state.event.outdoor || memory.scope === 'transport' && state.event.transportNeeded || memory.scope === 'same-venue' && memory.venue === state.event.location); }

    // Dependencies are explicit task links. Detection uses only shared blocker notes,
    // never private mail or booking details, and does not assume a follow-up owner.
    function blockerSpecs(task) {
      const rules = [
        { key: 'dietary', test: /dietary|allerg|food restrictions/, title: 'Collect dietary restrictions', category: 'Food & drink', match: /(?:collect|gather|confirm|resolve|finali[sz]e|obtain|follow.?up).*?(?:dietary|allerg|food restrictions)/i },
        { key: 'passengers', test: /passenger count|rider count|transport numbers/, title: 'Confirm passenger count', category: 'Transport', match: /(?:collect|confirm|finali[sz]e|gather).*?(?:passenger|rider|transport numbers)/i },
        { key: 'budget:' + task.id, test: /budget|approv.*(?:cost|extra|fund|payment|deposit)|(?:cost|extra|fund|payment|deposit).*approv/, title: clean('Approve budget: ' + task.title, 200), category: task.category, match: null },
      ];
      const clauses = task.note.toLowerCase().split(/[.;\n]|\b(?:and|but|however)\b/).filter(clause =>
        !/\b(?:no longer (?:blocked|waiting)|not (?:blocked|waiting))\b/.test(clause) &&
        (!/\b(?:resolved|complete|completed|collected|received|confirmed|approved|done)\b/.test(clause) || /\b(?:not|pending|waiting|missing|still|need|lack|without|unconfirmed)\b/.test(clause)));
      const matches = rules.filter(rule => clauses.some(clause => rule.test.test(clause)));
      return matches.length ? matches : [{ key: 'custom:' + task.id, title: clean('Resolve blocker: ' + task.title, 200), category: task.category, match: null }];
    }
    function dependsOn(taskId, targetId, visited = new Set()) {
      if (taskId === targetId) return true;
      if (visited.has(taskId)) return false;
      visited.add(taskId);
      return (state.tasks.find(t => t.id === taskId)?.dependencies || []).some(link => dependsOn(link.taskId, targetId, visited));
    }
    function dependencyComment(task, text, actor, sourceTaskId, kind) {
      const comment = { id: id('comment'), actor, text, at: timestamp(), sourceTaskId, kind };
      task.comments.push(comment);
      task.revision++;
      entry(actor, text, task.id, kind);
    }
    function linkDependency(task, prerequisite, actor, automatic, key = '') {
      if (dependsOn(prerequisite.id, task.id)) throw new Error('These tasks would depend on each other. Choose a different task.');
      const existing = task.dependencies.find(link => link.taskId === prerequisite.id);
      if (existing) return existing;
      const link = { taskId: prerequisite.id, reason: task.note, automatic, key, createdAt: timestamp(), delivered: '' };
      task.dependencies.push(link);
      dependencyComment(task, `Waiting on “${prerequisite.title}”.`, actor, prerequisite.id, 'dependency-linked');
      return link;
    }
    function genericLink(task, link) {
      return link.automatic && (link.key === 'custom:' + task.id || link.key?.startsWith('custom:' + task.id + ':'));
    }
    function unusedPlaceholder(task) {
      const candidates = task.dependencies.filter(link => genericLink(task, link) && !link.independent).map(link => ({link, task: state.tasks.find(t => t.id === link.taskId)})).filter(({task: child}) =>
        child && child.blockerOriginKey?.startsWith('custom:') && child.title.startsWith('Resolve blocker: ') &&
        child.status === 'todo' && !child.owner && child.revision === (child.blockerAutoRevision || 1) &&
        !child.comments.length && !child.dependencies.length && !child.acceptedAt && !child.reportedAt && !child.completedAt && !child.completionResult &&
        !child.requiresVerification && !child.followupAfter && !child.sourceMessageId && !child.memoryId && !child.suggestionId &&
        !state.drafts.some(draft => draft.taskId === child.id) &&
        !state.messages.some(message => [message.linkedTaskId,message.appliedTaskId,message.suggested?.taskId].includes(child.id)) &&
        state.tasks.filter(parent => parent.dependencies.some(link => link.taskId === child.id)).length === 1);
      return candidates.length === 1 ? candidates[0] : null;
    }
    function refinePlaceholder(parent, placeholder, spec, actor, automatic = true) {
      const child = placeholder.task, link = placeholder.link, previousTitle = child.title;
      const previousReason = link.reason;
      patchTask(child, { title: spec.title, category: spec.category || parent.category,
        note: `Needed for “${parent.title}”.\n${parent.note}\n\nAdd the result when reporting complete. It will be shared with linked tasks.` }, actor);
      child.blockerOriginKey = spec.key;
      child.blockerAutoRevision = child.revision;
      Object.assign(link, {key: spec.key, reason: parent.note, automatic});
      dependencyComment(parent, `Updated follow-up “${previousTitle}” to “${child.title}”.${previousReason !== parent.note ? '\nPrevious blocker: ' + previousReason : ''}`, actor, child.id, 'dependency-refined');
      return child;
    }
    function mergePlaceholder(parent, placeholder, target, actor) {
      // Keep the entire unused placeholder in the export/audit history. Never
      // discard a claimed, edited, shared or otherwise used task.
      state.retiredBlockerTasks ||= [];
      state.retiredBlockerTasks.push({...copy(placeholder.task), mergedInto: target.id, retiredAt: timestamp(), retiredBy: actor});
      state.tasks = state.tasks.filter(task => task.id !== placeholder.task.id);
      parent.dependencies = parent.dependencies.filter(link => link !== placeholder.link);
      dependencyComment(parent, `Merged unused follow-up “${placeholder.task.title}” into “${target.title}”. Original retained in the plan export.`, actor, target.id, 'dependency-merged');
    }
    function syncBlocker(task, actor) {
      if (task.status !== 'blocked') { task.blockerFingerprint = ''; return false; }
      const fingerprint = normalize(task.note);
      if (!fingerprint || task.blockerFingerprint === fingerprint) return false;
      const additional = /\b(?:also|another|additional|separate)\b/i.test(task.note);
      if (additional) task.dependencies.filter(link => genericLink(task,link)).forEach(link => { link.independent = true; });
      let placeholder = additional ? null : unusedPlaceholder(task);
      // A generic follow-up is one placeholder, not a new task for every wording.
      for (const spec of blockerSpecs(task)) {
        const generic = spec.key.startsWith('custom:');
        if (generic && additional) spec.key += ':' + fingerprint;
        const current = task.dependencies.find(link => (link.key === spec.key || generic && !additional && !link.independent && (genericLink(task,link) || !link.automatic)) && state.tasks.some(t => t.id === link.taskId && t.status !== 'done'));
        if (current && placeholder && current === placeholder.link && generic) {
          refinePlaceholder(task, placeholder, spec, actor);
          placeholder = null;
        } else if (current && placeholder && !generic) {
          mergePlaceholder(task, placeholder, taskById(current.taskId), actor);
          placeholder = null;
        }
        if (!current) {
          const matches = state.tasks.filter(t => t.id !== task.id && t.status !== 'done' && !dependsOn(t.id, task.id) &&
            !t.blockerOriginKey?.startsWith('custom:') &&
            (spec.match ? spec.match.test(t.title) : t.blockerOriginKey === spec.key));
          let prerequisite = matches.length === 1 ? matches[0] : null;
          if (prerequisite && placeholder) {
            mergePlaceholder(task, placeholder, prerequisite, actor);
            placeholder = null;
          } else if (!prerequisite && placeholder) {
            prerequisite = refinePlaceholder(task, placeholder, spec, actor);
            placeholder = null;
          } else if (!prerequisite) {
            prerequisite = createTask({ title: spec.title, category: spec.category, owner: '', dueDate: task.dueDate,
              note: `Needed for “${task.title}”.\n${task.note}\n\nAdd the result when reporting complete. It will be shared with linked tasks.` }, actor);
            prerequisite.blockerOriginKey = spec.key;
            entry(actor, `created ${prerequisite.title} from a blocker on ${task.title}`, prerequisite.id, 'blocker-task-created');
          }
          const link = linkDependency(task, prerequisite, actor, true, spec.key);
          if (generic && additional) link.independent = true;
        }
      }
      task.blockerFingerprint = fingerprint;
      return true;
    }
    function canManageDependencies(task, actor) {
      actorId(actor);
      if (actor !== 'jack' && task.owner !== actor) throw new Error('Only this task’s owner or the organizer can change its blockers.');
      if (task.status !== 'blocked') throw new Error('Report this task blocked before linking follow-up work.');
    }
    function addDependency(taskId, data, actor = 'jack') {
      const task = taskById(taskId); canManageDependencies(task, actor);
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['taskId','title','additional'].includes(key)) || data.additional !== undefined && typeof data.additional !== 'boolean') throw new Error('Choose an existing task or enter a follow-up title.');
      const placeholder = data.additional ? null : unusedPlaceholder(task);
      let prerequisite;
      if (data.taskId) {
        if (data.title) throw new Error('Choose a task or create one, not both.');
        prerequisite = taskById(data.taskId);
        if (dependsOn(prerequisite.id, task.id)) throw new Error('These tasks would depend on each other. Choose a different task.');
        if (placeholder && placeholder.task.id !== prerequisite.id) mergePlaceholder(task, placeholder, prerequisite, actor);
      } else {
        if (!clean(data.title)) throw new Error('Name the follow-up task.');
        prerequisite = state.tasks.find(child => task.dependencies.some(link => link.taskId === child.id) && normalize(child.title) === normalize(data.title) && child.status !== 'done');
        if (prerequisite && placeholder && placeholder.task.id !== prerequisite.id && !data.additional) mergePlaceholder(task, placeholder, prerequisite, actor);
        if (!prerequisite && placeholder) prerequisite = refinePlaceholder(task, placeholder, {title: data.title, key: blockerSpecs({...task,note:clean(data.title)})[0].key}, actor, false);
        if (!prerequisite) {
          prerequisite = createTask({ title: data.title, category: task.category, dueDate: task.dueDate, note: `Needed for “${task.title}”.\n${task.note}\n\nShare the result when reporting complete.` }, actor);
          entry(actor, `created ${prerequisite.title} from a blocker on ${task.title}`, prerequisite.id, 'blocker-task-created');
        }
      }
      linkDependency(task, prerequisite, actor, false, blockerSpecs({...task,note:prerequisite.title})[0].key);
      if (data.additional) {
        for (const link of task.dependencies.filter(link => genericLink(task,link) && !link.independent)) {
          link.independent = true;
          task.revision++;
        }
      }
      task.blockerFingerprint = normalize(task.note);
      save(); return copy(prerequisite);
    }
    function removeDependency(taskId, prerequisiteId, actor = 'jack') {
      const task = taskById(taskId); canManageDependencies(task, actor);
      const link = task.dependencies.find(item => item.taskId === prerequisiteId);
      if (!link) throw new Error('That task is no longer linked.');
      task.dependencies = task.dependencies.filter(item => item !== link);
      task.blockerFingerprint = normalize(task.note);
      dependencyComment(task, `Removed blocker link to “${taskById(prerequisiteId).title}”. The follow-up task is unchanged.`, actor, prerequisiteId, 'dependency-removed');
      save(); return copy(task);
    }
    function dependencyResolved(task) { return task && task.status === 'done' && (!task.requiresVerification || Boolean(task.verifiedAt)); }
    function captureCompletion(task, actor, reporter = '') {
      task.completionResult = { text: task.note, at: timestamp(), actor, reporter, verifiedBy: task.verifiedBy || '' };
    }
    function deliverDependencyResults() {
      for (const task of state.tasks) for (const link of task.dependencies) {
        const prerequisite = state.tasks.find(t => t.id === link.taskId);
        if (!prerequisite) continue;
        const actor = dependencyResolved(prerequisite) ? prerequisite.completionResult?.actor || prerequisite.completedBy || 'jack' : prerequisite.updatedBy || 'jack';
        if (!dependencyResolved(prerequisite)) {
          if (link.delivered && link.delivered !== 'open') dependencyComment(task, `“${prerequisite.title}” is no longer resolved. Review this dependency.`, actor, prerequisite.id, 'dependency-reopened');
          link.delivered = 'open';
          continue;
        }
        if (!prerequisite.completionResult) captureCompletion(prerequisite, actor, prerequisite.reportedBy || '');
        const result = prerequisite.completionResult;
        const token = JSON.stringify(result);
        if (link.delivered === token) continue;
        link.delivered = token;
        dependencyComment(task, `“${prerequisite.title}” is complete.\n${result.text || 'No result was provided. Ask for details before resuming.'}\n${task.status === 'blocked' ? 'Review the result and resume when all blockers are resolved.' : 'Result shared with this task.'}`, actor, prerequisite.id, 'dependency-result');
      }
    }
    function resumeTask(taskId, actor = 'jack') {
      const task = taskById(taskId); canManageDependencies(task, actor);
      if (!task.dependencies.length || task.dependencies.some(link => !dependencyResolved(state.tasks.find(t => t.id === link.taskId)))) throw new Error('Some linked work is still open or awaiting verification.');
      patchTask(task, { status: 'progress', note: 'Resumed after reviewing the results from: ' + task.dependencies.map(link => taskById(link.taskId).title).join('; ') + '.' }, actor);
      task.blockerFingerprint = '';
      entry(actor, `reviewed the results and resumed ${task.title}`, task.id, 'dependency-resumed');
      save(); return copy(task);
    }
    function suggestionCandidates() {
      const rules = [
        { id: "rain", title: "Add a rain plan", body: "The venue is outdoors. Choose a backup location, an owner, and a weather decision deadline.", source: "Outdoor venue · no rain plan in tasks", category: "Venue", reason: "missing-weather-plan", match: /\brain\b|weather|wet.weather/, task: { title: "Create a rain plan and decision deadline", category: "Venue", owner: "jack", dueDate: day(7), note: "Confirm a backup location, choose when to make the weather call, and prepare a guest update." } },
        { id: "accessibility", title: "Check transport accessibility", body: "Transport is being booked. Check lift access, drop-off distance, and who guests can contact if they need help.", source: "Transport tasks · no accessibility check", category: "Transport", reason: "missing-accessibility-check", match: /accessib|mobility|lift access|wheelchair/, task: { title: "Confirm accessible buses and drop-off", category: "Transport", owner: "jules", dueDate: day(3), note: "Ask about lift access, the route from drop-off to the venue, and a named contact for guests who need assistance." } },
        { id: "quiet", title: "Add a quiet rest area", body: "Last year’s feedback asked for a calm space. Make sure it appears in both the venue layout and guest directions.", source: "Event feedback · quiet space", category: "Guest care", reason: "missing-quiet-space", match: /quiet|calm space|rest area/, task: { title: "Set up a quiet rest area", category: "Guest care", owner: "", dueDate: day(7), note: "Choose a shaded location away from activities. Add signs and include it on the guest map." } },
      ];
      const candidates = rules.filter(rule => (rule.id !== 'rain' || state.event.outdoor) && (rule.id !== 'accessibility' || state.event.transportNeeded) && (rule.id !== 'quiet' || state.memories.some(memory => memory.id === 'memory-quiet' && memoryApplies(memory))) && !state.tasks.some(task => rule.match.test(task.title))).map(({ match, ...rule }) => rule);
      if (state.event.dietaryOutstanding > 0 && state.event.cateringDeadline && state.event.cateringDeadline <= day(2) && !state.tasks.some(task => task.suggestionId === 'dietary-cutoff' && task.status !== 'done')) candidates.unshift({ id: 'dietary-cutoff', title: `${state.event.dietaryOutstanding} dietary responses before the catering cutoff`, body: `The catering cutoff is ${state.event.cateringDeadline}. Your event context still records ${state.event.dietaryOutstanding} missing responses. Confirm the count and contact those guests before approving food.`, source: 'Event context · recorded count, not live RSVP data', task: {title: 'Resolve outstanding dietary responses before catering cutoff',owner:'maya',category:'Food & drink',dueDate:state.event.cateringDeadline,note:'Check the outstanding dietary count, contact missing guests, and update the event context.'} });
      state.memories.forEach((memory) => {
        if (memory.id === "memory-quiet") return;
        if (!memoryApplies(memory)) return;
        const title = `Apply lesson: ${clean(memory.change, 150)}`;
        if (state.tasks.some((task) => task.memoryId === memory.id || task.suggestionId === `lesson-${memory.id}` || normalize(task.title) === normalize(title) || task.note.includes(`Event memory ${memory.id}:`))) return;
        candidates.push({ id: `lesson-${memory.id}`, title: "Event feedback", body: memory.change, source: `Event feedback · ${memory.scope === 'outdoor' ? 'outdoor event' : memory.scope === 'transport' ? 'transport planned' : memory.scope === 'same-venue' ? 'same venue' : 'all events'}${memory.outcome === 'helped' ? ' · previously helped' : ''}`, category: memory.category || "Guest care", reason: "team-feedback", task: { title, category: memory.category || "Guest care", owner: "", dueDate: "", note: `From event feedback: ${memory.change}${memory.context ? `\nApplies when: ${memory.context}` : ''}${memory.wentWell ? `\nKeep what worked: ${memory.wentWell}` : ""}` } });
      });
      return candidates;
    }
    function getSuggestions() { return copy(suggestionCandidates().filter((suggestion) => !state.dismissed.includes(suggestion.id))); }
    function acceptSuggestion(suggestionId, actor = "jack") {
      actorId(actor);
      const suggestion = suggestionCandidates().find((item) => item.id === suggestionId);
      if (!suggestion) {
        const known = { rain: /\brain\b|weather/, accessibility: /accessib|mobility|lift access|wheelchair/, quiet: /quiet|calm space|rest area/ };
        const task = state.tasks.find((item) => known[suggestionId]?.test(`${item.title} ${item.note}`) || item.suggestionId === suggestionId || (suggestionId.startsWith("lesson-") && (item.memoryId === suggestionId.slice(7) || item.note.includes(`Event memory ${suggestionId.slice(7)}:`))));
        return task ? copy(task) : null;
      }
      const existing = state.tasks.find((task) => normalize(task.title) === normalize(suggestion.task.title));
      if (existing) return copy(existing);
      const task = createTask(suggestion.task, actor);
      task.suggestionId = suggestionId;
      if (suggestionId.startsWith("lesson-")) task.memoryId = suggestionId.slice(7);
      entry(actor, `added planning suggestion: ${task.title}`, task.id, "suggestion");
      state.dismissed = state.dismissed.filter((item) => item !== suggestionId);
      save();
      return copy(task);
    }
    function dismissSuggestion(suggestionId) {
      assertFresh();
      if (!suggestionCandidates().some((item) => item.id === suggestionId)) return false;
      if (!state.dismissed.includes(suggestionId)) { state.dismissed.push(suggestionId); save(); }
      return true;
    }
    return { getState, subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }, addTask, updateTask, addComment, saveDraft, addMessage, applyMessage, refreshProposal, ignoreMessage, claimTask, acceptTask, reportCompletion, verifyTask, recordFollowup, updateEvent, addMemory, updateMemory, acceptSuggestion, dismissSuggestion, getSuggestions, addDependency, removeDependency, resumeTask, exportState() { return JSON.stringify(state, null, 2); } };
  }
  function rootStorage() { return typeof localStorage !== "undefined" ? localStorage : null; }
  return { createStore, STORAGE_KEY: KEY, STATUSES: [...STATUSES] };
});
