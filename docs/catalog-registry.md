# v0.3.0 increment 4 — Pluggable metadata sources and catalog switching

ExpressionForge can serve more than one independently registered domain through the same AST validator, SQL Server compiler and visual editor.

## Multiple catalogs in one API process

Configure a trusted local registry manifest using `ExpressionForge__RegistryFile`:

```bash
export ExpressionForge__RegistryFile="$(pwd)/examples/catalog-registry.json"
dotnet run --project src/ExpressionForge.Api --urls http://localhost:5054
```

The sample manifest is:

```json
{
  "defaultCatalog": "customers",
  "catalogs": [
    { "id": "customers", "displayName": "Customers & Orders", "source": "demo" },
    { "id": "projects", "displayName": "Projects & Tasks", "source": "json", "path": "project-catalog.json" }
  ]
}
```

Sources and SQL mappings are trusted server configuration. `source = demo` loads the built-in Customer/Order example; `source = json` loads a validated catalog from the specified server-side file. Relative catalog paths resolve against the **manifest directory**, not the HTTP request. Unknown provider types, unsafe/duplicate IDs, missing default IDs and invalid catalogs fail startup.

### Extensible providers

The core library defines `IQueryCatalogSource` with `Kind` and `Load(string? location)`. The loader accepts a trusted collection of provider implementations. Domain-specific sources can retrieve a validated catalog from configuration management or another server-side storage system without changing the query AST or frontend. The demo and JSON file providers are included. Query requests **cannot** register or modify sources. Source registrations are loaded at startup; no hot reload or auto-introspection is introduced.

## API selection and compatibility

- `GET /api/query/catalogs` enumerates **only catalogs visible to the current principal**, returning IDs, names, revisions and which is default. No physical SQL mappings are exposed.
- `GET /api/query/metadata?catalog=projects` and `GET /api/query/metadata/entities/{id}?catalog=projects` return safe metadata for the selected catalog.
- `POST /api/query/metadata/scopes`, `/validate`, `/describe`, `/compile`, `/preview`, and their bound variants read optional `catalogId` from the **query definition** (including `definition.catalogId` in bound envelopes). A contradictory `?catalog=` query parameter is rejected.
- `catalogRevision` remains a separate optimistic compatibility guard and is computed per effective, role-filtered catalog. Persisted queries should pin both `catalogId` and `catalogRevision` when appropriate.
- Existing AST v1 payloads **without** `catalogId` continue using the configured default catalog. Legacy single-catalog `CatalogFile` and `AccessFile` deployment configuration remains compatible; do not set either alongside `RegistryFile`.

Example:

```json
{
  "version": 1,
  "catalogId": "projects",
  "entity": "Project",
  "query": {
    "type": "expression",
    "field": "Budget",
    "operator": "greaterThan",
    "value": 10000
  }
}
```

The current browser editor loads the available catalogs from `/api/query/catalogs`, fetches metadata when switching, and preserves a separate unsaved query and runtime bindings for each selected catalog. Imported JSON with `catalogId` switches to the matching authorized catalog. The editor remains a metadata-driven visual expression editor, **not** the free-form Blueprint canvas planned for v0.4.0.

## Authorization with multiple catalogs

Each manifest entry may have an `accessFile` referring to an independent trusted role allowlist. **All catalogs must be protected, or none.** A registry mixing restricted and public catalog entries is rejected at startup to prevent accidental exposure. In protected mode the API uses validated JWT bearer role claims; a role must have effective grants for a catalog to discover or execute it.

Unrecognized/inaccessible catalog IDs return 404 and do not leak schema information. A crafted JSON AST cannot bypass catalog-specific grants by editing the `catalogId`, and SQL SELECT returns only granted fields. As before, the engine does not implement row-level or tenant-specific security: production deployments must enforce database permissions and applicable RLS.

The public GitHub Pages site illustrates the registry and query contract. It cannot authenticate to a private API or execute SQL in the browser-only showcase.

## Verification

Unit tests cover both sources in the manifest, backwards-compatible AST serialization, unauthorized discovery, malformed manifests, provider extensibility and mixed-policy rejection. Node tests cover per-catalog AST defaults, importing incompatible definitions and editor wiring. Existing SQL Server 2022 integration tests validate catalog-specific compilation and execution using the same trusted Project/Task example.
