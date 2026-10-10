'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const layout = require('../../src/ExpressionForge.Api/wwwroot/graph-layout.js');
const { project, toDefinition } = require('../../src/ExpressionForge.Api/wwwroot/graph-model.js');

const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-catalog.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-query.json'), 'utf8')).definition;
const projection = project(fixture, catalog, { subgraphNodeIds: ['project-root', 'task-rules'] });
const rootGraph = projection.graphs.find(graph => graph.key === 'root');
const taskGraph = projection.graphs.find(graph => graph.kind === 'collection');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

test('automatic positioning lays out all nodes and respects predicate direction', () => {
  const positions = layout.defaults(rootGraph);
  assert.equal(Object.keys(positions).length, rootGraph.nodes.length);
  for (const edge of rootGraph.edges) {
    assert.ok(positions[edge.from].x < positions[edge.to].x);
    assert.ok(Number.isFinite(positions[edge.from].y));
  }
  assert.deepEqual(layout.defaults(rootGraph), positions);
});

test('independent subgraphs keep independent coordinate systems and viewports', () => {
  const state = layout.empty();
  const rootLayout = layout.ensure(state, rootGraph, 850, 540);
  const childLayout = layout.ensure(state, taskGraph, 420, 320);
  assert.notStrictEqual(rootLayout.positions, childLayout.positions);
  assert.notStrictEqual(rootLayout.viewport, childLayout.viewport);
  const before = structuredClone(rootLayout.positions);
  layout.move(childLayout.positions, taskGraph.rootNodeKey, 120, 60, 1);
  assert.deepEqual(rootLayout.positions, before);
  assert.deepEqual(toDefinition(projection), fixture);
});

test('pan and zoom are editor-only and cursor-centered even after repeated changes', () => {
  const state = layout.empty();
  const current = layout.ensure(state, rootGraph, 1000, 600);
  const before = structuredClone(fixture);
  const original = { ...current.viewport };
  const center = { x: 315, y: 190 };
  const pointX = (center.x - original.x) / original.zoom;
  const pointY = (center.y - original.y) / original.zoom;
  const enlarged = layout.zoomAt(original, center.x, center.y, 1.3);
  assert.ok(enlarged.zoom > original.zoom);
  assert.ok(Math.abs(enlarged.x + pointX * enlarged.zoom - center.x) < 0.000001);
  assert.ok(Math.abs(enlarged.y + pointY * enlarged.zoom - center.y) < 0.000001);
  const reverted = layout.zoomAt(enlarged, center.x, center.y, 1 / 1.3);
  assert.ok(Math.abs(reverted.x - original.x) < 0.000001);
  assert.ok(Math.abs(reverted.y - original.y) < 0.000001);
  assert.deepEqual(fixture, before);
});

test('drag offsets are zoom-correct and fit includes moved nodes', () => {
  const state = layout.empty();
  const current = layout.ensure(state, rootGraph, 1000, 600);
  const nodeKey = rootGraph.rootNodeKey;
  const before = { ...current.positions[nodeKey] };
  layout.move(current.positions, nodeKey, 100, -40, 2);
  assert.deepEqual(current.positions[nodeKey], { x: before.x + 50, y: before.y - 20 });
  const fitted = layout.fit(current.positions, 600, 400);
  assert.ok(fitted.zoom >= layout.MIN_ZOOM && fitted.zoom <= 1.1);
  assert.ok(Number.isFinite(fitted.x) && Number.isFinite(fitted.y));
});

test('new nodes get positions and removed nodes cannot linger in layout', () => {
  const state = layout.empty();
  const current = layout.ensure(state, rootGraph, 800, 500);
  current.positions.unrelated = { x: 999, y: 999 };
  current.positions[rootGraph.rootNodeKey] = { x: -300, y: 42 };
  const next = layout.ensure(state, rootGraph, 800, 500);
  assert.equal(next.positions.unrelated, undefined);
  assert.equal(next.positions[rootGraph.rootNodeKey].x, -300);
});

test('positions persist in browser storage per catalog/entity without touching AST', () => {
  const storage = memoryStorage();
  const key = layout.storageKey('projects', 'Project');
  const second = layout.storageKey('customers', 'Customer');
  assert.notEqual(key, second);
  const state = layout.empty();
  const current = layout.ensure(state, rootGraph, 700, 400);
  current.positions[rootGraph.rootNodeKey] = { x: 150, y: -20 };
  assert.equal(layout.write(storage, key, state), true);
  assert.equal(layout.read(storage, second).version, 1);
  assert.equal(Object.keys(layout.read(storage, second).graphs).length, 0);
  const recovered = layout.read(storage, key);
  assert.deepEqual(recovered.graphs.root.positions[rootGraph.rootNodeKey], { x: 150, y: -20 });
  assert.deepEqual(toDefinition(projection), fixture);
});

test('corrupt and hostile local state cannot crash layout restoration', () => {
  const storage = memoryStorage();
  storage.setItem('corrupt', '{oops');
  assert.deepEqual(layout.read(storage, 'corrupt'), layout.empty());
  const dirty = { version: 1, graphs: { root: {
    positions: { bad: { x: Infinity, y: 0 }, retained: { x: 12, y: 25 } },
    viewport: { x: 0, y: 0, zoom: -10 }
  } } };
  storage.setItem('dirty', JSON.stringify(dirty));
  const state = layout.read(storage, 'dirty');
  assert.equal(state.graphs.root.positions.bad, undefined);
  assert.deepEqual(state.graphs.root.positions.retained, { x: 12, y: 25 });
  assert.equal(state.graphs.root.viewport, null);
  assert.equal(layout.write({ setItem: () => { throw Error('Denied'); } }, 'any', state), false);
  assert.deepEqual(layout.read({ getItem: () => { throw Error('Denied'); } }, 'any'), layout.empty());
});

test('canvas modules are referenced in editor and syntax is covered by CI', () => {
  const html = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/wwwroot/index.html'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/wwwroot/app.js'), 'utf8');
  const preview = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/wwwroot/graph-preview.js'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(html, /graph-layout\.js/);
  assert.match(html, /Blueprint canvas/);
  assert.match(editor, /useCanvasLayout/);
  assert.match(preview, /pointermove/);
  assert.match(preview, /setPointerCapture/);
  assert.match(preview, /blueprint-wire/);
  assert.match(workflow, /node --check src\/ExpressionForge.Api\/wwwroot\/graph-layout\.js/);
});
