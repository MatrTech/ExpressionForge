"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const sandbox = vm.createContext({ encodeURIComponent });
vm.runInContext(fs.readFileSync(path.join(root, "src/ExpressionForge.Api/wwwroot/catalog-utils.js"), "utf8"), sandbox);
const { metadataUrl, makeDefinition, importDefinition } = sandbox.ExpressionForgeCatalogs;

const customer = {
  catalogId: "customers", catalogRevision: "sha256:customers", entities: [
    { id: "Customer", properties: [
      { id: "Id", dataType: "integer", operators: ["equals"] },
      { id: "FirstName", dataType: "string", operators: ["equals"] },
      { id: "Age", dataType: "integer", operators: ["greaterThan"] },
      { id: "IsActive", dataType: "boolean", operators: ["equals"] }
    ], relationships: [{ id: "Orders", targetEntity: "Order" }] },
    { id: "Order", properties: [{ id: "Total", dataType: "decimal", operators: ["greaterThan"] }], relationships: [] }
  ]
};

const projects = {
  catalogId: "projects", catalogRevision: "sha256:projects", entities: [
    { id: "Project", properties: [{ id: "Id", dataType: "integer", operators: ["equals"] }], relationships: [] }
  ]
};

test("catalog metadata URL always encodes the selected server-provided identifier", () => {
  assert.equal(metadataUrl("projects"), "/api/query/metadata?catalog=projects");
  assert.equal(metadataUrl("a&role=admin"), "/api/query/metadata?catalog=a%26role%3Dadmin");
});

test("Project catalog creates a typed AST tied to that catalog and revision", () => {
  const result = makeDefinition(projects);
  assert.equal(result.version, 1);
  assert.equal(result.catalogId, "projects");
  assert.equal(result.catalogRevision, "sha256:projects");
  assert.equal(result.entity, "Project");
  assert.equal(result.query.expressions[0].field, "Id");
  assert.equal(result.query.expressions[0].value, 1);
});

test("Customer catalog retains curated demo if all required metadata is visible", () => {
  const sample = { version: 1, entity: "Customer", query: { type: "group", operator: "and", expressions: [] } };
  const result = makeDefinition(customer, sample);
  assert.equal(result.catalogId, "customers");
  assert.equal(result.catalogRevision, "sha256:customers");
  assert.equal(result.entity, "Customer");
  assert.equal(result.query.expressions.length, 0);
});

test("Restricted Customer catalog does not seed hidden sample expressions", () => {
  const restricted = JSON.parse(JSON.stringify(customer));
  restricted.entities[0].properties = restricted.entities[0].properties.filter(p => p.id !== "Age");
  const sample = { version: 1, entity: "Customer", query: { type: "expression", field: "Age", operator: "equals", value: 21 } };
  const result = makeDefinition(restricted, sample);
  assert.equal(result.query.expressions[0].field, "Id");
  assert.equal(result.catalogId, "customers");
});

test("Imported query stays within its registered catalog while legacy JSON gains an ID", () => {
  const imported = { version: 1, entity: "Project", query: { type: "group", operator: "and", expressions: [] } };
  assert.equal(importDefinition(imported, projects).catalogId, "projects");
  assert.equal(imported.catalogId, undefined);
  assert.throws(() => importDefinition({ ...imported, catalogId: "customers" }, projects), /different catalog/);
  assert.throws(() => importDefinition({ ...imported, entity: "Order" }, projects), /does not expose/);
});

test("Manifest covers multiple independently mapped data domains", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "examples/catalog-registry.json"), "utf8"));
  assert.equal(manifest.defaultCatalog, "customers");
  assert.deepEqual(manifest.catalogs.map(c => c.source), ["demo", "json"]);
  assert.equal(manifest.catalogs[1].path, "project-catalog.json");
});

test("Editor registers selection, import and isolated draft switching", () => {
  const html = fs.readFileSync(path.join(root, "src/ExpressionForge.Api/wwwroot/index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "src/ExpressionForge.Api/wwwroot/app.js"), "utf8");
  assert.match(html, /id="catalog"/);
  assert.match(html, /catalog-utils\.js/);
  assert.match(app, /\/api\/query\/catalogs/);
  assert.match(app, /activateCatalog/);
  assert.match(app, /state\.drafts\.set/);
  assert.match(app, /ExpressionForgeCatalogs\.importDefinition/);
});
