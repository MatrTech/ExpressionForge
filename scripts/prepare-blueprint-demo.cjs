'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src/ExpressionForge.Api/wwwroot');
const target = path.join(root, 'site/blueprint-assets');
fs.mkdirSync(target, { recursive: true });

const sharedAssets = [
  'app.js', 'catalog-utils.js', 'parameter-utils.js', 'graph-model.js',
  'graph-layout.js', 'graph-edit.js', 'graph-history.js', 'graph-preview.js', 'onboarding.js', 'styles.css'
];
for (const filename of sharedAssets) fs.copyFileSync(path.join(source, filename), path.join(target, filename));

const rawCatalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/project-catalog.json'), 'utf8'));
const allOperators = [...new Set(rawCatalog.entities.flatMap(e => e.properties.flatMap(p => p.operators)))];
const catalog = {
  catalogId: 'projects',
  catalogVersion: 'static-showcase',
  catalogRevision: 'static-showcase',
  entities: rawCatalog.entities,
  operators: allOperators.map(id => ({ id, displayName: id }))
};
fs.writeFileSync(path.join(target, 'project-metadata.json'), JSON.stringify(catalog, null, 2) + '\n');
fs.copyFileSync(path.join(root, 'examples/project-query.json'), path.join(target, 'project-query.json'));
console.log('Prepared Blueprint browser showcase from canonical editor files (' + sharedAssets.length + ' shared assets).');
