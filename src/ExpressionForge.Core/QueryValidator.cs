using System.Text.Json;

namespace ExpressionForge.Core;

public sealed record QueryIssue(string Path, string Code, string Message, string? NodeId = null);

public sealed record QueryValidationResult(IReadOnlyList<QueryIssue> Issues)
{
    public bool IsValid => Issues.Count == 0;
}

public sealed class QueryValidator(QueryCatalog catalog)
{
    public const int MaximumDepth = 16;
    public const int MaximumNodes = 256;

    public QueryValidationResult Validate(QueryDefinition? definition, IReadOnlyDictionary<string, JsonElement>? parameters = null)
    {
        var issues = new List<QueryIssue>();
        if (definition is null)
        {
            issues.Add(new("$", "required", "A query definition is required."));
            return new(issues);
        }

        if (definition.Version != 1)
            issues.Add(new("$.version", "unsupportedVersion", "Only query version 1 is supported."));
        if (definition.CatalogRevision is not null && !string.Equals(definition.CatalogRevision, catalog.Revision, StringComparison.Ordinal))
            issues.Add(new("$.catalogRevision", "catalogRevisionMismatch", "The query targets an outdated metadata catalog revision."));

        var entity = catalog.FindEntity(definition.Entity);
        if (entity is null)
            issues.Add(new("$.entity", "unknownEntity", $"Unknown query entity '{definition.Entity}'."));
        if (definition.Query is null)
            issues.Add(new("$.query", "required", "The root expression is required."));

        if (entity is not null && definition.Query is not null)
        {
            var count = 0;
            var identifiers = new HashSet<string>(StringComparer.Ordinal);
            var parameterTypes = new Dictionary<string, string>(StringComparer.Ordinal);
            Visit(definition.Query, entity, "$.query", 1, ref count, identifiers, parameterTypes, parameters, issues);
        }
        return new(issues);
    }

    private void Visit(QueryExpression expression, EntityMetadata entity, string path, int depth, ref int count,
        HashSet<string> identifiers, Dictionary<string, string> parameterTypes,
        IReadOnlyDictionary<string, JsonElement>? parameters, List<QueryIssue> issues)
    {
        var issueStart = issues.Count;
        VisitCore(expression, entity, path, depth, ref count, identifiers, parameterTypes, parameters, issues);
        // The deepest node assigns its identity first, so parent nodes only claim their own diagnostics.
        for (var i = issueStart; i < issues.Count; i++)
        {
            if (issues[i].NodeId is null && expression.Id is not null && IsLocalIssue(issues[i], path))
                issues[i] = issues[i] with { NodeId = expression.Id };
        }
    }

    private static bool IsLocalIssue(QueryIssue issue, string path)
    {
        if (issue.Path == path) return true;
        if (!issue.Path.StartsWith(path + ".", StringComparison.Ordinal)) return false;
        var member = issue.Path[(path.Length + 1)..];
        if (member.Contains('.') || member.Contains('[')) return false;
        return member switch
        {
            "id" => issue.Code is "invalidNodeId" or "duplicateNodeId",
            "field" => issue.Code == "unknownField",
            "leftField" or "rightField" => issue.Code == "unknownField",
            "operator" => issue.Code == "invalidOperator",
            "value" => issue.Code is "invalidValueType" or "unexpectedValue",
            "parameter" => issue.Code is "invalidParameterName" or "missingParameter" or "unexpectedParameter" or "conflictingParameterType",
            "expressions" => issue.Code == "emptyGroup",
            "collection" => issue.Code is "unknownCollection" or "missingEntity",
            "quantifier" => issue.Code == "invalidQuantifier",
            "expression" => issue.Code == "required",
            _ => false
        };
    }

    private void VisitCore(QueryExpression expression, EntityMetadata entity, string path, int depth, ref int count,
        HashSet<string> identifiers, Dictionary<string, string> parameterTypes,
        IReadOnlyDictionary<string, JsonElement>? parameters, List<QueryIssue> issues)
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

