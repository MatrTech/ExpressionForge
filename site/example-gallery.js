"use strict";
(function () {
  const supportedTypes = new Set(["string", "integer", "decimal", "boolean"]);
  const validId = /^[A-Za-z0-9_-]{1,64}$/;

  function visit(node, callback, depth = 1, scope = "Customer") {
    callback(node, depth, scope);
    if (node.type === "group") {
      for (const child of node.expressions) visit(child, callback, depth + 1, scope);
    } else if (node.type === "not") {
      visit(node.expression, callback, depth + 1, scope);
    } else if (node.type === "collectionExpression") {
      visit(node.expression, callback, depth + 1, "Order");
    }
  }

  function analyze(example) {
    const references = new Map();
    const ids = new Set();
    let nodes = 0, depth = 0, collections = 0;
    visit(example.definition.query, (node, level, scope) => {
      nodes++;
      depth = Math.max(depth, level);
      if (!validId.test(node.id) || ids.has(node.id)) throw new Error("Invalid or duplicate expression node ID.");
      ids.add(node.id);
      if (node.type === "collectionExpression") collections++;
      if (node.type === "expression" && node.parameter) {
        const paths = references.get(node.parameter) ?? [];
        paths.push(scope + "." + node.field);
        references.set(node.parameter, paths);
      }
    });
    return { nodes, depth, collections, references };
  }

  function getBindings(example, overrides = {}) {
    const values = {};
    for (const [name, spec] of Object.entries(example.parameters)) {
      const value = Object.hasOwn(overrides, name) ? overrides[name] : spec.value;
      if (spec.type === "integer") {
        if (typeof value !== "number" || !Number.isInteger(value) || value < -2147483648 || value > 2147483647)
          throw new Error(name + " must be a 32-bit integer.");
      } else if (spec.type === "decimal") {
        if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(name + " must be a finite decimal.");
      } else if (spec.type === "boolean") {
        if (typeof value !== "boolean") throw new Error(name + " must be true or false.");
      } else if (spec.type === "string") {
        if (typeof value !== "string" || value.length > 1024) throw new Error(name + " must be a string of at most 1024 characters.");
      } else {
        throw new Error("Unsupported parameter type " + spec.type);
      }
      values[name] = value;
    }
    return values;
  }

  function validateExamples(examples) {
    if (!Array.isArray(examples) || examples.length === 0) throw new Error("No examples provided.");
    const names = new Set();
    for (const example of examples) {
      if (!validId.test(example.id) || names.has(example.id)) throw new Error("Duplicate or invalid example ID.");
      names.add(example.id);
      if (example.definition.version !== 1 || example.definition.entity !== "Customer")
        throw new Error("Examples must use the supported Customer v1 AST.");
      if (!Array.isArray(example.concepts) || typeof example.title !== "string") throw new Error("Invalid example metadata.");
      const stats = analyze(example);
      if (stats.nodes > 256 || stats.depth > 16) throw new Error("Example exceeds AST limits.");
      for (const [name, spec] of Object.entries(example.parameters)) {
        if (!validId.test(name) || !supportedTypes.has(spec.type)) throw new Error("Invalid parameter declaration.");
      }
      if (stats.references.size !== Object.keys(example.parameters).length ||
        [...stats.references.keys()].some(name => !Object.hasOwn(example.parameters, name)))
        throw new Error("Runtime parameter declarations do not match AST references.");
      getBindings(example);
    }
    return examples;
  }

  function formatNode(node) {
    if (node.type === "group") return node.operator.toUpperCase() + " · " + node.expressions.length + " conditions";
    if (node.type === "not") return "NOT · invert predicate";
    if (node.type === "collectionExpression") return "Orders · " + node.quantifier.toUpperCase();
    if (node.type === "expression") {
      const value = node.parameter ? "@" + node.parameter : node.operator === "isNull" || node.operator === "isNotNull"
        ? "" : JSON.stringify(node.value);
      return node.field + " · " + node.operator + (value ? " · " + value : "");
    }
    return "Unknown expression";
  }

  globalThis.ExpressionForgeGallery = Object.freeze({ visit, analyze, getBindings, validateExamples, formatNode });
  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id);
  const selection = $("gallery-presets"), tree = $("gallery-tree"), bindingsPanel = $("gallery-bindings");
  const code = $("gallery-code"), error = $("gallery-error"), copy = $("gallery-copy");
  const title = $("gallery-title"), description = $("gallery-description"), stats = $("gallery-stats");
  const tabs = { definition: $("gallery-tab-definition"), request: $("gallery-tab-request") };
  let examples = [], selected = null, values = {}, activeTab = "definition";

  function el(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function drawTree(node, parent) {
    const entry = el("div", "gallery-tree-node gallery-tree-" + node.type);
    entry.append(el("div", "gallery-tree-label", formatNode(node)));
    if (node.type === "group" || node.type === "not" || node.type === "collectionExpression") {
      const children = el("div", "gallery-tree-children");
      if (node.type === "group") {
        for (const child of node.expressions) drawTree(child, children);
      } else {
        drawTree(node.expression, children);
      }
      entry.append(children);
    }
    parent.append(entry);
  }

  function readInput(spec, input) {
    if (spec.type === "boolean") return input.value === "true";
    if (spec.type === "string") return input.value;
    if (!input.value.trim()) throw new Error(spec.label + " is required.");
    const number = Number(input.value);
    if (!Number.isFinite(number)) throw new Error(spec.label + " must be a valid number.");
    return number;
  }

  function renderOutput() {
    if (!selected) return;
    for (const [key, tab] of Object.entries(tabs)) {
      tab.classList.toggle("active", activeTab === key);
      tab.setAttribute("aria-selected", String(activeTab === key));
      tab.tabIndex = activeTab === key ? 0 : -1;
    }
    if (activeTab === "definition") {
      code.textContent = JSON.stringify(selected.definition, null, 2);
      error.textContent = "";
      copy.disabled = false;
      return;
    }
    try {
      code.textContent = JSON.stringify({ definition: selected.definition, parameters: getBindings(selected, values) }, null, 2);
      error.textContent = "";
      copy.disabled = false;
    } catch (reason) {
      error.textContent = reason.message;
      code.textContent = "Correct the parameter values to generate a bound request.";
      copy.disabled = true;
    }
  }

  function renderSelection() {
    const info = analyze(selected);
    title.textContent = selected.title;
    description.textContent = selected.description;
    stats.textContent = info.nodes + " nodes · " + info.depth + " levels · " + info.collections +
      " collections · " + info.references.size + " parameters";
    tree.replaceChildren();
    drawTree(selected.definition.query, tree);
    bindingsPanel.replaceChildren();
    values = {};
    for (const [name, spec] of Object.entries(selected.parameters)) {
      const wrapper = el("div", "gallery-binding");
      const label = el("label", "gallery-binding-label", spec.label);
      const input = spec.type === "boolean" ? el("select", "gallery-input") : el("input", "gallery-input");
      input.id = "gallery-binding-" + name;
      label.htmlFor = input.id;
      if (spec.type === "boolean") {
        for (const choice of [true, false]) {
          const option = el("option", "", String(choice));
          option.value = String(choice);
          input.append(option);
        }
        input.value = String(spec.value);
      } else {
        input.type = spec.type === "string" ? "text" : "number";
        if (spec.type === "integer") input.step = "1";
        if (spec.type === "decimal") input.step = "any";
        input.value = String(spec.value);
      }
      const hint = el("span", "gallery-binding-type", spec.type + " · @" + name);
      input.addEventListener("input", () => {
        try { values[name] = readInput(spec, input); }
        catch { values[name] = undefined; }
        renderOutput();
      });
      wrapper.append(label, input, hint);
      bindingsPanel.append(wrapper);
    }
    for (const button of selection.querySelectorAll("button")) {
      const active = button.dataset.example === selected.id;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", String(active));
    }
    activeTab = "definition";
    renderOutput();
  }

  function renderPresets() {
    selection.replaceChildren();
    for (const example of examples) {
      const button = el("button", "gallery-preset");
      button.type = "button";
      button.dataset.example = example.id;
      button.append(el("strong", "", example.title), el("span", "", example.concepts.join(" · ")));
      button.addEventListener("click", () => { selected = example; renderSelection(); });
      selection.append(button);
    }
  }

  for (const [key, tab] of Object.entries(tabs)) {
    tab.addEventListener("click", () => { activeTab = key; renderOutput(); });
    tab.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      activeTab = key === "definition" ? "request" : "definition";
      renderOutput();
      tabs[activeTab].focus();
    });
  }
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(code.textContent); copy.textContent = "Copied ✓"; }
    catch { copy.textContent = "Copy unavailable"; }
  });

  fetch("examples.json")
    .then(response => {
      if (!response.ok) throw new Error("Examples could not be loaded (" + response.status + ").");
      return response.json();
    })
    .then(data => {
      examples = validateExamples(data);
      selected = examples[0];
      renderPresets();
      renderSelection();
    })
    .catch(reason => {
      error.textContent = reason.message + " Reload the page to try again.";
      selection.textContent = "Examples are temporarily unavailable.";
    });
})();
