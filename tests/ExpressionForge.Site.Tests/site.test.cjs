"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "site/app.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { buildDefinition, renderSql, normalizedTotal } = context.ExpressionForgeSiteDemo;

test("playground creates a portable v1 AST with named parameters", () => {
  const ast = buildDefinition("John", 100, "any");
  assert.equal(ast.version, 1);
  assert.equal(ast.entity, "Customer");
  assert.equal(ast.query.type, "group");
  assert.equal(ast.query.expressions[0].parameter, "firstName");
  assert.equal(ast.query.expressions[1].collection, "Orders");
  assert.equal(ast.query.expressions[1].expression.parameter, "minimumTotal");
  assert.equal(JSON.stringify(ast).includes('"value"'), false);
});

test("all three collection quantifiers produce distinct ASTs", () => {
  for (const quantifier of ["any", "all", "none"]) {
    assert.equal(buildDefinition("John", 100, quantifier).query.expressions[1].quantifier, quantifier);
  }
});

test("illustrative SQL is parameterized and never embeds user values", () => {
  for (const quantifier of ["any", "all", "none"]) {
    const sql = renderSql(quantifier);
    assert.match(sql, /@firstName/);
    assert.match(sql, /@minimumTotal/);
    assert.match(sql, /NOT live compiler output/);
    assert.doesNotMatch(sql, /John/);
  }
  assert.match(renderSql("any"), /AND EXISTS/);
  assert.match(renderSql("none"), /AND NOT EXISTS/);
  assert.match(renderSql("all"), /CASE WHEN/);
});

test("numeric input is clamped and rejects non-finite numbers", () => {
  assert.equal(normalizedTotal("50"), 50);
  assert.equal(normalizedTotal("-20"), 0);
  assert.equal(normalizedTotal("9999999"), 1000000);
  assert.equal(normalizedTotal("invalid"), 100);
});

test("all site assets use project-relative paths compatible with GitHub Pages", () => {
  const html = fs.readFileSync(path.join(root, "site/index.html"), "utf8");
  for (const asset of ["styles.css", "app.js", "favicon.svg"]) {
    assert.ok(html.includes('"' + asset + '"'));
    assert.ok(fs.existsSync(path.join(root, "site", asset)));
    assert.equal(html.includes('"/' + asset + '"'), false);
  }
});
