# Runtime parameters (v0.2.0 development)

A saved query is a **definition**, not a set of runtime values. A comparison can specify either `value` (literal) or `parameter` (binding name), never both.

## Example

The definition:

```json
{
  "version": 1,
  "entity": "Customer",
  "query": {
    "type": "expression",
    "id": "age-threshold",
    "field": "Age",
    "operator": "greaterThan",
    "parameter": "minimumAge"
  }
}
```

At execution time send a separate parameter dictionary:

```http
POST /api/query/compile/bound?limit=25
Content-Type: application/json
```

```json
{
  "definition": {
    "version": 1,
    "entity": "Customer",
    "query": {
      "type": "expression",
      "id": "age-threshold",
      "field": "Age",
      "operator": "greaterThan",
      "parameter": "minimumAge"
    }
  },
  "parameters": {
    "minimumAge": 18
  }
}
```

The compiler resolves `minimumAge` against the field's metadata type, validates it and emits a typed SQL parameter (not interpolated SQL).

The new endpoints are:

- `POST /api/query/validate/bound`
- `POST /api/query/compile/bound?limit=25`
- `POST /api/query/preview/bound?limit=25`

The original literal-only endpoints remain supported. The `/bound` endpoints require a JSON object containing `definition` and `parameters`.

## Semantics

- Parameter names must be 1–64 ASCII letters, digits, underscores or hyphens.
- A missing runtime binding yields `missingParameter`.
- Invalid runtime value types yield `invalidValueType`.
- Literal and parameter supplied together yield `ambiguousValue`.
- Null comparisons use `isNull` and `isNotNull` (rather than binding JSON null to `equals`).
- The same name may be referenced multiple times. Each occurrence is compiled with the data type of the referenced field.
- No parameter value is interpolated into SQL text.
- Definitions remain JSON version 1 and can still be serialized independently of runtime bindings.

## Next work

The visual editor will expose a separate runtime-parameters panel. This milestone still requires SQL Server Testcontainers integration coverage, particularly null semantics and collection quantifiers.
