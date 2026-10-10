using System.Text.Json;
using System.Text.Json.Serialization;

namespace ExpressionForge.Core;

public sealed record QueryDefinition
{
    public int Version { get; init; } = 1;
    public required string Entity { get; init; }
    public required QueryExpression Query { get; init; }
}

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(ComparisonExpression), "expression")]
[JsonDerivedType(typeof(GroupExpression), "group")]
[JsonDerivedType(typeof(CollectionExpression), "collectionExpression")]
[JsonDerivedType(typeof(NotExpression), "not")]
public abstract record QueryExpression
{
    // Stable editor identity; not part of query semantics or SQL compilation.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Id { get; init; }
}

public sealed record ComparisonExpression : QueryExpression
{
    public required string Field { get; init; }
    public required string Operator { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public JsonElement Value { get; init; }

    // References a named runtime binding supplied separately from the saved definition.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Parameter { get; init; }
}

public sealed record GroupExpression : QueryExpression
{
    public required string Operator { get; init; }
    public required List<QueryExpression> Expressions { get; init; }
}

public sealed record CollectionExpression : QueryExpression
{
    public required string Collection { get; init; }
    public required string Quantifier { get; init; }
    public required QueryExpression Expression { get; init; }
}

public sealed record NotExpression : QueryExpression
{
    public required QueryExpression Expression { get; init; }
}
