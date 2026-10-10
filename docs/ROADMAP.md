# ExpressionForge Roadmap

ExpressionForge is a metadata-driven expression and query engine with a visual editor. The canonical recursive JSON AST is independent of the editor and SQL Server.

## Development principles

- Work on feature branches; merge only after build/test checks and review.
- Increment the visible product/package version only after a milestone's acceptance criteria are met.
- Every new operation needs metadata, validation, compilation, and tests.
- Keep v1 read-only: data mutation and side-effecting workflows are out of scope.
- Preserve JSON contract compatibility or provide explicit migrations.

## Milestones

| Version | Focus | Exit criteria |
| --- | --- | --- |
| 0.1.0 | Initial foundation | AST, sample metadata, validation, SQL Server compiler, basic editor (implemented; runtime verification ongoing) |
| 0.2.0 | Expression correctness | Stable node identity, structured diagnostics, null/type/quantifier semantics, runtime parameters, SQL Server integration tests, CI green |
| 0.3.0 | Dynamic metadata & types | Register entities/operators without frontend changes; typed scope resolution, versioning and permissions |
| 0.4.0 | Blueprint editor | Free-form canvas, typed sockets, drag/drop, undo/redo, AST round-trip |
| 0.5.0 | Value expressions | Arithmetic, field-to-field comparisons, string/date functions, explicit conversions |
| 0.6.0 | Query transformations | Projection, sorting, joins, grouping, aggregation, output-schema inference |
| 0.7.0 | Query planning | Provider-neutral logical plan, optimizer, explain API and semantic-equivalence tests |
| 0.8.0 | Persistence & reuse | Saved/versioned definitions, reusable expressions, parameter templates and migrations |
| 0.9.0 | Production hardening | Provider abstraction and second provider, tenant/field authorization, budgets, telemetry, load/security tests |
| 1.0.0 | Stable release | Documented public contracts, packages, complete sample, compatibility policy, clean installation and production checklist |

## v0.2.0 — acceptance and release

**Integration strategy:** Small, independently tested PRs merge into `main`. The v0.2.0 package and metadata catalog versions are aligned; the release workflow verifies all tests and artifacts before publishing.

Completed increments:
- Stable optional expression node IDs and structured validation diagnostics, compatible with existing JSON v1.
- Typed runtime parameter references and bound validation/compile/preview API endpoints.
- Metadata-driven editor runtime parameter inspector, with nested collection scoping and client-side binding tests.
- .NET 10 CI with MSTest, editor tests and build artifacts; verified green on `main`.

Completed: SQL Server 2022 Testcontainers coverage for null/type/quantifier semantics and real database execution. The public GitHub Pages site now shares five complex AST fixtures with unit and SQL Server integration tests, so documented examples cannot drift silently from the engine.

Final correctness review is complete, including diagnostic ownership, cross-type parameter conflicts and invalid null-check values. The v0.2.0 release is published only after the automated release workflow verifies the merged version bump and creates the GitHub Release. Dynamic metadata and type registration belong to v0.3.0.

## Next work: v0.3.0

Introduce a pluggable metadata catalog and type resolver while preserving the current JSON AST v1 and SQL Server semantics. Start with registration and validation, then integrate the frontend and authorization-aware metadata responses. Keep the [GitHub Pages example gallery](https://matrtech.github.io/ExpressionForge/#examples) updated with examples that are also exercised by .NET and SQL Server tests.

## Dependencies

```mermaid
flowchart TD
    A["0.1 Foundation"] --> B["0.2 Correctness"]
    B --> C["0.3 Metadata & Types"]
    C --> D["0.4 Visual Editor"]
    C --> E["0.5 Value Expressions"]
    D --> F["0.6 Transformations"]
    E --> F
    F --> G["0.7 Query Planning"]
    F --> H["0.8 Persistence"]
    G --> I["0.9 Hardening"]
    H --> I
    I --> J["1.0 Stable"]
```
