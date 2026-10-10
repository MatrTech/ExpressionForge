'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const site = 'http://127.0.0.1:5085';
const api = 'http://127.0.0.1:5054';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function openShowcase(t, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  t.after(() => page.close());
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const response = await page.goto(site + '/blueprint.html', { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  await page.locator('#blueprint-mode[aria-pressed="true"]').waitFor({ timeout: 15000 });
  await page.locator('.blueprint-card').first().waitFor();
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
  await page.locator('#compile').click();
  await page.waitForFunction(() => document.getElementById('output').textContent.includes('SELECT'));
  assert.match(await page.locator('#output').textContent(), /FROM/);
});
