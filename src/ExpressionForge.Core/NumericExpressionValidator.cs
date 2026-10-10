using System.Text.Json;

namespace ExpressionForge.Core;

internal static class NumericExpressionValidator
{
    internal const decimal MaximumLiteral = 1_000_000_000_000m;
    internal static readonly string[] Comparisons =
    [
        "equals", "notEquals", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"
    ];
    internal static readonly string[] Operations = ["add", "subtract", "multiply", "divide"];

    internal static void Validate(ArithmeticComparisonExpression expression, EntityMetadata entity, string path,
        int depth, ref int count, Dictionary<string, string> parameterTypes,
        IReadOnlyDictionary<string, JsonElement>? parameters, List<QueryIssue> issues)
    {
        if (!Comparisons.Contains(expression.Operator, StringComparer.Ordinal))
            issues.Add(new(path + ".operator", "invalidOperator", "Unsupported numeric comparison operator.", expression.Id));
        ValidateValue(expression.Left, entity, path + ".left", depth + 1, ref count, expression.Id, parameterTypes, parameters, issues);
        ValidateValue(expression.Right, entity, path + ".right", depth + 1, ref count, expression.Id, parameterTypes, parameters, issues);
    }

    private static void ValidateValue(NumericValueExpression? value, EntityMetadata entity, string path, int depth,
        ref int count, string? owner, Dictionary<string, string> parameterTypes,
        IReadOnlyDictionary<string, JsonElement>? parameters, List<QueryIssue> issues)
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
                if (!ValidDecimal(json))
                {
                    issues.Add(new(path + ".value", "invalidValueType",
                        "Arithmetic literals must be numbers within ±1e12 and have at most six decimal places.", owner));
                }
                break;
            case NumericParameterExpression parameter:
                if (parameter.Parameter is null || parameter.Parameter.Length is < 1 or > 64 ||
                    !parameter.Parameter.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-'))
                {
                    issues.Add(new(path + ".parameter", "invalidParameterName",
                        "Numeric parameter names must be 1-64 ASCII letters, digits, '-' or '_'.", owner));
                    break;
                }

                if (parameterTypes.TryGetValue(parameter.Parameter, out var existingType) && existingType != "decimal")
                {
                    issues.Add(new(path + ".parameter", "conflictingParameterType",
                        $"Parameter '{parameter.Parameter}' is already used with '{existingType}', not decimal.", owner));
                    break;
                }

                parameterTypes.TryAdd(parameter.Parameter, "decimal");
                if (parameters is null || !parameters.TryGetValue(parameter.Parameter, out var binding))
                {
                    issues.Add(new(path + ".parameter", "missingParameter",
                        $"Missing numeric binding '{parameter.Parameter}'.", owner));
                }
                else if (!ValidDecimal(binding))
                {
                    issues.Add(new(path + ".value", "invalidValueType",
                        "Runtime numeric values must be within ±1e12 and have at most six decimal places.", owner));
                }
                break;
            case NumericBinaryExpression binary:
                if (!Operations.Contains(binary.Operator, StringComparer.Ordinal))
                    issues.Add(new(path + ".operator", "invalidOperator", "Supported arithmetic: add, subtract, multiply, divide.", owner));
                ValidateValue(binary.Left, entity, path + ".left", depth + 1, ref count, owner, parameterTypes, parameters, issues);
                ValidateValue(binary.Right, entity, path + ".right", depth + 1, ref count, owner, parameterTypes, parameters, issues);
                break;
            default:
                issues.Add(new(path, "unknownExpression", "Unsupported numeric expression type.", owner));
                break;
        }
    }
    internal static bool ValidDecimal(JsonElement json) =>
        json.ValueKind == JsonValueKind.Number && json.TryGetDecimal(out var number) &&
        number >= -MaximumLiteral && number <= MaximumLiteral && decimal.Round(number, 6) == number;

}
