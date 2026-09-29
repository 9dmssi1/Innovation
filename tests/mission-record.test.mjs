import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MISSIONS, MISSION_VERSION, MAX_MISSION_ACTIONS, createMission,
  applyMissionAction, restoreMission, missionHint} from '../public/mission-core.js';
import {restoreMissionRecord, missionReport, mountMission} from '../public/mission.js';
import {MISSION_MESSAGES, missionText} from '../public/mission-i18n.js';

const routes = {guided: [1, 4, 5, 8], transfer: [4, 6, 8, 7]};
const clone = value => JSON.parse(JSON.stringify(value));

function traverse(stage, withPractice = false) {
  let state = createMission(stage);
  const {graph, start} = MISSIONS[stage];
  if (withPractice) {
    state = applyMissionAction(state, {type: 'hint'});
    state = applyMissionAction(state, {type: 'hint'});
    state = applyMissionAction(state, {type: 'take', node: start === 1 ? 2 : 1});
  }
  while (state.phase === 'take') {
    const node = state.queue[0];
    state = applyMissionAction(state, {type: 'take', node});
    const neighbors = graph.edges.flatMap(edge =>
      edge.a === node ? [edge.b] : edge.b === node ? [edge.a] : [])
      .sort((a, b) => a - b);
    for (const neighbor of neighbors) {
      if (!state.discovered.includes(neighbor)) {
        state = applyMissionAction(state, {type: 'add', node: neighbor});
      }
    }
    state = applyMissionAction(state, {type: 'finish'});
  }
  return state;
}

function complete(stage, withPractice = false) {
  let state = traverse(stage, withPractice);
  if (withPractice) {
    state = applyMissionAction(state, {type: 'hint'});
    const {start, target} = MISSIONS[stage];
    state = applyMissionAction(state, {type: 'path', nodes: [start, target]});
  }
  return applyMissionAction(state, {type: 'path', nodes: routes[stage]});
}

function completedRecord(withPractice = false) {
  return {...restoreMissionRecord(null), screen: 'finish',
    guided: complete('guided', withPractice).actions,
    transfer: complete('transfer', withPractice).actions,
    paths: clone(routes), reflectionChoice: 1, reflectionErrors: 2,
    reflectionPassed: true, note: 'BFS сначала исследует ближайший уровень.'};
}

test('Mission records replay complete stages and preserve independent drafts through JSON round trips', () => {
  assert.deepEqual(restoreMissionRecord(undefined), restoreMissionRecord(null));
  const saved = completedRecord(true);
  const clean = restoreMissionRecord(clone(saved));
  assert.deepEqual(clean, saved);
  for (const stage of ['guided', 'transfer']) {
    const state = restoreMission(stage, clean[stage]);
    assert.equal(state.phase, 'done');
    assert.deepEqual(state.path, routes[stage]);
    assert.equal(state.errors, 2);
    assert.equal(state.hints, 2);
  }
  clean.paths.guided.push(9);
  clean.guided[0].type = 'finish';
  assert.deepEqual(saved.paths.guided, routes.guided);
  assert.equal(saved.guided[0].type, 'hint');
  const draft = {...restoreMissionRecord(null), screen: 'guided',
    guided: [{type: 'take', node: 1}], paths: {guided: [1, 4], transfer: []}};
  assert.deepEqual(restoreMissionRecord(clone(draft)), draft);
});

test('Stage gates prevent transfer and reflection before the required traversals are completed', () => {
  const initial = restoreMissionRecord(null);
  for (const screen of ['transfer', 'reflection', 'finish']) {
    assert.throws(() => restoreMissionRecord({...initial, screen}));
  }
  assert.throws(() => restoreMissionRecord({...initial,
    transfer: [{type: 'take', node: MISSIONS.transfer.start}]}));
  const guided = complete('guided').actions;
  assert.equal(restoreMissionRecord({...initial, screen: 'transfer', guided}).screen, 'transfer');
  for (const screen of ['reflection', 'finish']) {
    assert.throws(() => restoreMissionRecord({...initial, guided, screen}));
  }
  const both = {...initial, guided, transfer: complete('transfer').actions, screen: 'reflection'};
  assert.equal(restoreMissionRecord(both).screen, 'reflection');
  assert.equal(missionReport(both).completed, false);
});

