"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "site/example-gallery.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const gallery = context.ExpressionForgeGallery;
const examples = JSON.parse(fs.readFileSync(path.join(root, "site/examples.json"), "utf8"));

test("gallery validates all five portable AST fixtures", () => {
  assert.equal(gallery.validateExamples(examples).length, 5);
  for (const example of examples) {
    const stats = gallery.analyze(example);
    assert.ok(stats.nodes >= 6);
    assert.ok(stats.depth >= 3);
    assert.ok(stats.collections >= 1);
    assert.equal(stats.references.size, Object.keys(example.parameters).length);
  }
});

test("advanced segmentation demonstrates nested OR, NOT and collection scopes", () => {
  const example = examples.find(e => e.id === "segmentation");
  const nodes = [];
  gallery.visit(example.definition.query, (node, depth, scope) => nodes.push([node.type, depth, scope]));
  assert.ok(nodes.some(([type, depth]) => type === "group" && depth > 2));
  assert.ok(nodes.some(([type]) => type === "not"));
  assert.ok(nodes.some(([type, , scope]) => type === "expression" && scope === "Order"));
});

test("premium scenario shares one binding across two collection predicates", () => {
  const example = examples.find(e => e.id === "premium-only");
  const references = gallery.analyze(example).references.get("minimumTotal");
  assert.equal(references.length, 2);
  assert.equal(references[0], "Order.Total");
  assert.equal(references[1], "Order.Total");
});

test("changing runtime bindings does not mutate a saved definition", () => {
  const example = examples.find(e => e.id === "loyal-spenders");
  const original = JSON.stringify(example.definition);
  const bindings = gallery.getBindings(example, { minimumAge: 30, minimumTotal: 250 });
  assert.equal(bindings.minimumAge, 30);
  assert.equal(bindings.minimumTotal, 250);
  assert.equal(JSON.stringify(example.definition), original);
  assert.equal(JSON.stringify(example.definition).includes("minimumTotal\":250"), false);
});

test("invalid bindings and undeclared references are rejected", () => {
  const example = examples.find(e => e.id === "loyal-spenders");
  assert.throws(() => gallery.getBindings(example, { minimumAge: 21.5 }), /32-bit integer/);
  assert.throws(() => gallery.getBindings(example, { minimumTotal: Infinity }), /finite decimal/);
  assert.throws(() => gallery.getBindings(example, { desiredStatus: "x".repeat(1025) }), /1024/);
  const altered = structuredClone(example);
  altered.definition.query.expressions[1].parameter = "undeclared";
  assert.throws(() => gallery.validateExamples([altered]), /do not match AST references/);
});

test("node identity duplicates are rejected", () => {
  const example = structuredClone(examples[0]);
  example.definition.query.expressions[0].id = example.definition.query.id;
  assert.throws(() => gallery.validateExamples([example]), /duplicate expression node ID/);
});

test("all gallery assets are included by the GitHub Pages document", () => {
  const html = fs.readFileSync(path.join(root, "site/index.html"), "utf8");
  assert.match(html, /id="gallery-presets"/);
  assert.match(html, /id="gallery-tree"/);
  assert.match(html, /src="example-gallery.js"/);
  assert.ok(fs.existsSync(path.join(root, "site/examples.json")));
});
