# v0.4.0 increment 1 — Graph projection and typed Blueprint preview

This increment introduces a **read-only Blueprint preview** alongside the existing guided editor. The guided editor stays the default. Later increments will add an editable, free-form canvas; **this increment does not implement drag/drop or socket rewiring in the UI**.

## Using the preview

1. Run the API (`dotnet run --project src/ExpressionForge.Api`) and open the query editor.
2. Select **Blueprint preview** to see the live graph projection of the AST.
3. Select an AND/OR group or collection predicate to enter its subgraph; follow breadcrumbs to navigate back.
4. Switch to **Guided editor** to change fields and operators. The preview then reflects the same AST.

The original JSON API and SQL Server compiler are unchanged.

## Single source of truth

The version 1 query AST is canonical; layout, navigation and graph grouping do not appear in the query payload.

- `ExpressionForgeGraph.project(definition, catalog, { subgraphNodeIds })` returns a graph forest from an AST without mutating it.
- `ExpressionForgeGraph.toDefinition(projection)` reconstructs the portable AST and refuses to silently discard disconnected nodes.
- `ExpressionForgeGraph.canConnect(projection, graphKey, sourceKey, targetKey, inputIndex)` checks a candidate predicate connection. It rejects incompatible entity scopes, shared children, occupied sockets and cycles.
- `ExpressionForgeGraphPreview.render(container, projection, activeGraphKey, navigate)` renders a responsive scoped, read-only overview. This is a preview, **not** a new query engine.

The projection is independent of SQL. An AST may have no node IDs: temporary graph identities use JSON paths and are never written back to the query. Duplicate IDs also fall back to paths rather than merging nodes.

## Graph and socket contracts

| Graph kind | Context | Root sink input |
| --- | --- | --- |
| Root | `Predicate<TRoot>` | Exactly one |
| Collapsed AND / OR | Same entity as parent | Many ordered predicates |
| Collection (ANY / ALL / NONE) | Relationship target entity | Exactly one child predicate |

- Comparisons output `Predicate<TCurrent>` and have no predicate input.
- NOT accepts one `Predicate<TCurrent>` and returns the same type.
- AND and OR accept ordered `Predicate<TCurrent>` children, producing the same type.
- Collection nodes output a `Predicate<TParent>` in their parent graph. Their nested predicate is edited in a child graph with `Predicate<TChild>`; no direct cross-scope wire exists.
- The sink is a synthetic editor node. It is **not** a new AST node.

Input indices preserve the original `expressions` array order regardless of where nodes will eventually be placed on the canvas. The graph adapter checks socket contracts and refuses loss-prone exports.

## Example

The checked-in [Project / Task sample](../examples/project-query.json) contains a Project AND with a `Tasks.Any` collection. The main graph operates on `Predicate<Project>`; opening Tasks switches to `Predicate<Task>`. Runtime parameters remain in the separate binding object, not in graph layout.

The same metadata model supports Customer / Order without customizing the editor. Catalog authorization and validation continue to happen in the backend, not in this preview.

## Test and release gate

Run `node --test tests/ExpressionForge.Editor.Tests/*.test.cjs` and the regular .NET 10 CI suite. Graph tests cover fixture round-trips, temporary identity, optional logical subgraphs, scope transitions, input ordering, disconnected nodes and invalid connections.

This change belongs to **v0.4.0 development**. The visible product/package version remains unchanged until the complete release milestones pass.

## Next increments

1. Replace the preview layout with a pan/zoom free-form canvas and persisted editor-only positions.
2. Add actual interactive socket connections, insertion, undo/redo and typed metadata palette.
3. Extend UI tests for keyboard, pointer, navigation and invalid intermediate states.
4. Publish interactive, CI-verified Blueprint examples on GitHub Pages.