test('Stored stage counters and completion flags cannot replace the replayed action evidence', () => {
  const record = completedRecord(true);
  record.errors = 0;
  record.hints = 0;
  record.completed = true;
  record.stageResults = {guided: {errors: 0, hints: 0}, transfer: {errors: 0, hints: 0}};
  record.guided = {version: MISSION_VERSION, actions: record.guided, errors: 0, hints: 0, phase: 'done'};
  record.transfer = {version: MISSION_VERSION, actions: record.transfer, errors: 0, hints: 0, phase: 'done'};
  const report = missionReport(record);
  assert.deepEqual(report.stages.map(({errors, hints}) => ({errors, hints})),
    [{errors: 2, hints: 2}, {errors: 2, hints: 2}]);
  const forged = {...restoreMissionRecord(null), completed: true, errors: 0,
    hints: 0, reflectionChoice: 1, reflectionPassed: true};
  assert.equal(missionReport(forged).completed, false);
  assert(report.stages.every(stage => stage.actions.length > 0));
});

test('Invalid versions, corrupt drafts, malformed action logs and reflection values are rejected', () => {
  const initial = restoreMissionRecord(null);
  for (const change of [
    {version: 0}, {version: '1'}, {screen: 'unknown'},
    {guided: [{type: 'take', node: '1'}]}, {transfer: null},
    {paths: {guided: '1,4', transfer: []}},
    {paths: {guided: [1, 99], transfer: []}},
    {paths: {guided: [], transfer: [9]}},
    {paths: {guided: Array(25).fill(1), transfer: []}},
    {reflectionChoice: -1}, {reflectionChoice: '1'}, {reflectionChoice: undefined},
    {reflectionErrors: -1}, {reflectionErrors: 0.5},
    {reflectionErrors: '0'}, {reflectionErrors: 100001}
  ]) assert.throws(() => restoreMissionRecord({...initial, ...change}));
  assert.throws(() => restoreMissionRecord({}));
  assert.throws(() => restoreMissionRecord(false));
});

test('Reflection succeeds only after both missions, an explicitly checked correct explanation and its pass flag', () => {
  const record = completedRecord();
  assert.equal(missionReport(record).completed, true);
  for (const reflectionChoice of [null, 0, 2]) {
    const clean = restoreMissionRecord({...record, reflectionChoice});
    assert.equal(clean.reflectionPassed, false);
    assert.equal(clean.screen, 'reflection');
  }
  for (const reflectionPassed of [false, 'true', 1, undefined]) {
    const clean = restoreMissionRecord({...record, reflectionPassed});
    assert.equal(clean.reflectionPassed, false);
    assert.equal(clean.screen, 'reflection');
  }
  assert.throws(() => restoreMissionRecord({...record, transfer: []}));
  // Reflection answers/counts remain local practice data, not verified grades.
  assert.equal(missionReport(record).assessment, 'practice-not-school-grade');
});

// Minimal DOM double exercises the controller's real event callbacks and saved
// record. Layout, focus visibility and native browser behavior need browser QA.
function mountController(record) {
  const listeners = new Map();
  const body = {innerHTML: '', querySelector: () => null};
  const passive = {textContent: '', focus() {}};
  let saved = clone(record);
  const root = {
    innerHTML: '', scrollIntoView() {},
    querySelector: selector => selector === '#mission-body' ? body : passive,
    addEventListener(type, listener, {signal}) {
      listeners.set(type, listener);
      signal.addEventListener('abort', () => listeners.delete(type));
    }
  };
  const mounted = mountMission(root, {storageKey: 'test-mission', storage: {
    get: () => clone(saved), set: (_key, value) => {saved = clone(value); return true;}
  }});
  return {
    snapshot: () => clone(saved), html: () => body.innerHTML,
    click: (action, value) => listeners.get('click')?.({target: {closest: () => ({
      dataset: {mission: action, value}, disabled: false, id: ''
    })}}),
    change: value => listeners.get('change')?.({target: {name: 'mission-reflection', value: String(value)}}),
    submit: () => listeners.get('submit')?.({target: {id: 'mission-reflection-form'}, preventDefault() {}, stopPropagation() {}}),
    dispose: () => mounted.dispose()
  };
}

test('Revising an already accepted explanation clears completion until the new answer passes', () => {
  const ui = mountController(completedRecord());
  ui.click('navigate', 'transfer');
  ui.click('next-stage');
  assert.equal(ui.snapshot().screen, 'reflection');
  ui.change(0);
  assert.equal(ui.snapshot().reflectionPassed, false);
  ui.submit();
  assert.equal(ui.snapshot().reflectionErrors, 3);
  assert.equal(missionReport(ui.snapshot()).completed, false);
  ui.click('navigate', 'reflection');
  assert.equal(ui.snapshot().screen, 'reflection', 'A stale success marker must not reopen the finished screen');
  ui.change(1);
  assert.equal(ui.snapshot().reflectionPassed, false, 'Choosing the right answer is not the same as checking it');
  ui.submit();
  assert.equal(ui.snapshot().screen, 'finish');
  assert.equal(missionReport(ui.snapshot()).completed, true);
  const finished = ui.snapshot();
  ui.change(0);
  assert.deepEqual(ui.snapshot(), finished, 'A late change event from a removed form must not edit the completed record');
  ui.dispose();
});

