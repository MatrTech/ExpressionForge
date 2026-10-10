# v0.3.0 increment 3 — Authorization-aware metadata and SQL compilation

ExpressionForge can enforce per-role access to entities, scalar fields and collection relationships using a **trusted server-side allowlist**. The engine materializes an isolated effective catalog from verified ASP.NET Core role claims for each request. Discovery, type scopes, validation, SQL compilation, result projection, and SQL Server preview use that exact effective catalog.

This increment is about **schema-level** permissions, not per-row data authorization or multi-tenant isolation.

## Configure trusted access rules

The host retains its unrestricted **demo-only** mode when no access file is configured. To enable restricted mode, set all three environment variables:

```bash
export ExpressionForge__CatalogFile="$(pwd)/examples/project-catalog.json"
export ExpressionForge__AccessFile="$(pwd)/examples/project-access.json"
export ExpressionForge__Authorization__Authority="https://YOUR-IDENTITY-PROVIDER/"
export ExpressionForge__Authorization__Audience="expressionforge-api"
dotnet run --project src/ExpressionForge.Api --urls http://localhost:5054
```

The authority **must be HTTPS**. Its OpenID Connect discovery endpoint and token validation must be available when the API authenticates requests. ExpressionForge uses standard ASP.NET Core JWT bearer validation. A missing authority or audience causes startup failure in restricted mode. The runtime never trusts client-supplied role names, headers containing self-asserted permissions, or access rules from query JSON.

See [`examples/project-access.json`](../examples/project-access.json) for two server-managed roles:

- `project-reader`: limited `Project` fields (Id, Name, Archived), no Tasks traversal and no Budget.
- `planner`: Project budget and the Tasks collection, with only `Hours` and `State` available inside a Task predicate.

The `roles` array contains role objects, each with `role` and an `entities` array. Each entity grant must specify `entity`, at least one allowed `properties` item and a `relationships` array (empty is valid). All member IDs must already exist in the configured catalog. Duplicate/invalid grants fail startup. Multiple validated roles on the same principal combine their grants (union). No applicable grants means access is denied.

## Behavior

When AccessFile is configured:

- All `/api/query/*` routes require a valid bearer token. Missing/invalid credentials return 401.
- An authenticated principal without applicable role grants receives 403.
- `GET /metadata`, `GET /metadata/entities/{id}` and `POST /metadata/scopes` disclose only effective entities, fields, operators and relationships.
- A manually crafted AST referencing ungranted fields, relationships or root entities is rejected during semantic validation, including bound endpoints.
- `/describe`, `/compile`, and `/preview` restrict their **SELECT projection** to granted root fields. Child join keys may be used internally when an allowed relationship is traversed, even when those physical join columns are not visible.
- Each effective catalog has its own `catalogRevision`, so pinned definitions detect changed access as well as changes to underlying metadata.

Example request:

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" http://localhost:5054/api/query/metadata
```

The static website/editor is still public and is **not an OAuth login client**. When using restricted mode, use a properly authenticated API client or integrate an identity-provider login into your own editor deployment. Do not hardcode or persist bearer tokens in the static site.

## Security boundaries and limitations

A role grant controls whether a field is exposed and may be used in a predicate; projection and filtering share the same property grant in v0.3. If separate read/filter permissions are needed, introduce them as an explicit additional capability rather than inferring them from display metadata.

The API's role filtering is not a substitute for database permissions: use **read-only SQL credentials**, least-privilege table/view grants and SQL Server row-level security for tenant/user row isolation. In particular, collection quantifiers can reveal whether related rows exist; do not expose sensitive relationships unless that inference is authorized.

Do **not** deploy without access rules against sensitive data; the no-file demo mode intentionally accepts anonymous requests. Access rules are loaded once on startup; no hot reload. No owner-level tenant predicates or secure saved-query sharing are implemented yet.

The verified integration suite checks that a limited role's compiled SQL returns only permitted columns from real SQL Server rows.
