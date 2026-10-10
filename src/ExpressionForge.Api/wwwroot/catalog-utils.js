"use strict";

// Browser/Node pure helpers shared by the editor and its tests.
(function () {
  function metadataUrl(catalogId) {
    return "/api/query/metadata?catalog=" + encodeURIComponent(catalogId);
  }

  function makeDefinition(metadata, demo) {
    const entities = metadata.entities || [];
    if (!entities.length) throw new Error("This catalog does not expose a queryable entity.");
    const customer = entities.find(e => e.id === "Customer" &&
      e.properties.some(p => p.id === "FirstName") && e.relationships.some(r => r.id === "Orders"));
    let definition;
    if (customer && demo) definition = JSON.parse(JSON.stringify(demo));
    else {
      const entity = entities[0];
      const first = entity.properties[0];
      if (!first || !first.operators.length) throw new Error("No queryable fields in the selected catalog.");
      const operation = first.operators.find(op => op !== "isNull" && op !== "isNotNull") || first.operators[0];
      const value = ({ integer: 1, decimal: 100, boolean: true })[first.dataType] ?? "example";
      const comparison = { type: "expression", field: first.id, operator: operation };
      if (operation !== "isNull" && operation !== "isNotNull") comparison.value = value;
      definition = { version: 1, entity: entity.id, query: { type: "group", operator: "and", expressions: [comparison] } };
    }
    definition.catalogId = metadata.catalogId;
    definition.catalogRevision = metadata.catalogRevision;
    return definition;
  }

  function importDefinition(definition, metadata) {
    if (!definition || !definition.query || !metadata.entities.some(e => e.id === definition.entity))
      throw new Error("The selected catalog does not expose the query entity.");
    if (definition.catalogId !== undefined && definition.catalogId !== metadata.catalogId)
      throw new Error("The query belongs to a different catalog.");
    return { ...definition, catalogId: metadata.catalogId };
  }

  globalThis.ExpressionForgeCatalogs = Object.freeze({ metadataUrl, makeDefinition, importDefinition });
})();
