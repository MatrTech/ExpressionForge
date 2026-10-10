using System.Text.Json;

namespace ExpressionForge.Core;

public sealed record QueryIssue(string Path, string Code, string Message);

public sealed record QueryValidationResult(IReadOnlyList<QueryIssue> Issues)
{
    public bool IsValid => Issues.Count == 0;
}

public sealed class QueryValidator(QueryCatalog catalog)
{
    public const int MaximumDepth = 16;
    public const int MaximumNodes = 256;

    public QueryValidationResult Validate(QueryDefinition? definition)
    {
        var issues = new List<QueryIssue>();
        if (definition is null)
        {
            issues.Add(new("$", "required", "A query definition is required."));
            return new(issues);
        }

        if (definition.Version != 1)
            issues.Add(new("$.version", "unsupportedVersion", "Only query version 1 is supported."));

        var entity = catalog.FindEntity(definition.Entity);
        if (entity is null)
            issues.Add(new("$.entity", "unknownEntity", $"Unknown query entity '{definition.Entity}'."));
        if (definition.Query is null)
            issues.Add(new("$.query", "required", "The root expression is required."));

        if (entity is not null && definition.Query is not null)
        {
            var count = 0;
            Visit(definition.Query, entity, "$.query", 1, ref count, issues);
        }
        return new(issues);
    }

    private void Visit(QueryExpression expression, EntityMetadata entity, string path, int depth, ref int count, List<QueryIssue> issues)
    {
        count++;
        if (count > MaximumNodes)
        {
            if (count == MaximumNodes + 1)
                issues.Add(new(path, "tooManyNodes", $"Queries may contain at most {MaximumNodes} nodes."));
            return;
        }
        if (depth > MaximumDepth)
        {
            issues.Add(new(path, "tooDeep", $"Expression nesting cannot exceed {MaximumDepth} levels."));
            return;
        }

        switch (expression)
        {
            case ComparisonExpression comparison:
                ValidateComparison(comparison, entity, path, issues);
                break;
            case GroupExpression group:
                if (group.Operator is not ("and" or "or"))
                    issues.Add(new(path + ".operator", "invalidOperator", "Group operator must be 'and' or 'or'."));
                if (group.Expressions is null || group.Expressions.Count == 0)
                {
                    issues.Add(new(path + ".expressions", "emptyGroup", "A group must contain at least one expression."));
                    break;
                }
                for (var i = 0; i < group.Expressions.Count; i++)
                {
                    if (group.Expressions[i] is null)
                        issues.Add(new($"{path}.expressions[{i}]", "required", "An expression cannot be null."));
                    else
                        Visit(group.Expressions[i], entity, $"{path}.expressions[{i}]", depth + 1, ref count, issues);
                }
                break;
            case CollectionExpression collection:
                var relationship = entity.Relationships.FirstOrDefault(r => r.Id == collection.Collection);
                if (relationship is null)
                {
                    issues.Add(new(path + ".collection", "unknownCollection", $"Unknown collection '{collection.Collection}' on '{entity.Id}'."));
                    break;
                }
                if (collection.Quantifier is not ("any" or "all" or "none"))
                    issues.Add(new(path + ".quantifier", "invalidQuantifier", "Supported quantifiers are any, all and none."));
                var target = catalog.FindEntity(relationship.TargetEntity);
                if (target is null)
                    issues.Add(new(path + ".collection", "missingEntity", $"Relationship target '{relationship.TargetEntity}' is not registered."));
                if (collection.Expression is null)
                    issues.Add(new(path + ".expression", "required", "A collection predicate is required."));
                if (target is not null && collection.Expression is not null)
                    Visit(collection.Expression, target, path + ".expression", depth + 1, ref count, issues);
                break;
            case NotExpression not:
                if (not.Expression is null)
                    issues.Add(new(path + ".expression", "required", "A negated expression is required."));
                else
                    Visit(not.Expression, entity, path + ".expression", depth + 1, ref count, issues);
                break;
            default:
                issues.Add(new(path, "unknownExpression", "Unsupported expression type."));
                break;
        }
    }

    private static void ValidateComparison(ComparisonExpression expression, EntityMetadata entity, string path, List<QueryIssue> issues)
    {
        var field = entity.Properties.FirstOrDefault(p => p.Id == expression.Field);
        if (field is null)
        {
            issues.Add(new(path + ".field", "unknownField", $"Unknown field '{expression.Field}' on '{entity.Id}'."));
            return;
        }
        if (!field.Operators.Contains(expression.Operator, StringComparer.Ordinal))
        {
            issues.Add(new(path + ".operator", "invalidOperator", $"Operator '{expression.Operator}' is not valid for '{field.Id}'."));
            return;
        }
        if (expression.Operator is "isNull" or "isNotNull")
            return;

        var value = expression.Value;
        var isValid = field.DataType switch
        {
            "string" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length <= 1024,
            "integer" => value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out _),
            "decimal" => value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out _),
            "boolean" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
            _ => false
        };
        if (!isValid)
            issues.Add(new(path + ".value", "invalidValueType", $"Expected a valid '{field.DataType}' value for '{field.Id}'."));
    }
}
