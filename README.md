# ExpressionForge

**Project website:** https://matrtech.github.io/ExpressionForge/ · [Website source](site/) · [Deployment notes](docs/PAGES.md)

**Try the browser Blueprint editor:** https://matrtech.github.io/ExpressionForge/blueprint.html — edit the real Project/Task AST directly, without installing .NET. Validation, SQL generation and data preview require the .NET API.

**New to ExpressionForge?** The shared editor offers a first-run tutorial with a brief guided walkthrough of adding conditions, navigating the Blueprint canvas, editing nodes, and exploring collection subgraphs. It is skippable, remembers your choice locally, and can be restarted from **? Tutorial** at any time. The tutorial does not change your query.

**Build queries visually. Validate them structurally. Compile them safely.**

ExpressionForge is a .NET 10 metadata-driven expression engine with a Blueprint-inspired web editor. Users compose nested predicates using blocks. The frontend discovers fields, relationships and operators from the backend, then sends a provider-independent JSON expression tree (AST) for validation and SQL Server compilation.

> **Published version 0.2.0 — expression correctness preview.** Development on `main` includes the metadata-driven Blueprint editor and five v0.5 value-expression increments, including safe conversions and typed arithmetic. Formal v0.4/v0.5 package releases remain separate from these development merges. The published package version has not been advanced yet.

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

