"use strict";

// Static, educational playground. It does not call the .NET API or execute SQL.
(function () {
  function buildDefinition(name, minimumTotal, quantifier) {
    return {
      version: 1,
      entity: "Customer",
      query: {
        type: "group",
        operator: "and",
        expressions: [
          { type: "expression", field: "FirstName", operator: "equals", parameter: "firstName" },
          {
            type: "collectionExpression",
            collection: "Orders",
            quantifier,
            expression: { type: "expression", field: "Total", operator: "greaterThan", parameter: "minimumTotal" }
          }
        ]
      }
    };
  }

  function renderSql(quantifier) {
    const predicate = "[o].[Total] > @minimumTotal";
    const condition = quantifier === "any"
      ? `EXISTS (SELECT 1 FROM [dbo].[Orders] AS [o]
        WHERE [o].[CustomerId] = [c].[Id]
          AND ${predicate})`
      : quantifier === "none"
        ? `NOT EXISTS (SELECT 1 FROM [dbo].[Orders] AS [o]
        WHERE [o].[CustomerId] = [c].[Id]
          AND ${predicate})`
        : `NOT EXISTS (SELECT 1 FROM [dbo].[Orders] AS [o]
        WHERE [o].[CustomerId] = [c].[Id]
          AND CASE WHEN ${predicate}
                   THEN 1 ELSE 0 END = 0)`;

    return `-- Illustrative SQL, NOT live compiler output
-- Values are bound separately, never concatenated.
SELECT TOP (@take) [c].[Id], [c].[FirstName]
FROM [dbo].[Customers] AS [c]
WHERE [c].[FirstName] = @firstName
  AND ${condition};`;
  }

  function normalizedTotal(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1000000, parsed)) : 100;
  }

  globalThis.ExpressionForgeSiteDemo = Object.freeze({ buildDefinition, renderSql, normalizedTotal });

  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id);
  const nameInput = $("customer-name");
  const totalInput = $("minimum-total");
  const quantifierInput = $("quantifier");
  const code = $("demo-code");
  const note = $("demo-note");
  const tabs = { ast: $("tab-ast"), sql: $("tab-sql") };
  let activeTab = "ast";

  function render() {
    const name = nameInput.value;
    const total = normalizedTotal(totalInput.value);
    const quantifier = quantifierInput.value;
    const definition = buildDefinition(name, total, quantifier);
    const output = activeTab === "ast" ? JSON.stringify(definition, null, 2) : renderSql(quantifier);
    code.textContent = output;
    note.textContent = activeTab === "ast"
      ? `Saved definition has no values. Example runtime bindings: firstName = ${JSON.stringify(name)}, minimumTotal = ${total}.`
      : "Illustrative SQL only. The actual SQL Server compiler and validation require the .NET API.";
    for (const [key, tab] of Object.entries(tabs)) {
      const selected = key === activeTab;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
  }

  [nameInput, totalInput, quantifierInput].forEach(input => input.addEventListener("input", render));
  for (const [key, tab] of Object.entries(tabs)) {
    tab.addEventListener("click", () => { activeTab = key; render(); });
    tab.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const other = key === "ast" ? "sql" : "ast";
      activeTab = other;
      render();
      tabs[other].focus();
    });
  }
  $("reset-demo").addEventListener("click", () => {
    nameInput.value = "John";
    totalInput.value = "100";
    quantifierInput.value = "any";
    activeTab = "ast";
    render();
  });
  $("copy-code").addEventListener("click", async () => {
    const button = $("copy-code");
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = "Copied ✓";
    } catch {
      button.textContent = "Copy unavailable";
    }
    button.setAttribute("aria-label", button.textContent);
  });

  render();
})();
