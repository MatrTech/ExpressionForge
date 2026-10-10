using System.Text.Json;

namespace ExpressionForge.Core;

internal static class NumericExpressionValidator
{
    internal const decimal MaximumLiteral = 1_000_000_000_000m;
    internal static readonly string[] Comparisons =
    [
        "equals", "notEquals", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"
    ];
    internal static readonly string[] Operations = ["add", "subtract", "multiply"];

    internal static void Validate(ArithmeticComparisonExpression expression, EntityMetadata entity, string path,
        int depth, ref int count, List<QueryIssue> issues)
    {
        if (!Comparisons.Contains(expression.Operator, StringComparer.Ordinal))
            issues.Add(new(path + ".operator", "invalidOperator", "Unsupported numeric comparison operator.", expression.Id));
        ValidateValue(expression.Left, entity, path + ".left", depth + 1, ref count, expression.Id, issues);
        ValidateValue(expression.Right, entity, path + ".right", depth + 1, ref count, expression.Id, issues);
    }

    private static void ValidateValue(NumericValueExpression? value, EntityMetadata entity, string path, int depth,
        ref int count, string? owner, List<QueryIssue> issues)
    {
        if (value is null)
        {
            issues.Add(new(path, "required", "A numeric value expression is required.", owner));
            return;
        }

        count++;
        if (count > QueryValidator.MaximumNodes)
        {
            if (count == QueryValidator.MaximumNodes + 1)
                issues.Add(new(path, "tooManyNodes", "Numeric expressions exceed the node limit.", owner));
            return;
        }
        if (depth > QueryValidator.MaximumDepth)
        {
            issues.Add(new(path, "tooDeep", "Numeric expression nesting exceeds the depth limit.", owner));
            return;
        }

        switch (value)
        {
            case NumericFieldExpression field:
                var property = entity.Properties.FirstOrDefault(p => p.Id == field.Field);
                if (property is null)
                    issues.Add(new(path + ".field", "unknownField", "Unknown or inaccessible numeric field.", owner));
                else if (property.DataType is not ("integer" or "decimal"))
                    issues.Add(new(path + ".field", "invalidValueType", "Arithmetic requires a numeric field.", owner));
                break;
            case NumericLiteralExpression literal:
                var json = literal.Value;
                if (json.ValueKind != JsonValueKind.Number || !json.TryGetDecimal(out var number) ||
                    number < -MaximumLiteral || number > MaximumLiteral ||
                    decimal.Round(number, 6) != number)
                {
                    issues.Add(new(path + ".value", "invalidValueType",
                        "Arithmetic literals must be numbers within ±1e12 and have at most six decimal places.", owner));
                }
                break;
            case NumericBinaryExpression binary:
                if (!Operations.Contains(binary.Operator, StringComparer.Ordinal))
                    issues.Add(new(path + ".operator", "invalidOperator", "Supported arithmetic: add, subtract, multiply.", owner));
                ValidateValue(binary.Left, entity, path + ".left", depth + 1, ref count, owner, issues);
                ValidateValue(binary.Right, entity, path + ".right", depth + 1, ref count, owner, issues);
                break;
            default:
                issues.Add(new(path, "unknownExpression", "Unsupported numeric expression type.", owner));
                break;
        }
    }
}
