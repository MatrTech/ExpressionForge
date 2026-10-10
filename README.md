# ExpressionForge

**Build queries visually. Validate them structurally. Compile them safely.**

ExpressionForge is a .NET 10 metadata-driven expression engine with a Blueprint-inspired web editor. Users compose nested predicates using blocks. The frontend discovers fields, relationships and operators from the backend, then sends a provider-independent JSON expression tree (AST) for validation and SQL Server compilation.

> **Version 0.1.0 — foundational preview.** The editor is a connected recursive block tree, not yet a freely movable node canvas. Filtering, correlated collection predicates, metadata, and parameterized SQL Server compilation work. Projections, aggregation, joins, reusable subgraphs and other database providers are planned, not implemented.

## Try it

Requirements: .NET 10 SDK. SQL Server is optional for query compilation; required only for data preview.

```bash
dotnet restore ExpressionForge.slnx
dotnet test ExpressionForge.slnx
dotnet run --project src/ExpressionForge.Api --urls http://localhost:5054
```

Open **http://localhost:5054** for the visual editor. The editor starts with a sample Customer query. Change properties, operators, values, logical groups, or collection predicates; the JSON AST updates live.

Use the **Validate** and **Compile SQL** buttons without a database. To preview actual rows, execute [`examples/schema.sql`](examples/schema.sql) in a development SQL Server database, then configure a restricted **read-only database login** and set the connection string:

```bash
# Bash / zsh
export ConnectionStrings__ExpressionForge='Server=localhost;Database=ExpressionForge;User Id=query_reader;Password=YOUR_PASSWORD;Encrypt=True;TrustServerCertificate=True'
```

```powershell
# PowerShell
$env:ConnectionStrings__ExpressionForge='Server=localhost;Database=ExpressionForge;User Id=query_reader;Password=YOUR_PASSWORD;Encrypt=True;TrustServerCertificate=True'
```

Do not check connection strings, passwords or SQL Server credentials into source control. A DB connection is never exposed to the browser.

## JSON contract

```json
{
  "version": 1,
  "entity": "Customer",
  "query": {
    "type": "group",
    "operator": "and",
    "expressions": [
      { "type": "expression", "field": "FirstName", "operator": "equals", "value": "John" },
      {
        "type": "collectionExpression",
        "collection": "Orders",
        "quantifier": "any",
        "expression": { "type": "expression", "field": "Total", "operator": "greaterThan", "value": 100 }
      }
    ]
  }
}
```

An expanded example lives in [`examples/customer-query.json`](examples/customer-query.json).

A `group` combines child predicates with `and`/`or`. An `expression` compares a catalog field to a typed JSON scalar. A `collectionExpression` evaluates an `any`/`none`/`all` predicate in the related entity's scope. A `not` negates a predicate. Query strings never contain SQL fragments.

`all` uses vacuous truth for empty collections. Predicate UNKNOWN/NULL is considered unsatisfied for individual collection members, as enforced by its CASE expression. Other comparisons follow SQL Server null/three-valued semantics.

## HTTP endpoints

| Method | Endpoint | Function |
|---|---|---|
| GET | `/api/query/metadata` | Frontend-safe entity, property, relationship and operator metadata |
| GET | `/api/query/metadata/entities/{id}` | Metadata for one entity |
| POST | `/api/query/validate` | AST validation with JSON paths and error codes |
| POST | `/api/query/describe` | Output schema (root columns for v0.1.0) |
| POST | `/api/query/compile?limit=25` | SQL text, typed parameters and output schema |
| POST | `/api/query/preview?limit=25` | Execute a bounded SQL Server query and return rows |

All POST endpoints accept the **same JSON query definition** as the request body. Invalid ASTs yield errors; compilation and execution return `422` for semantic errors. Data preview returns `503` when no SQL connection is configured. Database execution failures are returned as generic server errors to avoid leaking provider details.

Example:

```bash
curl -s -X POST 'http://localhost:5054/api/query/compile?limit=10' \
  -H 'Content-Type: application/json' \
  --data-binary @examples/customer-query.json
```

## Packages

- `ExpressionForge.Core` — JSON AST, catalog metadata, strict validation, parameterized SQL Server query compilation.
- `ExpressionForge.Api` — ASP.NET Core host, metadata/validation/compile/preview routes, static UI, optional SqlClient execution.
- `ExpressionForge.Tests` — MSTest coverage for recursive serialization, scope/type validation, quantifiers, parameterization and limits.

The core package has **no external NuGet dependencies**.

## Safety and current constraints

The metadata registry explicitly lists allowed entities and fields; SQL table/relationship mappings stay server-side. Queries use only catalog-controlled identifiers and bind all scalar values as typed parameters. Root queries are explicitly projected to catalog fields, with `TOP (@take)` bounded to 100 results. Execution is read-only by convention and must use **least-privilege SQL credentials**—the engine does not grant or enforce database account permissions.

The initial sample catalog is registered in `QueryCatalog.CreateDemo()` with `Customer` and `Order` entities; it's not database introspection. The catalog, authentication, tenant-specific authorization, schema migrations, execution cost governance and deployment configuration must be integrated before running against production data. SQL Server schema must match registered mappings.

Frontend metadata is presentation information, not an authorization boundary. The backend independently validates every request. The editor only supports the version 1 AST and loads all metadata upfront; future versions can offer lazy relationship metadata and arbitrary graph layouts.

## Next milestones

1. A proper pan/zoom/free-form graph canvas (React Flow or Rete.js) with typed sockets and AST serialization.
2. Registered metadata providers instead of the built-in sample catalog, and user-specific authorization.
3. Value-expression ASTs, query operations (`select`, `sort`, `groupBy`, `aggregate`) and derived schema inference.
4. Logical query plan (IR), optimizer, provider adapters, parameter references, persisted definitions and version migrations.

MIT licensed. See [LICENSE](LICENSE).
