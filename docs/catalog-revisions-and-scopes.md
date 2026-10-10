# v0.3.0 increment 2 — Catalog revisions and typed expression scopes

A registered catalog now has two independent identities:

- `catalogVersion`: the currently published package version (`0.2.0` until v0.3.0 ships).
- `catalogRevision`: an opaque `sha256:` fingerprint of registered entities, SQL mappings, relationships, types, display labels, and supported operators. Registration order does not change it.

`GET /api/query/metadata` returns both. The revision intentionally changes when a physical SQL mapping changes, without exposing schema/table or join-key details.

## Pin a saved definition to its catalog

Existing AST v1 JSON is unchanged and remains accepted. Optionally add `catalogRevision` to the root of a saved definition, using the current revision from metadata:

```json
{
  "version": 1,
  "entity": "Customer",
  "catalogRevision": "sha256:<revision-from-metadata>",
  "query": {
    "type": "expression",
    "id": "age_filter",
    "field": "Age",
    "operator": "greaterThanOrEqual",
    "parameter": "minimumAge"
  }
}
```

A mismatch produces `catalogRevisionMismatch` at `$.catalogRevision`, and compile/preview refuse the stale query. Runtime binding values are supplied separately. The fingerprint is not the numeric AST version, and does not itself authorize a query.

## Discover scopes for an entire nested AST

`POST /api/query/metadata/scopes` accepts the same `QueryDefinition` as the validation endpoint, without runtime parameter values. Its response contains `catalogRevision`, `scopes`, `issues` and `isValid`. Each `scopes` item includes:

- `path` and `nodeId` for editor focus and diagnostics.
- `entityId` identifying the entity active at that AST node.
- `fieldType` for known comparison fields (or `null` on groups/collections).
- `properties` with each field's type and allowed operators.
- `relationships` with collection IDs and target entity IDs.

In [the Project / Task example](../examples/project-query.json), expressions on `Project` can access `Budget` (decimal) and `Archived` (boolean). Within `Tasks.any.expression`, the active entity switches to `Task`: `Hours` is decimal and `State` is string. Once the recursive traversal exits that collection, the parent `Project` scope is restored. Nested AND / OR, NOT and deeper collections follow the same rule.

This endpoint is deliberately **not a full validator**: always call `/api/query/validate` or `/api/query/validate/bound` before compile or preview. It enforces structural depth/node limits but does not validate arbitrary operator and value combinations. Public scope metadata excludes SQL mapping details.

## Client workflow

1. Fetch `GET /api/query/metadata`; cache the catalog revision.
2. Build dynamic controls using the returned entities, property types, collections and operators.
3. When the AST changes, resolve it with `POST /api/query/metadata/scopes` to update nested entity contexts.
4. When saving a definition, optionally pin its `catalogRevision` for optimistic schema compatibility.
5. Before execution, run validation. On `catalogRevisionMismatch`, fetch the new catalog and require an explicit review/migration of the saved query.

This increment does **not** add per-user authorization, database introspection, arbitrary SQL operators, or hot catalog reload. The package version stays 0.2.0 until the full v0.3.0 milestone is accepted.
