import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextTutorialMilestone,
  shouldRecordTutorialCheckpoint as mayRecord,
  TUTORIAL_MILESTONES,
  TUTORIAL_STEPS,
  tutorialResume,
} from '../lib/guided-tutorial.ts';

const initial = { projectId: null, reached: [] };
const project = 'p_fictional';

test('guide advances in order, without making telemetry-only clicks mandatory', () => {
  const progress = { ...initial, reached: [] };
  for (const id of TUTORIAL_MILESTONES) {
    assert.equal(nextTutorialMilestone(progress.reached), id);
    const { evidence } = TUTORIAL_STEPS.find(step => step.id === id);
    assert.ok(mayRecord(progress, id, evidence, id === 'started' ? null : project));
    progress.reached.push(id);
    if (id === 'project_created') progress.projectId = project;
  }
  assert.equal(nextTutorialMilestone(progress.reached), null);
});

test('funnel keeps views and clicks distinct from successful saves', () => {
  const started = { ...initial, reached: ['started'] };
  assert.ok(mayRecord(started, 'setup_viewed', 'view', null));
  assert.ok(mayRecord(started, 'create_project_clicked', 'interaction', null));
  assert.ok(!mayRecord(started, 'project_created', 'interaction', project));
  assert.ok(!mayRecord(started, 'project_created', 'view', project));
  assert.ok(!mayRecord(started, 'project_created', 'project_commit', null));
  const task = { projectId: project, reached: ['started', 'project_created'] };
  assert.ok(mayRecord(task, 'add_task_clicked', 'interaction', project));
  assert.ok(!mayRecord(task, 'task_created', 'interaction', project));
  assert.ok(!mayRecord(task, 'budget_viewed', 'view', project));
  const invite = { projectId: project, reached: TUTORIAL_MILESTONES.slice(0, -1) };
  assert.ok(mayRecord(invite, 'invite_form_viewed', 'view', project));
  assert.ok(!mayRecord(invite, 'invite_created', 'interaction', project));
});

test('retries, unrelated projects, out-of-order and unknown signals cannot alter the chain', () => {
  const progress = { projectId: project, reached: ['started', 'project_created'] };
  assert.ok(!mayRecord(progress, 'started', 'interaction', null));
  assert.ok(!mayRecord(progress, 'project_created', 'project_commit', 'p_other'));
  assert.ok(!mayRecord(progress, 'task_created', 'task_commit', 'p_other'));
  assert.ok(!mayRecord(progress, 'setup_viewed', 'view', null));
  assert.ok(!mayRecord(progress, 'invite_created', 'invite_commit', project));
  assert.ok(!mayRecord(progress, { checkpoint: 'task_created' }, 'task_commit', project));
});

test('an explicit finish without a new invite does not pretend an invitation was saved', () => {
  const progress = { projectId: project, reached: TUTORIAL_MILESTONES.slice(0,-1) };
  assert.ok(mayRecord(progress,'invite_skipped','interaction',project));
  const skipped = { ...progress, reached:[...progress.reached,'invite_skipped'] };
  assert.equal(nextTutorialMilestone(skipped.reached),null);
  assert.ok(!mayRecord(skipped,'invite_created','invite_commit',project));
  assert.ok(!mayRecord({ ...progress,reached:[...progress.reached,'invite_created'] },'invite_skipped','interaction',project));
});

test('resume uses persisted milestones, never an unrelated or unavailable project', () => {
  assert.equal(tutorialResume(initial, [project]), null);
  assert.deepEqual(tutorialResume({projectId:null,reached:['started','setup_viewed']}, []), {next:'project_created',projectId:null});
  const bound = {projectId:project,reached:['started','project_created','add_task_clicked']};
  assert.equal(tutorialResume(bound, ['p_other']), null);
  assert.deepEqual(tutorialResume(bound, ['p_other',project]), {next:'task_created',projectId:project});
  assert.equal(tutorialResume({projectId:project,reached:[...TUTORIAL_MILESTONES.slice(0,-1),'invite_skipped']}, [project]), null);
});
