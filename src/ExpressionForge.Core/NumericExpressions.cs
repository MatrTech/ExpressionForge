using System.Text.Json;
using System.Text.Json.Serialization;

namespace ExpressionForge.Core;

/// <summary>A numeric value tree. Every node evaluates to decimal(28,6) in SQL Server.</summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(NumericFieldExpression), "numericField")]
[JsonDerivedType(typeof(NumericLiteralExpression), "numericLiteral")]
[JsonDerivedType(typeof(NumericParameterExpression), "numericParameter")]
[JsonDerivedType(typeof(NumericBinaryExpression), "numericBinary")]
[JsonDerivedType(typeof(StringLengthExpression), "stringLength")]
[JsonDerivedType(typeof(DateDiffDaysExpression), "dateDiffDays")]
public abstract record NumericValueExpression;

public sealed record NumericFieldExpression : NumericValueExpression
{
    public required string Field { get; init; }
}

public sealed record NumericLiteralExpression : NumericValueExpression
{
    public JsonElement Value { get; init; }
}

/// <summary>Named decimal runtime binding supplied separately from the saved query definition.</summary>
public sealed record NumericParameterExpression : NumericValueExpression
{
    public required string Parameter { get; init; }
}

public sealed record NumericBinaryExpression : NumericValueExpression
{
    public required string Operator { get; init; }
    public required NumericValueExpression Left { get; init; }
    public required NumericValueExpression Right { get; init; }
}

/// <summary>Returns SQL Server LEN(field), excluding trailing U+0020 spaces and preserving NULL.</summary>
public sealed record StringLengthExpression : NumericValueExpression
{
    public required string Field { get; init; }
}

/// <summary>Returns signed calendar-day boundaries between two date/datetime fields in one scope.</summary>
public sealed record DateDiffDaysExpression : NumericValueExpression
{
    public required string StartField { get; init; }
    public required string EndField { get; init; }
}

/// <summary>Compares two numerical expressions in the current entity/collection scope.</summary>
public sealed record ArithmeticComparisonExpression : QueryExpression
{
    public required NumericValueExpression Left { get; init; }
    public required string Operator { get; init; }
    public required NumericValueExpression Right { get; init; }
}
