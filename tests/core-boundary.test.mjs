import test from 'node:test';
import assert from 'node:assert/strict';
import {trace, validateGraph} from '../public/core.js';

function random(seed) {
  return () => {seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32;};
}

function boundaryGraph(directed, disconnected, seed) {
  const ids = [2, 5, 11, 17, 23, 31, 43, 59, 61, 73, 89, 97];
  const rand = random(seed), candidates = [];
  for (let a = 0; a < ids.length; a++) for (let b = 0; b < ids.length; b++) {
    if (a === b || !directed && a > b || disconnected && (a < 6) !== (b < 6)) continue;
    candidates.push({a: ids[a], b: ids[b], w: 1 + Math.floor(rand() * 99)});
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return {directed, nodes: ids.map((id, i) => ({id, x: 70 + i % 4 * 190, y: 60 + Math.floor(i / 4) * 115})).reverse(), edges: candidates.slice(0, 40)};
}

// Independent all-pairs oracle; no trace, adjacency or shortest-path validator.
function distances(graph, weighted) {
  const ids = graph.nodes.map(n => n.id);
  const d = Object.fromEntries(ids.map(a => [a, Object.fromEntries(ids.map(b => [b, a === b ? 0 : Infinity]))]));
  for (const {a, b, w} of graph.edges) {
    d[a][b] = weighted ? w : 1;
    if (!graph.directed) d[b][a] = weighted ? w : 1;
  }
  for (const via of ids) for (const a of ids) for (const b of ids) d[a][b] = Math.min(d[a][b], d[a][via] + d[via][b]);
  return d;
}

test('User graphs at the editor limits support sparse IDs, arbitrary insertion order, directions and unreachable targets', () => {
  const graphs = [boundaryGraph(false, false, 20260929), boundaryGraph(true, false, 27),
    boundaryGraph(false, true, 91), boundaryGraph(true, true, 314),
    {directed: true, nodes: [{id: 7, x: 100, y: 65}, {id: 99, x: 600, y: 295}], edges: []}];
  assert.equal(graphs[0].nodes.length, 12);
  assert.equal(graphs[0].edges.length, 40);
  assert.equal(graphs[3].edges.length, 40);
  for (const graph of graphs) {
    validateGraph(graph);
    const untouched = JSON.stringify(graph), unweighted = distances(graph, false), weighted = distances(graph, true);
    for (const {id: start} of graph.nodes) {
      const reachable = graph.nodes.map(n => n.id).filter(id => Number.isFinite(unweighted[start][id])).sort((a, b) => a - b);
      for (const algorithm of ['bfs', 'dfs']) {
        const last = trace(graph, algorithm, start, start).at(-1);
        assert.deepEqual([...last.order].sort((a, b) => a - b), reachable);
        assert.equal(new Set(last.order).size, reachable.length);
        if (algorithm === 'bfs') {
          const levels = last.order.map(id => unweighted[start][id]);
          assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
        }
      }
      for (const {id: target} of graph.nodes) for (const algorithm of ['path', 'dijkstra']) {
        const last = trace(graph, algorithm, start, target).at(-1);
        const expected = (algorithm === 'path' ? unweighted : weighted)[start][target];
        assert.equal(last.dist[target], Number.isFinite(expected) ? expected : null);
        if (!Number.isFinite(expected)) {assert.deepEqual(last.path, []); continue;}
        assert.equal(last.path[0], start);
        assert.equal(last.path.at(-1), target);
        assert.equal(new Set(last.path).size, last.path.length);
        let cost = 0;
        for (let i = 1; i < last.path.length; i++) {
          const a = last.path[i - 1], b = last.path[i];
          const edge = graph.edges.find(e => e.a === a && e.b === b || !graph.directed && e.a === b && e.b === a);
          assert(edge, `Invalid directed transition ${a} → ${b}`);
          cost += algorithm === 'path' ? 1 : edge.w;
        }
        assert.equal(cost, expected);
      }
    }
    assert.equal(JSON.stringify(graph), untouched);
  }
});
