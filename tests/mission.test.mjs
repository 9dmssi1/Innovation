import test from 'node:test';
import assert from 'node:assert/strict';
import {MISSIONS, MISSION_VERSION, MAX_MISSION_ACTIONS, createMission,
  applyMissionAction, restoreMission, missionHint} from '../public/mission-core.js';

// Independent oracle reads the edge list directly, never calls core.adjacency,
// core.trace or the mission's hint function to decide what the learner does.
function neighbors(graph, node) {
  const result = [];
  for (const edge of graph.edges) {
    if (edge.a === node) result.push(edge.b);
    else if (!graph.directed && edge.b === node) result.push(edge.a);
  }
  return result.sort((a, b) => a - b);
}

function allDistances(graph) {
  const ids = graph.nodes.map(n => n.id);
  const d = Object.fromEntries(ids.map(a => [a,
    Object.fromEntries(ids.map(b => [b, a === b ? 0 : Infinity]))]));
  for (const {a, b} of graph.edges) {
    d[a][b] = 1;
    if (!graph.directed) d[b][a] = 1;
  }
  for (const k of ids) for (const a of ids) for (const b of ids) {
    d[a][b] = Math.min(d[a][b], d[a][k] + d[k][b]);
  }
  return d;
}

function playTraversal(stage) {
  const {graph, start} = MISSIONS[stage];
  let state = createMission(stage);
  const queue = [start], discovered = [start], processed = [], parents = {[start]: null};
  const d = allDistances(graph)[start];
  while (queue.length) {
    const node = queue.shift();
    state = applyMissionAction(state, {type: 'take', node});
    assert.equal(state.phase, 'add');
    assert.equal(state.current, node);
    assert.deepEqual(state.queue, queue);
    for (const neighbor of neighbors(graph, node)) {
      if (discovered.includes(neighbor)) continue;
      state = applyMissionAction(state, {type: 'add', node: neighbor});
      queue.push(neighbor);
      discovered.push(neighbor);
      parents[neighbor] = node;
      assert.deepEqual(state.queue, queue);
      assert.deepEqual(state.discovered, discovered);
      assert.deepEqual(state.parents, parents);
      assert.equal(state.levels[neighbor], d[neighbor]);
    }
    processed.push(node);
    state = applyMissionAction(state, {type: 'finish'});
    assert.deepEqual(state.processed, processed);
    assert.equal(state.current, null);
    assert.equal(state.phase, queue.length ? 'take' : 'path');
    assert.equal(new Set(state.discovered).size, state.discovered.length);
  }
  assert.equal(state.errors, 0);
  assert.equal(state.processed.length, graph.nodes.length);
  assert.deepEqual(state.levels, d);
  return state;
}

function algorithmFields(state) {
  const {errors, hints, helpStates, actions, feedback, ...algorithm} = state;
  return algorithm;
}

test('Both BFS missions match independent queue and Floyd–Warshall oracles at every step', () => {
  for (const stage of Object.keys(MISSIONS)) playTraversal(stage);
  assert.notDeepEqual(MISSIONS.guided.graph.edges, MISSIONS.transfer.graph.edges);
  assert.notEqual(MISSIONS.transfer.start, 1);
});

test('Wrong queue order, unsorted discovery, duplicate/cyclic vertices and early finish do not advance BFS', () => {
  let state = createMission();
  const wrongHead = applyMissionAction(state, {type: 'take', node: 4});
  assert.equal(wrongHead.feedback.code, 'wrong_queue');
  assert.equal(wrongHead.feedback.expected, 1);
  assert.deepEqual(algorithmFields(wrongHead), algorithmFields(state));
  state = applyMissionAction(wrongHead, {type: 'take', node: 1});
  for (const [action, code] of [
    [{type: 'add', node: 4}, 'neighbor_order'],
    [{type: 'add', node: 1}, 'already_discovered'],
    [{type: 'add', node: 9}, 'not_neighbor'],
    [{type: 'add', node: 99}, 'unknown_node'],
    [{type: 'finish'}, 'neighbors_remaining'],
    [{type: 'take', node: 2}, 'wrong_phase']
  ]) {
    const next = applyMissionAction(state, action);
    assert.equal(next.feedback.code, code);
    assert.deepEqual(algorithmFields(next), algorithmFields(state));
    assert.equal(next.errors, state.errors + 1);
    state = next;
  }
  state = applyMissionAction(state, {type: 'add', node: 2});
  const duplicate = applyMissionAction(state, {type: 'add', node: 2});
  assert.equal(duplicate.feedback.code, 'already_discovered');
  assert.deepEqual(duplicate.queue, [2]);
  assert.deepEqual(duplicate.parents, {1: null, 2: 1});
});

test('All shortest routes are accepted, including routes outside the stored BFS parent tree', () => {
  const cases = {
    guided: [[1, 2, 5, 8], [1, 4, 5, 8], [1, 4, 7, 8]],
    transfer: [[4, 2, 1, 7], [4, 5, 3, 7], [4, 6, 8, 7]]
  };
  for (const [stage, routes] of Object.entries(cases)) {
    const state = playTraversal(stage);
    for (const nodes of routes) {
      const next = applyMissionAction(state, {type: 'path', nodes});
      assert.equal(next.phase, 'done');
      assert.equal(next.feedback.distance, 3);
      assert.deepEqual(next.path, nodes);
      assert.deepEqual(state.path, []);
    }
  }
});

