/*
 * Pure BFS learning mission: no DOM, localization, storage, clocks or network.
 * createMission creates an independent state; applyMissionAction returns a new
 * state; restoreMission rebuilds state from the action log, never stored scores.
 * The local log is a learning convenience, not trusted evidence for assessment.
 *
 * Feedback codes (the view translates them):
 * ready {start,target}; take_ok {node,remaining,level};
 * wrong_phase {action,phase}; unknown_node {node}; wrong_queue {node,expected};
 * already_discovered {node}; not_neighbor {node,current};
 * neighbor_order {node,expected,current}; add_ok {node,current,level,remaining};
 * neighbors_remaining {current,nodes}; finish_ok {node,next};
 * traversal_done {start,target,distance}; path_endpoints {start,target};
 * path_missing_edge {from,to}; path_repeated {node}; path_too_long {length,best};
 * done {path,distance,errors,hints}; history_limit {}.
 * Hints: hint_take {node}; hint_add {current,node}; hint_finish {current};
 * hint_path {start,target,distance}; hint_done {distance}.
 * remaining/nodes/path are arrays of vertex IDs. errors/hints are counters.
 * A structurally malformed action throws; a valid but wrong answer increments
 * errors without advancing BFS. Hint use counts once per distinct BFS state.
 */
import {GRAPH, adjacency, checkPath, copy, validateGraph} from './core.js';

export const MISSION_VERSION = 1;
export const MAX_MISSION_ACTIONS = 1000;

function freezeDeep(value) {
  Object.values(value).forEach(item => {
    if (item && typeof item === 'object') freezeDeep(item);
  });
  return Object.freeze(value);
}

export const MISSIONS = freezeDeep({
  guided: {graph: copy(GRAPH), start: 1, target: 8},
  transfer: {
    graph: {
      directed: false,
      nodes: [
        {id: 1, x: 440, y: 65}, {id: 2, x: 240, y: 65},
        {id: 3, x: 440, y: 175}, {id: 4, x: 80, y: 175},
        {id: 5, x: 240, y: 175}, {id: 6, x: 240, y: 285},
        {id: 7, x: 640, y: 175}, {id: 8, x: 440, y: 285}
      ],
      edges: [
        [4, 2], [4, 5], [4, 6], [2, 1], [5, 3], [6, 8],
        [1, 7], [3, 7], [8, 7], [2, 5], [5, 6]
      ].map(([a, b]) => ({a, b, w: 1}))
    },
    start: 4,
    target: 7
  }
});

function mission(stage) {
  if (typeof stage !== 'string' || !Object.hasOwn(MISSIONS, stage)) throw new Error('Unknown mission stage.');
  return MISSIONS[stage];
}

export function createMission(stage = 'guided') {
  const {graph, start, target} = mission(stage);
  validateGraph(graph);
  return {
    version: MISSION_VERSION, stage, phase: 'take', queue: [start],
    current: null, discovered: [start], processed: [], parents: {[start]: null},
    levels: {[start]: 0}, errors: 0, hints: 0, helpStates: [], actions: [],
    path: [], feedback: {code: 'ready', start, target}
  };
}

function assertState(state) {
  if (!state || state.version !== MISSION_VERSION ||
      !['take', 'add', 'path', 'done'].includes(state.phase) ||
      !Array.isArray(state.actions) || !Array.isArray(state.helpStates)) {
    throw new Error('Invalid mission state or version.');
  }
  mission(state.stage);
}

function assertAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string') {
    throw new Error('Mission action must be an object.');
  }
  const keys = {
    take: ['type', 'node'], add: ['type', 'node'],
    finish: ['type'], path: ['type', 'nodes'], hint: ['type']
  }[action.type];
  if (!Array.isArray(keys) || Object.keys(action).length !== keys.length ||
      keys.some(key => !Object.hasOwn(action, key))) {
    throw new Error('Invalid mission action fields.');
  }
  const validNode = node => Number.isInteger(node) && node >= 1 && node <= 99;
  if (['take', 'add'].includes(action.type) && !validNode(action.node)) {
    throw new Error('Mission node must be an integer between 1 and 99.');
  }
  if (action.type === 'path' && (!Array.isArray(action.nodes) ||
      action.nodes.length > 100 || action.nodes.some(node => !validNode(node)))) {
    throw new Error('Invalid mission path.');
  }
}

function remainingNeighbors(state) {
  return adjacency(mission(state.stage).graph)[state.current]
    .map(neighbor => neighbor.id)
    .filter(id => !state.discovered.includes(id));
}

export function missionHint(state) {
  assertState(state);
  const {start, target} = mission(state.stage);
  if (state.phase === 'take') return {code: 'hint_take', node: state.queue[0]};
  if (state.phase === 'add') {
    const remaining = remainingNeighbors(state);
    return remaining.length
      ? {code: 'hint_add', current: state.current, node: remaining[0]}
      : {code: 'hint_finish', current: state.current};
  }
  if (state.phase === 'path') {
    return {code: 'hint_path', start, target, distance: state.levels[target]};
  }
  return {code: 'hint_done', distance: state.levels[target]};
}

