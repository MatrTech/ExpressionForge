# v0.3.0 increment 1 — Registered metadata catalogs

ExpressionForge no longer requires the built-in Customer/Order catalog to run. A trusted server operator can register another SQL Server schema with the same JSON AST v1, validator, SQL compiler and metadata-driven browser editor.

## Server-side registration

The `QueryCatalogBuilder` validates an entire catalog before it can serve queries. Use `AddEntity` and `AddOperator`, or load a JSON catalog from a trusted local file with `QueryCatalogFile.Load(path)`.

For the supplied [Project/Task catalog](../examples/project-catalog.json), run the API from the repository root:

```bash
dotnet run --project src/ExpressionForge.Api --urls http://localhost:5054 -- \
  ExpressionForge:CatalogFile=examples/project-catalog.json
```

Alternatively, set `ExpressionForge__CatalogFile` to an absolute file path in your deployment environment. Relative paths are resolved against the ASP.NET Core content root; adjust accordingly. The demo Customer/Order catalog is used when the setting is absent.

```csharp
var catalog = new QueryCatalogBuilder()
    .AddEntity(new EntityMetadata("Project", "Projects",
        [new PropertyMetadata("Id", "ID", "integer", false, ["equals"])],
        [], "dbo", "Projects"));
foreach (var op in QueryCatalog.StandardOperators)
    catalog.AddOperator(op);
var registeredCatalog = catalog.Build();
```

The sample catalog includes a Project → Tasks relationship, a decimal Budget field, task Hours and State fields, and a [parameterized nested query](../examples/project-query.json).

The browser editor automatically discovers entities, properties, operators and relationships through `GET /api/query/metadata`; no editor JavaScript modifications are needed when changing catalogs. The static GitHub Pages showcase demonstrates the contract but does not run the API or a database.

## Validated at registration

- Unique entity IDs, property IDs, relationship IDs and operator IDs.
- Strict SQL schema, table and column identifier syntax, preventing arbitrary SQL fragments in trusted mappings.
- Only the compiler's built-in, implemented operators; display names may be customized, but custom SQL semantics are **not yet supported**.
- Supported scalar types: `string`, `integer`, `decimal`, `boolean`.
- Each property may only expose registered operators that support its data type.
- Every relationship must point to an existing entity, and both join keys must be registered properties of the same data type.
- The built catalog copies its collections to read-only snapshots.

## Trust and compatibility

Catalog files contain physical SQL schema/table names and join mappings. **They are trusted server configuration**, not user-supplied query payloads. The API intentionally omits physical SQL mappings from its public metadata responses. The configured database must actually contain the registered schema; registration validates metadata, not live database structure.

This increment does not add database introspection, arbitrary operator plugins, per-user field permissions, catalog hot-reload, or migration of existing saved queries. Those require additional v0.3.0 work. The published package remains **0.2.0** until v0.3.0 acceptance is complete.
