'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const site = path.join(root, 'site');
const assets = path.join(site, 'blueprint-assets');
const source = path.join(root, 'src/ExpressionForge.Api/wwwroot');

test('published Blueprint is the real editor, not a visual-only reimplementation', () => {
  const files = ['app.js', 'catalog-utils.js', 'parameter-utils.js', 'graph-model.js', 'graph-layout.js',
    'numeric-tree.js', 'graph-edit.js', 'graph-history.js', 'graph-preview.js', 'onboarding.js', 'styles.css'];
  for (const file of files) {
    assert.equal(fs.readFileSync(path.join(assets, file), 'utf8'),
      fs.readFileSync(path.join(source, file), 'utf8'), 'showcase asset drift: ' + file);
  }
});

test('static Project/Task example uses authentic query fixture and scoped catalog', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-query.json'), 'utf8'));
  const shown = JSON.parse(fs.readFileSync(path.join(assets, 'project-query.json'), 'utf8'));
  assert.deepEqual(shown, fixture);
  const catalog = JSON.parse(fs.readFileSync(path.join(assets, 'project-metadata.json'), 'utf8'));
  const original = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-catalog.json'), 'utf8'));
  assert.deepEqual(catalog.entities, original.entities);
  assert.equal(catalog.catalogId, 'projects');
  assert.ok(catalog.operators.some(x => x.id === 'equals'));
  const graph = require('../../src/ExpressionForge.Api/wwwroot/graph-model.js');
  assert.deepEqual(graph.toDefinition(graph.project(shown.definition, catalog)), fixture.definition);
});

test('Pages navigation links to the live editor and backend-only actions are visibly disabled', () => {
  const home = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const demo = fs.readFileSync(path.join(site, 'blueprint.html'), 'utf8');
  assert.match(home, /href="blueprint\.html"/);
  for (const id of ['compile', 'preview', 'validate'])
    assert.match(demo, new RegExp('id="' + id + '"[^>]*disabled'));
  assert.match(demo, /No SQL execution/);
  assert.match(demo, /blueprint-assets\/app\.js/);
  assert.match(demo, /blueprint-demo\.js/);
  assert.match(demo, /blueprint-assets\/onboarding\.js/);
  assert.match(demo, /id="start-tour"/);
});

test('Pages and CI pipelines explicitly prepare shared Blueprint files before checking the demo', () => {
  for (const file of ['pages.yml', 'ci.yml']) {
    const text = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
    assert.match(text, /node scripts\/prepare-blueprint-demo\.cjs/);
  }
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /playwright@1\.56\.1/);
  assert.match(ci, /ExpressionForge\.Browser\.Tests/);
});