        if (expression.Id is not null)
        {
            if (expression.Id.Length is < 1 or > 64 || !expression.Id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
                issues.Add(new(path + ".id", "invalidNodeId", "Node IDs must be 1-64 ASCII letters, digits, '-' or '_'."));
            else if (!identifiers.Add(expression.Id))
                issues.Add(new(path + ".id", "duplicateNodeId", $"Duplicate node ID '{expression.Id}'."));
        }

        switch (expression)
        {
            case ComparisonExpression comparison:
                ValidateComparison(comparison, entity, path, parameterTypes, parameters, issues);
                break;
            case FieldComparisonExpression fieldComparison:
                ValidateFieldComparison(fieldComparison, entity, path, issues);
                break;
            case ArithmeticComparisonExpression arithmetic:
                NumericExpressionValidator.Validate(arithmetic, entity, path, depth, ref count, parameterTypes, parameters, issues);
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
                        Visit(group.Expressions[i], entity, $"{path}.expressions[{i}]", depth + 1, ref count, identifiers, parameterTypes, parameters, issues);
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
                    Visit(collection.Expression, target, path + ".expression", depth + 1, ref count, identifiers, parameterTypes, parameters, issues);
                break;
            case NotExpression not:
                if (not.Expression is null)
                    issues.Add(new(path + ".expression", "required", "A negated expression is required."));
                else
                    Visit(not.Expression, entity, path + ".expression", depth + 1, ref count, identifiers, parameterTypes, parameters, issues);
                break;
            default:
                issues.Add(new(path, "unknownExpression", "Unsupported expression type."));
                break;
        }
    }

    private static readonly HashSet<string> FieldEqualityOperators = new(StringComparer.Ordinal)
    {
        "equals", "notEquals"
    };

    private static readonly HashSet<string> FieldNumericOperators = new(StringComparer.Ordinal)
    {
        "equals", "notEquals", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"
    };

    private static void ValidateFieldComparison(FieldComparisonExpression expression, EntityMetadata entity, string path,
        List<QueryIssue> issues)
    {
        var left = entity.Properties.FirstOrDefault(p => p.Id == expression.LeftField);
        var right = entity.Properties.FirstOrDefault(p => p.Id == expression.RightField);
        if (left is null)
            issues.Add(new(path + ".leftField", "unknownField", $"Unknown left field '{expression.LeftField}' on '{entity.Id}'."));
        if (right is null)
            issues.Add(new(path + ".rightField", "unknownField", $"Unknown right field '{expression.RightField}' on '{entity.Id}'."));
        if (left is null || right is null) return;
        if (!string.Equals(left.DataType, right.DataType, StringComparison.Ordinal))
        {
            issues.Add(new(path + ".rightField", "incompatibleFieldTypes",
                $"Fields '{left.Id}' and '{right.Id}' must have identical types."));
            return;
        }

        var permitted = left.DataType is "integer" or "decimal" ? FieldNumericOperators : FieldEqualityOperators;
        if (!permitted.Contains(expression.Operator) ||
            !left.Operators.Contains(expression.Operator, StringComparer.Ordinal) ||
            !right.Operators.Contains(expression.Operator, StringComparer.Ordinal))
        {
            issues.Add(new(path + ".operator", "invalidOperator",
                $"Operator '{expression.Operator}' is not permitted for a comparison between '{left.Id}' and '{right.Id}'."));
        }
    }

    private static void ValidateComparison(ComparisonExpression expression, EntityMetadata entity, string path,
        Dictionary<string, string> parameterTypes, IReadOnlyDictionary<string, JsonElement>? parameters, List<QueryIssue> issues)
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
        {
            if (expression.Parameter is not null)
                issues.Add(new(path + ".parameter", "unexpectedParameter", "Null checks cannot reference runtime parameters."));
            if (expression.Value.ValueKind != JsonValueKind.Undefined)
                issues.Add(new(path + ".value", "unexpectedValue", "Null checks cannot include a literal value."));
            return;
        }

        if (expression.Parameter is not null && expression.Value.ValueKind != JsonValueKind.Undefined)
        {
            issues.Add(new(path, "ambiguousValue", "Specify either 'value' or 'parameter', not both."));
            return;
        }

        var value = expression.Value;
        if (expression.Parameter is not null)
        {
            if (expression.Parameter.Length is < 1 or > 64 ||
                !expression.Parameter.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-'))
            {
                issues.Add(new(path + ".parameter", "invalidParameterName", "Parameter names must be 1-64 ASCII letters, digits, '-' or '_'."));
                return;
            }

            if (parameterTypes.TryGetValue(expression.Parameter, out var existingType) && existingType != field.DataType)
            {
                issues.Add(new(path + ".parameter", "conflictingParameterType",
                    $"Runtime parameter '{expression.Parameter}' is used with incompatible types '{existingType}' and '{field.DataType}'."));
                return;
            }
            parameterTypes.TryAdd(expression.Parameter, field.DataType);

            if (parameters is null || !parameters.TryGetValue(expression.Parameter, out value))
            {
                issues.Add(new(path + ".parameter", "missingParameter", $"Missing runtime parameter '{expression.Parameter}'."));
                return;
            }
        }
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