export function applyMissionAction(state, action) {
  assertState(state);
  assertAction(action);
  const next = copy(state);
  // Completion is immutable even if an old click/keyboard event arrives late.
  if (state.phase === 'done') return next;
  if (state.actions.length >= MAX_MISSION_ACTIONS) {
    next.feedback = {code: 'history_limit'};
    return next;
  }
  next.actions.push(copy(action));
  const {graph, start, target} = mission(state.stage);
  const fail = (code, params = {}) => {
    next.errors += 1;
    next.feedback = {code, ...params};
    return next;
  };

  if (action.type === 'hint') {
    const helpKey = JSON.stringify([state.phase, state.current, state.queue, state.discovered]);
    if (!next.helpStates.includes(helpKey)) {
      next.helpStates.push(helpKey);
      next.hints += 1;
    }
    next.feedback = missionHint(state);
    return next;
  }

  const requiredPhase = {take: 'take', add: 'add', finish: 'add', path: 'path'}[action.type];
  if (state.phase !== requiredPhase) {
    return fail('wrong_phase', {action: action.type, phase: state.phase});
  }
  if (['take', 'add'].includes(action.type) && !graph.nodes.some(n => n.id === action.node)) {
    return fail('unknown_node', {node: action.node});
  }

  if (action.type === 'take') {
    if (action.node !== state.queue[0]) {
      return fail('wrong_queue', {node: action.node, expected: state.queue[0]});
    }
    next.current = next.queue.shift();
    next.phase = 'add';
    next.feedback = {code: 'take_ok', node: next.current,
      remaining: remainingNeighbors(next), level: next.levels[next.current]};
    return next;
  }

  if (action.type === 'add') {
    const node = action.node;
    if (state.discovered.includes(node)) return fail('already_discovered', {node});
    const remaining = remainingNeighbors(state);
    if (!remaining.includes(node)) return fail('not_neighbor', {node, current: state.current});
    if (node !== remaining[0]) {
      return fail('neighbor_order', {node, expected: remaining[0], current: state.current});
    }
    next.queue.push(node);
    next.discovered.push(node);
    next.parents[node] = state.current;
    next.levels[node] = state.levels[state.current] + 1;
    next.feedback = {code: 'add_ok', node, current: state.current,
      level: next.levels[node], remaining: remainingNeighbors(next)};
    return next;
  }

  if (action.type === 'finish') {
    const remaining = remainingNeighbors(state);
    if (remaining.length) return fail('neighbors_remaining', {current: state.current, nodes: remaining});
    const node = state.current;
    next.processed.push(node);
    next.current = null;
    next.phase = next.queue.length ? 'take' : 'path';
    next.feedback = next.queue.length
      ? {code: 'finish_ok', node, next: next.queue[0]}
      : {code: 'traversal_done', start, target, distance: next.levels[target]};
    return next;
  }

  const nodes = action.nodes;
  if (nodes[0] !== start || nodes.at(-1) !== target) {
    return fail('path_endpoints', {start, target});
  }
  const seen = new Set();
  for (const node of nodes) {
    if (seen.has(node)) return fail('path_repeated', {node});
    seen.add(node);
  }
  const neighbors = adjacency(graph);
  for (let i = 1; i < nodes.length; i += 1) {
    if (!neighbors[nodes[i - 1]]?.some(n => n.id === nodes[i])) {
      return fail('path_missing_edge', {from: nodes[i - 1], to: nodes[i]});
    }
  }
  // checkPath accepts all optimal routes, including those outside the particular
  // BFS parent tree produced by the ascending-neighbor convention.
  if (!checkPath(graph, nodes, start, target).ok) {
    return fail('path_too_long', {length: nodes.length - 1, best: state.levels[target]});
  }
  next.path = copy(nodes);
  next.phase = 'done';
  next.feedback = {code: 'done', path: copy(nodes), distance: nodes.length - 1,
    errors: next.errors, hints: next.hints};
  return next;
}

export function restoreMission(stage, record) {
  mission(stage);
  // Array form is the explicit v1 function contract. Persist an envelope in the
  // view so a later algorithm revision can reject obsolete saved attempts.
  const actions = Array.isArray(record) ? record : record?.actions;
  if (!Array.isArray(record) && (!record || record.version !== MISSION_VERSION ||
      (record.stage !== undefined && record.stage !== stage))) {
    throw new Error('Saved mission version or stage does not match.');
  }
  if (!Array.isArray(actions) || actions.length > MAX_MISSION_ACTIONS) {
    throw new Error('Invalid or oversized saved mission log.');
  }
  let state = createMission(stage);
  for (const action of actions) state = applyMissionAction(state, action);
  return state;
}
