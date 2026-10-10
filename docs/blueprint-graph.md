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

## Increment 3 — Guided and Blueprint predicate editing

Both editor modes use one immutable AST command layer (`graph-edit.js`), not a second query format.

- The **Guided editor** offers a metadata-derived *Add condition* selector for logical groups. Newly inserted predicates are connected automatically to the group.
- The **Blueprint toolbar** adds fields, collections, AND/OR groups and NOT predicates. The active subgraph determines the entity scope; adding into a single predicate wraps it in an AND without discarding the existing expression.
- The **node chevron** opens a small inline inspector for field/operator/scalar or runtime parameter, AND/OR operator, and collection quantifier.
- **Typed predicate sockets** allow a user to choose an existing source output and then a compatible AND/OR input to atomically reattach that source. No temporary invalid graph is emitted. A source with no alternative parent cannot be disconnected if that would empty its group. Cycles and cross-entity moves are rejected.
- New editing commands are applied to immutable clones and reprojected into the existing graph. Backend metadata remains an input to validation and is not an authorization boundary; API validation/compilation remains authoritative.
- The existing query AST v1, ID semantics, saved runtime bindings, and SQL compiler are unchanged.

This increment does **not** yet offer drawing wires by dragging sockets, arbitrary disconnected intermediate nodes, undo/redo, or a full browser automation suite. These remain deliberate follow-up milestones.

## Next increments

1. Add drag-to-connect, richer insertion/removal, and undo/redo transaction history.
2. Add browser-level pointer/keyboard and accessibility interaction tests.
3. Publish CI-verified complex Blueprint demonstrations on GitHub Pages.


## Increment 4 — Gesture editing and transaction history

A v1 query expression remains an AST tree. Nodes do not become independent executable objects just because the UI supports free dragging.

- **Drag-to-connect:** drag from a predicate output to an AND/OR input in the same graph. The editor previews a wire and highlights candidate input sockets. On drop it calls the immutable AST reconnect command, which rejects cross-scope connections, cycles and invalid orphaning. Clicking sockets remains a keyboard-friendly alternative.
- **Insert on a wire:** each connection provides a small (+) action. Users can wrap the existing predicate in NOT or combine it with a metadata-approved comparison using a new AND/OR group. The existing predicate (including its ID and runtime parameter) is retained without silently changing SQL semantics.
- **Delete:** remove a predicate subtree only if it belongs to a group with more than one child. Deleting the root or leaving an empty group is rejected, and subtree deletion requires confirmation. Undo restores the subtree.
- **Undo and redo:** snapshots cover AST edits, runtime bindings and canvas layout. History is capped at 60 transactions, redoing is invalidated by a new edit, and catalog/entity switching resets the history boundary. Navigation alone is not a transaction. When text input is focused, browser-native text undo remains available.
- **No AST format change:** editor gestures, history and presentation state never enter the query JSON or API requests.

### Remaining acceptance gates

Browser-level drag/keyboard/viewport integration and accessibility tests, richer operation examples on Pages, and full v0.4.0 release validation remain future work.


## Increment 5 — Live Pages preview & Chromium acceptance

- GitHub Pages publishes [the actual Blueprint editor](https://matrtech.github.io/ExpressionForge/blueprint.html) using the exact `app.js` and graph/metadata modules shipped with the .NET web app. The deployment build copies the canonical files; tests enforce byte-for-byte parity.
- The browser demo loads the checked-in Project/Task catalog and query fixture. It does not emulate a SQL compiler or claim to provide live backend authorization, validation, or query execution. Those buttons are disabled in the static demo.
- Dedicated Chromium acceptance tests use Playwright to exercise boot, guided Add Condition, undo/redo, node dragging, keyboard movement, mobile viewport, collection subgraph navigation and insertion on a connection.
- CI also starts the actual .NET API and checks that the editor can request and receive real parameterized SQL compilation, while the existing Testcontainers suite tests SQL Server semantics.
- On the static showcase all editing operates locally in the browser. Canonical JSON stays separate from local layout and runtime parameter state.

### Browser development checks

Run `node scripts/prepare-blueprint-demo.cjs`, then serve `site/` using a local static HTTP server. For browser acceptance run `node --test tests/ExpressionForge.Browser.Tests/*.test.cjs` with Playwright/Chromium installed and the .NET API running on `127.0.0.1:5054`. The CI pipeline configures both servers and browsers automatically.

This is a **development preview** until all CI checks pass and the release is explicitly tagged; GitHub Pages cannot replace the .NET compiler for real SQL.


## First-run walkthrough

A shared, versioned `onboarding.js` module introduces the editor when a catalog is ready. The static Pages showcase waits for its Project/Task fixture to be fully imported before opening the first-run tour.

- Welcome: optional tour with **Not now**.
- Guided editor: metadata-powered condition selection and automatic connection.
- Blueprint: arranging nodes, panning and zooming without changing AST semantics.
- Node chevron and sockets: editing and typed connections.
- Collections: navigating to child entity scopes and returning with breadcrumbs.
- Output: portable AST, undo/redo, and the .NET-only validation/compile capabilities.

The tour is **informational**. It never adds predicates, changes node positions, sends API calls, or edits runtime bindings. Switching between the existing Guided and Blueprint modes is visual only. `Escape`, **Skip tour**, or **Finish** dismisses the overlay. **? Tutorial** always reopens it. Completion/dismissal uses localStorage key `expressionforge:first-run-tour:v1`, with a session-only fallback when storage is unavailable. Responsive layout and keyboard interactions are covered by Chromium tests.

The UI and the Pages demo use identical canonical onboarding source, and Pages deployment is refreshed automatically when the shared editor source changes.
