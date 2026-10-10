'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-catalog.json'), 'utf8'));
const sample = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-query.json'), 'utf8')).definition;
const edit = require('../../src/ExpressionForge.Api/wwwroot/graph-edit.js');
const graph = require('../../src/ExpressionForge.Api/wwwroot/graph-model.js');
const preview = require('../../src/ExpressionForge.Api/wwwroot/graph-preview.js');

test('metadata palette only offers field comparisons in scopes with compatible fields', () => {
  assert.equal(edit.options(catalog, 'Project').some(item => item.kind === 'fieldComparison'), false);
  assert.equal(edit.options(catalog, 'Task').some(item => item.kind === 'fieldComparison'), true);
  assert.equal(edit.options(catalog, 'Unknown').some(item => item.kind === 'fieldComparison'), false);
});

test('Task field comparison is created from real metadata with compatible operator', () => {
  const predicate = edit.makePredicate(catalog, 'Task', { kind: 'fieldComparison' });
  assert.deepEqual(predicate, {
    type: 'fieldComparison', leftField: 'Id', rightField: 'ProjectId', operator: 'equals'
  });
  assert.throws(() => edit.makePredicate(catalog, 'Project', { kind: 'fieldComparison' }), /compatible field pair/);
});

test('appending a field comparison in collection scope round trips through Blueprint', () => {
  const before = structuredClone(sample);
  const path = '$.query.expressions[2].expression';
  const result = edit.append(sample, catalog, path, { kind: 'fieldComparison' });
  const children = result.query.expressions[2].expression.expressions;
  assert.equal(children.at(-1).type, 'fieldComparison');
  assert.equal(children.at(-1).leftField, 'Id');
  const projection = graph.project(result, catalog);
  const nested = projection.graphs.find(x => x.kind === 'collection');
  assert.ok(nested.nodes.some(x => x.kind === 'fieldComparison'));
  assert.deepEqual(graph.toDefinition(projection), result);
  assert.deepEqual(sample, before);
});

test('field editor changes only compatible fields and metadata-approved operators', () => {
  const added = edit.append(sample, catalog, '$.query.expressions[2].expression', { kind: 'fieldComparison' });
  const path = '$.query.expressions[2].expression.expressions[2]';
  const changed = edit.change(added, catalog, path, { kind: 'operator', value: 'greaterThan' });
  assert.equal(changed.query.expressions[2].expression.expressions[2].operator, 'greaterThan');
  assert.throws(() => edit.change(changed, catalog, path, { kind: 'rightField', value: 'State' }), /incompatible/);
  assert.throws(() => edit.change(changed, catalog, path, { kind: 'rightField', value: 'Archived' }), /scope/);
  assert.throws(() => edit.change(changed, catalog, path, { kind: 'operator', value: 'contains' }), /unavailable/);
  assert.equal(added.query.expressions[2].expression.expressions[2].operator, 'equals');
});

test('Blueprint description and guided editor support comparison between two named fields', () => {
  const expression = { kind: 'fieldComparison', data: { leftField: 'Id', operator: 'equals', rightField: 'ProjectId' } };
  assert.equal(preview.description(expression), 'Id equals ProjectId');
  const guided = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/wwwroot/app.js'), 'utf8');
  assert.match(guided, /expression.type === 'fieldComparison'/);
  const program = fs.readFileSync(path.join(root, 'src/ExpressionForge.Api/Program.cs'), 'utf8');
  assert.match(program, /"fieldComparison"/);
});
