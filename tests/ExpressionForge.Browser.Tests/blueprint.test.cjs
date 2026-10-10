'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const site = 'http://127.0.0.1:5085';
const api = 'http://127.0.0.1:5054';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function openShowcase(t, viewport = { width: 1440, height: 900 }, keepTutorial = false) {
  const page = await browser.newPage({ viewport });
  t.after(() => page.close());
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const response = await page.goto(site + '/blueprint.html', { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  await page.locator('#blueprint-mode[aria-pressed="true"]').waitFor({ timeout: 15000 });
  await page.locator('.blueprint-card').first().waitFor();
  await page.locator('.ef-tour-panel').waitFor();
  if (!keepTutorial) await page.locator('.ef-tour-dismiss').click();
  assert.deepEqual(failures, []);
  return page;
}

async function definition(page) {
  return JSON.parse(await page.locator('#json').inputValue());
}

test('GitHub Pages demo boots the actual Project/Task editor and labels unavailable backend capabilities', async t => {
  const page = await openShowcase(t);
  const ast = await definition(page);
  assert.equal(ast.entity, 'Project');
  assert.equal(ast.query.id, 'project-root');
  assert.equal(ast.query.expressions[2].collection, 'Tasks');
  assert.equal(await page.locator('#compile').isDisabled(), true);
  assert.equal(await page.locator('#preview').isDisabled(), true);
  assert.match(await page.locator('.blueprint-scope').textContent(), /Predicate<Project>/);
  assert.ok(await page.locator('.blueprint-wire').count() >= 3);
});

test('guided Add condition works, and Undo/Redo restore canonical JSON', async t => {
  const page = await openShowcase(t);
  const original = await definition(page);
  await page.locator('#guided-mode').click();
  const count = original.query.expressions.length;
  await page.locator('.guided-condition-picker').last().selectOption({ index: 1 });
  await page.locator('#graph .actions').last().getByRole('button', { name: /Add condition/ }).click();
  assert.equal((await definition(page)).query.expressions.length, count + 1);
  await page.locator('#undo-edit').click();
  assert.deepEqual((await definition(page)).query, original.query);
  await page.locator('#redo-edit').click();
  assert.equal((await definition(page)).query.expressions.length, count + 1);
});

test('Blueprint supports mouse dragging, separate Task subgraphs and stable AST payload', async t => {
  const page = await openShowcase(t);
  const original = await definition(page);
  const card = page.locator('.blueprint-card').filter({ hasText: 'Budget' }).first();
  const before = await card.evaluate(element => element.style.transform);
  const rect = await card.boundingBox();
  assert.ok(rect);
  await page.mouse.move(rect.x + 75, rect.y + 45);
  await page.mouse.down();
  await page.mouse.move(rect.x + 160, rect.y + 92, { steps: 6 });
  await page.mouse.up();
  assert.notEqual(await card.evaluate(element => element.style.transform), before);
  assert.deepEqual(await definition(page), original);
  await page.getByRole('button', { name: /Open Tasks\.ANY subgraph/i }).click();
  assert.match(await page.locator('.blueprint-scope').textContent(), /Predicate<Task>/);
  assert.ok(await page.locator('.blueprint-card').filter({ hasText: /Hours/ }).count() >= 1);
  await page.getByRole('navigation', { name: 'Subgraph navigation' }).getByRole('button', { name: 'Project' }).click();
  assert.match(await page.locator('.blueprint-scope').textContent(), /Predicate<Project>/);
});

test('dragging a predicate output to a compatible group input changes AST order and is undoable', async t => {
  const page = await openShowcase(t);
  const original = await definition(page);
  const source = page.locator('.blueprint-card').filter({ hasText: 'Budget' })
    .locator('.blueprint-socket-output').first();
  const target = page.locator('.blueprint-group').locator('.blueprint-socket-input').first();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  assert.ok(from && to, 'Expected visible typed sockets');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
  await page.mouse.up();
  const changed = await definition(page);
  assert.deepEqual(changed.query.expressions.map(x => x.id),
    ['project-active', 'project-tasks', 'project-budget']);
  await page.locator('#undo-edit').click();
  assert.deepEqual((await definition(page)).query, original.query);
});

test('inserting on a wire preserves the original subtree and supports undo', async t => {
  const page = await openShowcase(t);
  const original = await definition(page);
  await page.getByRole('button', { name: /Insert on connection after Budget/ }).click();
  await page.getByRole('combobox', { name: /Field to insert on connection/ }).selectOption('Archived');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  const changed = await definition(page);
  assert.equal(changed.query.expressions[1].type, 'group');
  assert.equal(changed.query.expressions[1].expressions[0].id, 'project-budget');
  await page.locator('#undo-edit').click();
  assert.deepEqual((await definition(page)).query, original.query);
});


test('Blueprint adds and edits scoped field-to-field comparisons without changing the parent entity', async t => {
  const page = await openShowcase(t);
  const original = await definition(page);
  await page.getByRole('button', { name: /Open Tasks\.ANY subgraph/i }).click();
  assert.match(await page.locator('.blueprint-scope').textContent(), /Predicate<Task>/);
  await page.locator('.blueprint-palette-select').selectOption({ label: 'Compare two fields' });
  await page.locator('.blueprint-palette').getByRole('button', { name: /Add condition/ }).click();
  let query = await definition(page);
  const expressions = query.query.expressions[2].expression.expressions;
  const added = expressions.at(-1);
  assert.equal(added.type, 'fieldComparison');
  assert.equal(added.leftField, 'Id');
  assert.equal(added.rightField, 'ProjectId');
  assert.equal(query.entity, 'Project');

  const card = page.locator('.blueprint-card').filter({ hasText: 'Id equals ProjectId' }).first();
  await card.getByRole('button', { name: /Edit Id equals ProjectId/ }).click();
  await page.getByRole('region', { name: 'Edit selected predicate' }).getByText('Operator').waitFor();
  await page.locator('.blueprint-inline-inspector').getByRole('combobox').last().selectOption('greaterThan');
  query = await definition(page);
  assert.equal(query.query.expressions[2].expression.expressions.at(-1).operator, 'greaterThan');
  await page.locator('#undo-edit').click();
  await page.locator('#undo-edit').click();
  assert.deepEqual((await definition(page)).query, original.query);
});

test('Blueprint creates an arithmetic predicate and edits its calculation without changing other conditions', async t => {
  const page = await openShowcase(t);
  const original = await definition(page);
  await page.locator('.blueprint-palette-select').selectOption({ label: 'Calculate with fields' });
  await page.locator('.blueprint-palette').getByRole('button', { name: /Add condition/ }).click();
  let query = await definition(page);
  const added = query.query.expressions.at(-1);
  assert.equal(added.type, 'arithmeticComparison');
  assert.equal(added.left.type, 'numericBinary');
  const card = page.locator('.blueprint-card').filter({ hasText: /subtract/ }).last();
  await card.locator('.blueprint-expand').click();
  await page.locator('.blueprint-inline-inspector').getByRole('combobox').filter({ has: page.locator('option[value="multiply"]') })
    .selectOption('multiply');
  query = await definition(page);
  assert.equal(query.query.expressions.at(-1).left.operator, 'multiply');
  await page.locator('#undo-edit').click();
  await page.locator('#undo-edit').click();
  assert.deepEqual((await definition(page)).query, original.query);
});

test('mobile viewport and keyboard node move remain operable', async t => {
  const page = await openShowcase(t, { width: 390, height: 844 });
  const before = await definition(page);
  const card = page.locator('.blueprint-card').filter({ hasText: /Archived/ }).first();
  await card.focus();
  const transform = await card.evaluate(e => e.style.transform);
  await page.keyboard.press('Shift+ArrowRight');
  assert.notEqual(await card.evaluate(e => e.style.transform), transform);
  assert.deepEqual(await definition(page), before);
});

test('.NET API editor boots with registered catalogs and really compiles a SQL query', async t => {
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  t.after(() => page.close());
  const response = await page.goto(api, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.getElementById('connection').textContent.startsWith('Catalog '),
    { timeout: 15000 });
  await page.locator('.ef-tour-panel').waitFor();
  await page.locator('.ef-tour-dismiss').click();
  await page.locator('#compile').click();
  await page.waitForFunction(() => document.getElementById('output').textContent.includes('SELECT'));
  assert.match(await page.locator('#output').textContent(), /FROM/);
});


test('first visit offers a gentle tour and next/back guide users without editing the AST', async t => {
  const page = await openShowcase(t, { width: 1440, height: 900 }, true);
  const before = await definition(page);
  const dialog = page.getByRole('dialog', { name: 'Welcome to ExpressionForge' });
  assert.ok(await dialog.isVisible());
  assert.equal(await page.locator('.ef-tour-panel').getAttribute('data-step'), '0');
  await page.getByRole('button', { name: /Start tour/ }).last().click();
  assert.equal(await page.locator('.ef-tour-panel').getAttribute('data-step'), '1');
  assert.equal(await page.locator('#guided-mode').getAttribute('aria-pressed'), 'true');
  await page.locator('.ef-tour-next').click();
  assert.equal(await page.locator('#blueprint-mode').getAttribute('aria-pressed'), 'true');
  await page.locator('.ef-tour-back').click();
  assert.equal(await page.locator('#guided-mode').getAttribute('aria-pressed'), 'true');
  await page.locator('.ef-tour-next').click();
  for (let step = 3; step <= 5; step++) {
    await page.locator('.ef-tour-next').click();
    assert.equal(await page.locator('.ef-tour-panel').getAttribute('data-step'), String(step));
  }
  await page.locator('.ef-tour-next').click();
  assert.equal(await page.locator('.ef-tour-panel').count(), 0);
  assert.deepEqual(await definition(page), before);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#blueprint-mode[aria-pressed="true"]').waitFor();
  await page.locator('.blueprint-card').first().waitFor();
  assert.equal(await page.locator('.ef-tour-panel').count(), 0);
  await page.locator('#start-tour').click();
  assert.equal(await page.locator('.ef-tour-panel').getAttribute('data-step'), '0');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.ef-tour-panel').count(), 0);
});

test('skip persists and tutorial can be reopened from Help on mobile', async t => {
  const page = await openShowcase(t, { width: 390, height: 844 }, true);
  await page.locator('.ef-tour-dismiss').click();
  assert.equal(await page.locator('.ef-tour-panel').count(), 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.blueprint-card').first().waitFor();
  assert.equal(await page.locator('.ef-tour-panel').count(), 0);
  await page.getByRole('button', { name: 'Start ExpressionForge tutorial' }).click();
  await page.locator('.ef-tour-next').click();
  assert.equal(await page.locator('.ef-tour-panel').getAttribute('data-step'), '1');
  const bounds = await page.locator('.ef-tour-panel').boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.ok(bounds.y + bounds.height <= 844);
  await page.locator('.ef-tour-dismiss').click();
});
