"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("custom catalog showcases a typed Project to Task relationship", () => {
  const catalog = JSON.parse(read("examples/project-catalog.json"));
  const project = catalog.entities.find(entity => entity.id === "Project");
  const task = catalog.entities.find(entity => entity.id === "Task");
  assert.ok(project);
  assert.ok(task);
  assert.equal(project.properties.find(field => field.id === "Budget").dataType, "decimal");
  const relation = project.relationships.find(item => item.id === "Tasks");
  assert.equal(relation.targetEntity, task.id);
  assert.equal(relation.parentKey, "Id");
  assert.equal(relation.childForeignKey, "ProjectId");
});

test("custom catalog example includes typed runtime bindings and nested task conditions", () => {
  const { definition, parameters } = JSON.parse(read("examples/project-query.json"));
  assert.equal(definition.entity, "Project");
  assert.equal(definition.query.type, "group");
  const nested = definition.query.expressions.find(item => item.type === "collectionExpression");
  assert.equal(nested.collection, "Tasks");
  assert.equal(nested.quantifier, "any");
  assert.equal(nested.expression.expressions.length, 2);
  assert.equal(parameters.minimumBudget, 10000);
  assert.equal(parameters.minimumHours, 12);
});

test("public site links to both versioned custom catalog examples", () => {
  const html = read("site/index.html");
  assert.match(html, /id="metadata"/);
  assert.match(html, /examples\/project-catalog\.json/);
  assert.match(html, /examples\/project-query\.json/);
  assert.match(html, /v0\.3\.0 IN DEVELOPMENT/);
});

test("catalog revision and scope contracts are discoverable from the project website", () => {
  const html = read("site/index.html");
  const docs = read("docs/catalog-revisions-and-scopes.md");
  assert.match(html, /catalog-revisions-and-scopes\.md/);
  assert.match(html, /v0\.2\.0 RELEASED/);
  assert.match(html, /api\/query\/metadata\/scopes/);
  assert.match(docs, /catalogRevisionMismatch/);
  assert.match(docs, /Project \/ Task/);
});
