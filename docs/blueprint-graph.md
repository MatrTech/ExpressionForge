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

## Increment 2 — Free-form Blueprint canvas

The Blueprint mode now provides a **freely arrangeable, read-only query graph**. Guided mode remains the default for editing query semantics. The graph shows curved predicate connections and offers:

- Drag any node to move it; drag empty space to pan.
- Scroll/pinch-compatible wheel gestures and explicit +/- buttons to zoom around the pointer or canvas center.
- **Fit** to center every node, or **Reset layout** to restore deterministic positions.
- Arrow keys move a focused node 10 world pixels; Shift + Arrow keys move it 40 pixels.
- Breadcrumbs open AND/OR and collection subgraphs, with an independent viewport and node layout for each.
- Layout is stored locally per **catalog and root entity** in browser localStorage with a versioned key. Missing or unavailable storage degrades to session-only state.

**Contract boundary:** node positions and camera state are never added to AST v1, to runtime parameters, or to API requests. Moving nodes only changes presentation. No socket editing, drag-to-connect, semantic undo/redo, or shared cross-device layout yet. Query execution and validation still use the backend AST.

This increment intentionally doesn't change query semantics, the .NET packages, or the current released version.

## Next increments

1. Add interactive socket connections, insertion, undo/redo and the typed metadata palette.
2. Extend browser-level interaction tests for pointer and keyboard navigation.
3. Publish CI-verified complex Blueprint examples on GitHub Pages.
