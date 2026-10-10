'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { project, toDefinition, canConnect } = require('../../src/ExpressionForge.Api/wwwroot/graph-model.js');

const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-catalog.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-query.json'), 'utf8')).definition;

test('projects the real Project/Task fixture without changing its JSON contract', () => {
  const original = structuredClone(fixture);
  const projection = project(fixture, catalog);
  assert.deepEqual(toDefinition(projection), fixture);
  assert.deepEqual(fixture, original);
  assert.equal(projection.graphs.length, 2);
  const rootGraph = projection.graphs.find(graph => graph.key === 'root');
  const tasks = projection.graphs.find(graph => graph.kind === 'collection');
  assert.equal(rootGraph.entityId, 'Project');
  assert.equal(tasks.entityId, 'Task');
  assert.equal(tasks.parentGraphKey, 'root');
  assert.equal(tasks.ownerNodeKey, 'id:project-tasks');
  assert.equal(rootGraph.nodes.find(node => node.key === 'id:project-budget').data.parameter, 'minimumBudget');
  assert.equal(tasks.nodes.find(node => node.key === 'id:task-hours').data.parameter, 'minimumHours');
});

test('logical groups open as optional scoped subgraphs and preserve order', () => {
  const projection = project(fixture, catalog, { subgraphNodeIds: ['project-root', 'task-rules'] });
  assert.equal(projection.graphs.length, 4);
  const projectGroup = projection.graphs.find(graph => graph.ownerNodeKey === 'id:project-root');
  const taskGroup = projection.graphs.find(graph => graph.ownerNodeKey === 'id:task-rules');
  assert.equal(projectGroup.kind, 'logicalGroup');
  assert.equal(projectGroup.entityId, 'Project');
  assert.equal(taskGroup.entityId, 'Task');
  assert.deepEqual(projectGroup.edges.map(edge => edge.inputIndex), [0, 1, 2]);
  assert.deepEqual(toDefinition(projection), fixture);
});

test('expressions without IDs, NOT and nested collections round-trip without inserting IDs', () => {
  const original = {
    version: 1, entity: 'Project', query: {
      type: 'not', expression: {
        type: 'collectionExpression', collection: 'Tasks', quantifier: 'none',
        expression: { type: 'group', operator: 'or', expressions: [
          { type: 'expression', field: 'State', operator: 'equals', value: 'Open' },
          { type: 'expression', field: 'Hours', operator: 'greaterThan', value: 0 }
        ] }
      }
    }
  };
  const projection = project(original, catalog, { subgraphNodeIds: ['$.query.expression.expression'] });
  assert.deepEqual(toDefinition(projection), original);
  assert.ok(projection.graphs[0].nodes.some(node => node.key.startsWith('path:')));
});

test('duplicate AST IDs do not alias nodes or silently change the query', () => {
  const definition = { version: 1, entity: 'Project', query: {
    type: 'group', id: 'duplicate', operator: 'and', expressions: [
      { type: 'expression', id: 'duplicate', field: 'Archived', operator: 'equals', value: false }
    ]
  } };
  assert.deepEqual(toDefinition(project(definition, catalog)), definition);
});

test('socket validation prevents reused nodes, occupied inputs and invalid ports', () => {
  const projection = project(fixture, catalog);
  const graph = projection.graphs[0];
  assert.match(canConnect(projection, graph.key, 'id:project-active', 'id:project-root', 3).reason, /multiple parents/);
  assert.match(canConnect(projection, graph.key, 'id:project-active', 'id:project-root', 0).reason, /multiple parents/);
  graph.edges = graph.edges.filter(edge => edge.from !== 'id:project-active');
  assert.equal(canConnect(projection, graph.key, 'id:project-active', 'id:project-root', 3).valid, true);
  assert.match(canConnect(projection, graph.key, 'id:project-active', graph.rootNodeKey, 2).reason, /Invalid input socket/);
  assert.match(canConnect(projection, graph.key, 'id:project-active', 'id:project-active', 0).reason, /required|itself/);
});

test('socket validation rejects cross-entity connections even when the predicate kind matches', () => {
  const projection = project(fixture, catalog);
  const rootGraph = projection.graphs[0];
  const childGraph = projection.graphs.find(graph => graph.kind === 'collection');
  const foreign = structuredClone(childGraph.nodes.find(node => node.key === 'id:task-state'));
  foreign.key = 'foreign-task';
  rootGraph.nodes.push(foreign);
  assert.match(canConnect(projection, 'root', 'foreign-task', 'id:project-root', 4).reason, /scopes do not match/);
});

test('edits to graph node payloads round-trip into semantic AST changes', () => {
  const projection = project(fixture, catalog);
  const logicalNode = projection.graphs[0].nodes.find(node => node.key === 'id:project-root');
  logicalNode.data.operator = 'or';
  const changed = toDefinition(projection);
  assert.equal(changed.query.operator, 'or');
  assert.deepEqual(changed.query.expressions, fixture.query.expressions);
  assert.equal(fixture.query.operator, 'and');
});

test('export rejects disconnected expressions instead of dropping them', () => {
  const projection = project(fixture, catalog);
  projection.graphs[0].edges = projection.graphs[0].edges.filter(edge => edge.from !== 'id:project-budget');
  assert.throws(() => toDefinition(projection), /Unconnected nodes/);
});

test('unknown roots and malformed group structures are rejected explicitly', () => {
  assert.throws(() => project({ ...fixture, entity: 'NotARealEntity' }, catalog), /not available/);
  assert.throws(() => project({ ...fixture, query: { type: 'group', operator: 'and' } }, catalog), /expressions array/);
});

test('graph projection enforces the same structural limits as the backend', () => {
  let deep = { type: 'expression', field: 'Archived', operator: 'equals', value: false };
  for (let index = 0; index < 16; index++) deep = { type: 'not', expression: deep };
  assert.throws(() => project({ version: 1, entity: 'Project', query: deep }, catalog), /16 levels/);

  const query = { type: 'group', operator: 'and', expressions: Array.from({ length: 256 },
    () => ({ type: 'expression', field: 'Archived', operator: 'equals', value: false })) };
  assert.throws(() => project({ version: 1, entity: 'Project', query }, catalog), /256 nodes/);
});

test('graph export rejects forged cross-scope and duplicated connections', () => {
  const projection = project(fixture, catalog);
  const rootGraph = projection.graphs.find(graph => graph.kind === 'root');
  const budgetLink = rootGraph.edges.find(edge => edge.from === 'id:project-budget');
  const duplicate = structuredClone(projection);
  duplicate.graphs[0].edges.push({ ...budgetLink, inputIndex: 7 });
  assert.throws(() => toDefinition(duplicate), /share AST nodes/);

  const mismatched = structuredClone(projection);
  mismatched.graphs[0].nodes.find(node => node.key === 'id:project-budget').output.entityId = 'Task';
  assert.throws(() => toDefinition(mismatched), /incompatible predicate/);
});