An expanded example lives in [`examples/customer-query.json`](examples/customer-query.json). The [interactive advanced example gallery](https://matrtech.github.io/ExpressionForge/#examples) provides five complex ASTs with runtime bindings; the same fixtures are validated and executed in CI.

**Explicit conversion and value-tree editing (v0.5 development):** The typed `tryParseDecimal` numeric value converts a metadata-approved string field to `decimal(28,6)` through SQL Server `TRY_CONVERT`. Malformed text, overflow and NULL inputs produce NULL, preserving SQL three-valued comparisons. No arbitrary type names or SQL conversion snippets can be supplied by an AST. The browser rejects numeric literal edits, runtime bindings, and pasted `numericLiteral` JSON when a JavaScript Number would silently change the submitted decimal; exact decimal evaluation is performed by the .NET backend.

```json
{
  "type": "arithmeticComparison",
  "left": {
    "type": "numericBinary",
    "operator": "add",
    "left": { "type": "tryParseDecimal", "field": "BalanceText" },
    "right": { "type": "numericLiteral", "value": 100 }
  },
  "operator": "greaterThan",
  "right": { "type": "numericLiteral", "value": 250 }
}
```

In Blueprint, expand an arithmetic node and open **Advanced value tree** to replace, wrap, unwrap and edit the numeric operands recursively. The same metadata scope, maximum depth, numeric precision rules, validation, and immutable AST apply. The Guided editor remains optimized for straightforward conversions and calculations. `tryParseDecimal` is SQL Server-specific in this compiler; equivalent semantics must be defined per provider before adopting a second database backend.

**String and date functions (v0.5 development):** Typed numeric values now include `stringLength` and `dateDiffDays`, which can be used wherever a numeric value is allowed, including inside arithmetic trees and collection predicates. Both reference approved fields in the active entity scope. For SQL Server, `stringLength` follows `LEN` semantics (trailing ordinary spaces are not counted), while `dateDiffDays` counts signed day boundaries between fields of matching `date` or `dateTime` types. SQL NULL inputs propagate to NULL; comparisons with NULL do not select rows.

```json
{
  "type": "arithmeticComparison",
  "left": {
    "type": "dateDiffDays",
    "startField": "StartedAt",
    "endField": "FinishedAt"
  },
  "operator": "greaterThan",
  "right": { "type": "numericLiteral", "value": 7 }
}
```

The editor offers **Text length** when a string field is available, and **Days between dates** when at least two compatible date fields are exposed. No arbitrary SQL functions or unchecked identifiers are accepted.

Trusted catalog files may register `date` and `dateTime` fields with an empty `operators` array when they are only used by typed functions. Standard scalar comparison operators for date/dateTime are intentionally not exposed yet, because those conversions and binding semantics have not been implemented. All other property types still require at least one supported operator.

**Typed arithmetic (v0.5 development):** The `arithmeticComparison` predicate compares nested numeric values. `numericField` references a metadata-approved integer/decimal property, `numericLiteral` is a parameterized number, and `numericBinary` combines two values using `add`, `subtract`, `multiply` or `divide`.

```json
{
  "type": "arithmeticComparison",
  "left": {
    "type": "numericBinary",
    "operator": "subtract",
    "left": { "type": "numericField", "field": "Age" },
    "right": { "type": "numericField", "field": "Id" }
  },
  "operator": "greaterThan",
  "right": { "type": "numericLiteral", "value": 20 }
}
```

SQL Server uses `decimal(28,6)` for numeric literals, approved numeric fields and parsed text values. Each binary arithmetic operation safely narrows operands to `decimal(19,6)`, widens them for calculation and returns `decimal(19,6)` or SQL `NULL` if the operand/result does not fit, preventing intermediate overflow. Normal decimal operations round to six fractional digits. This protective working limit is intentionally narrower than the leaf type and must be considered when using large financial values. Literal values are restricted to ±1e12 with at most six decimal places. Nested values count toward the global 16-level/256-node complexity budgets; column identifiers are resolved from trusted metadata. Division uses `NULLIF(denominator, 0)`: a zero denominator evaluates to SQL `NULL`, so the numeric comparison is UNKNOWN and the row does not satisfy a `WHERE` predicate. A `numericParameter` node names a decimal binding sent separately from the AST; runtime values must be within ±1e12 with at most six fractional digits, and never become SQL identifiers or fragments. Conflicting reuse of a numeric parameter name with an incompatible field type is rejected. Arbitrary SQL and automatic conversions remain out of scope.

Example of reusable numeric inputs (the binding is supplied at execution time, not saved inside the query):

```json
{
  "type": "arithmeticComparison",
  "left": {
    "type": "numericBinary", "operator": "divide",
    "left": { "type": "numericField", "field": "Age" },
    "right": { "type": "numericParameter", "parameter": "divisor" }
  },
  "operator": "greaterThan",
  "right": { "type": "numericLiteral", "value": 10 }
}
```

A `fieldComparison` compares two metadata-approved fields in the same entity scope without runtime values. Example: `{ "type": "fieldComparison", "leftField": "Id", "operator": "lessThan", "rightField": "Age" }`. Fields must have identical data types. Equality/inequality work for supported types; range comparisons are restricted to numeric fields. SQL Server NULL values use normal three-valued semantics.

A `group` combines child predicates with `and`/`or`. An `expression` compares a catalog field to a typed JSON scalar. A `collectionExpression` evaluates an `any`/`none`/`all` predicate in the related entity's scope. A `not` negates a predicate. Query strings never contain SQL fragments.

`all` uses vacuous truth for empty collections. Predicate UNKNOWN/NULL is considered unsatisfied for individual collection members, as enforced by its CASE expression. Other comparisons follow SQL Server null/three-valued semantics.

## HTTP endpoints

| Method | Endpoint | Function |
|---|---|---|
| GET | `/api/query/catalogs` | List registered catalogs visible to the current user |
| GET | `/api/query/metadata?catalog=projects` | Frontend-safe entity, property, relationship and operator metadata for a selected catalog |
| GET | `/api/query/metadata/entities/{id}` | Metadata for one entity |
| POST | `/api/query/metadata/scopes` | Resolve typed entity and field scopes throughout a nested AST |
| POST | `/api/query/validate` | AST validation with JSON paths and error codes |
| POST | `/api/query/describe` | Output schema (root columns for v0.1.0) |
| POST | `/api/query/compile?limit=25` | SQL text, typed parameters and output schema |
| POST | `/api/query/preview?limit=25` | Execute a bounded SQL Server query and return rows |
| POST | `/api/query/validate/bound` | Validate `{ "definition": ..., "parameters": {...} }` |
| POST | `/api/query/compile/bound?limit=25` | Compile a query with typed runtime bindings |
| POST | `/api/query/preview/bound?limit=25` | Execute a query with typed runtime bindings |

Unbound POST endpoints accept a JSON query definition. Bound endpoints accept an object with separate `definition` and `parameters` members; they preserve the saved AST. Invalid ASTs yield errors; compilation and execution return `422` for semantic errors. Data preview returns `503` when no SQL connection is configured. Database execution failures are returned as generic server errors to avoid leaking provider details.

Example:

```bash
curl -s -X POST 'http://localhost:5054/api/query/compile?limit=10' \
  -H 'Content-Type: application/json' \
  --data-binary @examples/customer-query.json
```

## Packages

- `ExpressionForge.Core` — JSON AST, catalog metadata, strict validation, parameterized SQL Server query compilation.
- `ExpressionForge.Api` — ASP.NET Core host, metadata/validation/compile/preview routes, static UI, optional SqlClient execution.
- `ExpressionForge.Tests` — MSTest coverage for serialization, diagnostics, scopes, parameters and limits.
- `ExpressionForge.IntegrationTests` — SQL Server 2022 Testcontainers coverage for real query semantics, including the public example gallery.

The core package has **no external NuGet dependencies**.

## Custom metadata catalogs (v0.3.0 development)

The first v0.3.0 increment supports registering a trusted, server-side entity catalog instead of the built-in Customer/Order demo. Define typed properties, supported operators, SQL Server table mappings and typed relationships in a local JSON file; the API validates these before accepting queries. The visual editor discovers the resulting entities through the existing metadata endpoint.

Try the [Project/Task catalog](examples/project-catalog.json) and its [nested parameterized query](examples/project-query.json), or see the [metadata registration guide](docs/metadata-registration.md). The public [metadata showcase](https://matrtech.github.io/ExpressionForge/#metadata) illustrates the example.

Set `ExpressionForge__CatalogFile` to the absolute path of your trusted JSON catalog file before starting the API. SQL tables must exist in the configured database. Custom operator implementations, hot reload and database introspection are not part of the current metadata milestone. The subsequent increments add catalog revision guards, typed nested scope discovery, optional JWT-authenticated role allowlists, and a registry of interchangeable demo/JSON sources. See [catalog revisions](docs/catalog-revisions-and-scopes.md), [authorization](docs/authorization.md), and [multi-catalog setup](docs/catalog-registry.md). Configure `ExpressionForge__RegistryFile` to run the [Customer + Project registry](examples/catalog-registry.json) and use the editor's **Registered catalog** selector.

## Safety and current constraints

The metadata registry explicitly lists allowed entities and fields; SQL table/relationship mappings stay server-side. When `ExpressionForge__AccessFile` is configured, validated JWT role claims control which entities, fields and relationships are visible and queryable; compiled SELECT projections and preview results exclude hidden columns. Without that setting the sample is an unrestricted development demo, not an appropriate production security configuration. Queries use only catalog-controlled identifiers and bind all scalar values as typed parameters. Root queries are explicitly projected to catalog fields, with `TOP (@take)` bounded to 100 results. Execution is read-only by convention and must use **least-privilege SQL credentials**—the engine does not grant or enforce database account permissions.

The initial sample catalog is registered in `QueryCatalog.CreateDemo()` with `Customer` and `Order` entities; it's not database introspection. The catalog, authentication, tenant-specific authorization, schema migrations, execution cost governance and deployment configuration must be integrated before running against production data. SQL Server schema must match registered mappings.

Frontend metadata is presentation information, not an authorization boundary. The backend independently validates every request. The editor only supports the version 1 AST and loads all metadata upfront; future versions can offer lazy relationship metadata and arbitrary graph layouts.

## Blueprint preview (v0.4.0 development)

The editor offers an optional **free-form Blueprint canvas** alongside the guided editor. It projects the AST into typed predicate nodes, shows connections, supports dragging, panning, zooming, fit/reset layout and nested subgraph navigation. Guided editing remains the default; Blueprint is currently an interactive **layout and navigation view**, not yet a semantic graph editor. Node positions are kept separately in local browser storage per catalog/entity and never change the JSON AST.

Both Guided mode and Blueprint mode now let users add metadata-selected conditions without manually wiring sockets. In Blueprint, a chevron opens inline field/operator/value configuration; predicate output sockets can be reattached to compatible AND/OR inputs. Socket operations are validated by the AST command layer. The editor now supports dragging compatible predicate connections, insert-on-wire AND/OR/NOT actions, safe predicate deletion, and bounded undo/redo for AST, runtime bindings and canvas layout. Automated browser interaction coverage remains a release gate. The SQL compiler, JSON contract and backend validation are unchanged. See the [graph projection design and acceptance boundaries](docs/blueprint-graph.md).

## Next milestones

1. **v0.3.0:** Dynamic metadata providers, typed scope resolution, catalog versioning and authorization-aware discovery.
2. **v0.4.0:** A pan/zoom/free-form Blueprint canvas with typed sockets and AST round-trip.
3. **v0.5–0.6:** Value expressions, projections, sorting, grouping and aggregation.
4. **v0.7–1.0:** Provider-neutral query planning, persistence, additional providers and production hardening.

MIT licensed. See [LICENSE](LICENSE).

## v0.2.0 correctness and runtime bindings

Expression nodes can carry optional stable `id` values. Validation reports the correct `nodeId` for each issue, including nested expressions; imported JSON without IDs remains valid.

Comparison expressions can reference a named runtime binding with `"parameter": "minimumAge"` instead of a literal `value`. Bound endpoints receive a separate JSON object:

```json
{
  "definition": {
    "version": 1,
    "entity": "Customer",
    "query": { "type": "expression", "field": "Age", "operator": "greaterThan", "parameter": "minimumAge" }
  },
  "parameters": { "minimumAge": 21 }
}
```

A runtime parameter must be present, correctly typed, and used consistently with the same field type. NULL checks do not accept values or runtime bindings. The editor keeps runtime values separate from saved query definitions.

See [the v0.2.0 release notes](docs/releases/v0.2.0.md), [CI/CD](docs/CI-CD.md), and the [roadmap](docs/ROADMAP.md).
