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

## Current work: v0.2.0

**Branch:** `feature/v0.2.0-correctness`

The first increment adds optional stable `id` properties to expression nodes and includes those IDs in validation diagnostics. Existing v1 JSON without IDs stays valid. The editor generates IDs when serializing.

Remaining before a v0.2.0 release: runtime parameter references and bindings, exhaustive null/type/quantifier tests against SQL Server, and a verified green CI pipeline.

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