test('Path mistakes explain wrong endpoints, absent edges, cycles and nonoptimal routes', () => {
  const state = playTraversal('guided');
  for (const [nodes, code] of [
    [[], 'path_endpoints'], [[2, 5, 8], 'path_endpoints'],
    [[1, 8], 'path_missing_edge'], [[1, 2, 1, 4, 5, 8], 'path_repeated'],
    [[1, 2, 3, 6, 5, 8], 'path_too_long'],
    [[1, 99, 8], 'path_missing_edge']
  ]) {
    const next = applyMissionAction(state, {type: 'path', nodes});
    assert.equal(next.feedback.code, code);
    assert.equal(next.errors, 1);
    assert.deepEqual(algorithmFields(next), algorithmFields(state));
  }
});

test('Hints are read-only until requested and count once for each distinct BFS situation', () => {
  let state = createMission();
  const before = JSON.stringify(state);
  assert.deepEqual(missionHint(state), {code: 'hint_take', node: 1});
  assert.equal(JSON.stringify(state), before);
  state = applyMissionAction(state, {type: 'hint'});
  state = applyMissionAction(state, {type: 'hint'});
  assert.equal(state.hints, 1);
  assert.equal(state.errors, 0);
  state = applyMissionAction(state, {type: 'take', node: 1});
  assert.deepEqual(missionHint(state), {code: 'hint_add', current: 1, node: 2});
  state = applyMissionAction(state, {type: 'hint'});
  state = applyMissionAction(state, {type: 'add', node: 4});
  state = applyMissionAction(state, {type: 'hint'});
  assert.equal(state.hints, 2, 'Wrong answers must not create fresh hint credit');
  state = applyMissionAction(state, {type: 'add', node: 2});
  state = applyMissionAction(state, {type: 'hint'});
  assert.equal(state.hints, 3);
  state = applyMissionAction(state, {type: 'add', node: 4});
  assert.deepEqual(missionHint(state), {code: 'hint_finish', current: 1});
  assert.equal(missionHint(playTraversal('guided')).code, 'hint_path');
});

test('Replay recovers mistakes and help without accepting stored scores; incompatible or malformed logs fail', () => {
  let state = createMission('transfer');
  state = applyMissionAction(state, {type: 'hint'});
  state = applyMissionAction(state, {type: 'take', node: 2});
  state = applyMissionAction(state, {type: 'take', node: 4});
  state = applyMissionAction(state, {type: 'add', node: 2});
  assert.deepEqual(restoreMission('transfer', state.actions), state);
  const record = {version: MISSION_VERSION, stage: 'transfer', actions: state.actions, errors: 0, hints: 0};
  assert.deepEqual(restoreMission('transfer', record), state);
  for (const record of [null, {}, {version: 2, actions: []},
    {version: 1, stage: 'guided', actions: []}, [{type: 'take', node: '4'}],
    [{type: 'path', nodes: [4, null, 7]}], [{type: 'finish', score: 99}],
    [{type: 'constructor'}], [{type: 'hint'}, {type: 'oops'}],
    Array.from({length: MAX_MISSION_ACTIONS + 1}, () => ({type: 'hint'}))]) {
    assert.throws(() => restoreMission('transfer', record));
  }
  assert.throws(() => createMission('constructor'));
  assert.throws(() => createMission(['guided']));
  for(const action of [{type: ['hint']}, {type: ['take'], node: 1}, {type: null}]) {
    assert.throws(() => restoreMission('guided', [action]), 'An action type must not be coerced from JSON arrays');
  }
});

test('States, action arguments and mission definitions never share mutable arrays', () => {
  const original = createMission();
  const snapshot = JSON.stringify(original);
  const action = {type: 'take', node: 1};
  const next = applyMissionAction(original, action);
  action.node = 9;
  next.queue.push(99);
  next.discovered.push(98);
  next.parents[99] = 98;
  next.feedback.remaining.push(97);
  assert.equal(JSON.stringify(original), snapshot);
  assert.equal(next.actions[0].node, 1);
  assert(Object.isFrozen(MISSIONS.guided.graph.nodes[0]));
  assert.throws(() => { MISSIONS.transfer.graph.edges.push({a: 1, b: 8, w: 1}); });
  const pathAction = {type: 'path', nodes: [1, 4, 5, 8]};
  const completed = applyMissionAction(playTraversal('guided'), pathAction);
  pathAction.nodes.push(99);
  completed.path.push(98);
  assert.deepEqual(completed.feedback.path, [1, 4, 5, 8]);
  assert.deepEqual(completed.actions.at(-1).nodes, [1, 4, 5, 8]);
});

test('Completion cannot change and the bounded history reports a recoverable limit', () => {
  const completed = applyMissionAction(playTraversal('guided'), {type: 'path', nodes: [1, 2, 5, 8]});
  for (const action of [{type: 'hint'}, {type: 'take', node: 1}, {type: 'path', nodes: [1, 8]}]) {
    assert.deepEqual(applyMissionAction(completed, action), completed);
  }
  assert.deepEqual(restoreMission('guided', [...completed.actions, {type: 'hint'}]), completed);
  let state = restoreMission('guided', Array.from({length: MAX_MISSION_ACTIONS}, () => ({type: 'hint'})));
  assert.equal(state.hints, 1);
  const capped = applyMissionAction(state, {type: 'take', node: 1});
  assert.equal(capped.feedback.code, 'history_limit');
  assert.deepEqual(algorithmFields(capped), algorithmFields(state));
  assert.equal(capped.actions.length, MAX_MISSION_ACTIONS);
});