test('Export round trip reports exact replayed metrics and keeps user prose raw rather than HTML-encoding it', () => {
  const record = completedRecord(true);
  record.note = '<script>текст ученика</script> & "A → B"';
  const report = missionReport(clone(record));
  assert.deepEqual(report, {
    format: 'graph-bfs-mission', version: MISSION_VERSION, storage: 'local-browser',
    assessment: 'practice-not-school-grade', completed: true,
    stages: ['guided', 'transfer'].map(stage => ({
      stage, start: MISSIONS[stage].start, target: MISSIONS[stage].target,
      completed: true, errors: 2, hints: 2, path: routes[stage], actions: record[stage]
    })),
    reflection: {choice: 1, errors: 2, passed: true, note: record.note}
  });
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  report.stages[0].actions[0].type = 'finish';
  assert.equal(record.guided[0].type, 'hint');
  assert.equal(restoreMissionRecord({...record, note: 'x'.repeat(1300)}).note.length, 1200);
  assert.equal(restoreMissionRecord({...record, note: {html: 'ignored'}}).note, '');
});

test('Every mission message has nonempty RU/KK text and matching named placeholders', () => {
  const tokens = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, pair] of Object.entries(MISSION_MESSAGES)) {
    assert.equal(pair.length, 2, key);
    for (const text of pair) assert.equal(typeof text === 'string' && text.trim().length > 0, true, key);
    assert.deepEqual(tokens(pair[0]), tokens(pair[1]), key);
  }
  assert.throws(() => missionText('does-not-exist', {}, 'ru'));
  assert.equal(missionText('title', {}, 'kk'), MISSION_MESSAGES.title[1]);
  assert.equal(missionText('title', {}, 'ru'), MISSION_MESSAGES.title[0]);
});

test('All feedback codes emitted by the engine render both languages using their actual parameters', async () => {
  const feedback = new Map();
  const collect = value => {feedback.set(value.code, value); return value;};
  const collectState = state => {collect(state.feedback); return state;};
  const initial = collectState(createMission());
  collect(missionHint(initial));
  for (const action of [{type: 'take', node: 4}, {type: 'take', node: 99}, {type: 'finish'}]) {
    collectState(applyMissionAction(initial, action));
  }
  let state = collectState(applyMissionAction(initial, {type: 'take', node: 1}));
  collect(missionHint(state));
  for (const action of [{type: 'add', node: 1}, {type: 'add', node: 9},
    {type: 'add', node: 4}, {type: 'finish'}]) collectState(applyMissionAction(state, action));
  state = collectState(applyMissionAction(state, {type: 'add', node: 2}));
  state = collectState(applyMissionAction(state, {type: 'add', node: 4}));
  collect(missionHint(state));
  collectState(applyMissionAction(state, {type: 'finish'}));
  state = collectState(traverse('guided'));
  collect(missionHint(state));
  for (const nodes of [[], [1, 8], [1, 2, 1, 4, 5, 8], [1, 2, 3, 6, 5, 8]]) {
    collectState(applyMissionAction(state, {type: 'path', nodes}));
  }
  const done = collectState(applyMissionAction(state, {type: 'path', nodes: routes.guided}));
  collect(missionHint(done));
  const capped = restoreMission('guided', Array.from({length: MAX_MISSION_ACTIONS}, () => ({type: 'hint'})));
  collectState(applyMissionAction(capped, {type: 'take', node: 1}));
  // Detect new engine codes even when a future edit forgets to extend this flow.
  const source = await readFile(new URL('../public/mission-core.js', import.meta.url), 'utf8');
  const coreCodes = new Set([...source.matchAll(/\bcode:\s*['"]([\w]+)['"]|\bfail\(['"]([\w]+)['"]/g)]
    .map(match => match[1] || match[2]));
  assert.deepEqual([...feedback.keys()].sort(), [...coreCodes].sort());
  for (const [code, params] of feedback) {
    const key = 'feedback.' + code;
    assert(Object.hasOwn(MISSION_MESSAGES, key), key);
    for (const language of ['ru', 'kk']) {
      const template = MISSION_MESSAGES[key][language === 'kk' ? 1 : 0];
      for (const [, placeholder] of template.matchAll(/\{(\w+)\}/g)) {
        assert.notEqual(params[placeholder], undefined, key + ':' + placeholder);
      }
      const rendered = missionText(key, params, language);
      assert(rendered.trim().length > 0, key);
      assert.doesNotMatch(rendered, /\{\w+\}|undefined|\[object Object\]/, key);
    }
  }
});
