namespace ExpressionForge.Core;

/// <summary>Metadata available to a visual editor at a specific AST path; SQL mappings remain hidden.</summary>
public sealed record QueryExpressionScope(
    string Path,
    string EntityId,
    string? NodeId,
    string? FieldType,
    IReadOnlyList<PropertyMetadata> Properties,
    IReadOnlyList<RelationshipMetadata> Relationships);

public sealed record QueryScopeResolution(
    string CatalogRevision,
    IReadOnlyList<QueryExpressionScope> Scopes,
    IReadOnlyList<QueryIssue> Issues)
{
    public bool IsValid => Issues.Count == 0;
}

/// <summary>
/// Resolves entity and field types through nested collections; structural discovery
/// does not replace QueryValidator's operator, value and runtime binding validation.
/// </summary>
public sealed class QueryScopeResolver(QueryCatalog catalog)
{
    public QueryScopeResolution Resolve(QueryDefinition? definition)
    {
        var scopes = new List<QueryExpressionScope>();
        var issues = new List<QueryIssue>();
        if (definition is null)
        {
            issues.Add(new("$", "required", "A query definition is required."));
            return new(catalog.Revision, scopes, issues);
        }
        if (definition.Version != 1)
            issues.Add(new("$.version", "unsupportedVersion", "Only query version 1 is supported."));
        if (definition.CatalogRevision is not null && !string.Equals(definition.CatalogRevision, catalog.Revision, StringComparison.Ordinal))
            issues.Add(new("$.catalogRevision", "catalogRevisionMismatch", "The query targets an outdated metadata catalog revision."));

        var root = catalog.FindEntity(definition.Entity);
        if (root is null)
            issues.Add(new("$.entity", "unknownEntity", $"Unknown query entity '{definition.Entity}'."));
        if (definition.Query is null)
            issues.Add(new("$.query", "required", "The root expression is required."));
        if (root is not null && definition.Query is not null)
        {
            var nodes = 0;
            Visit(definition.Query, root, "$.query", 1, ref nodes, scopes, issues);
        }
        return new(catalog.Revision, scopes, issues);
    }

    private void Visit(QueryExpression expression, EntityMetadata entity, string path, int depth, ref int nodes,
        List<QueryExpressionScope> scopes, List<QueryIssue> issues)
    {
        nodes++;
        if (nodes > QueryValidator.MaximumNodes)
        {
            if (nodes == QueryValidator.MaximumNodes + 1)
                issues.Add(new(path, "tooManyNodes", $"Queries may contain at most {QueryValidator.MaximumNodes} nodes.", expression.Id));
            return;
        }
        if (depth > QueryValidator.MaximumDepth)
        {
            issues.Add(new(path, "tooDeep", $"Expression nesting cannot exceed {QueryValidator.MaximumDepth} levels.", expression.Id));
            return;
        }

        var fieldType = expression is ComparisonExpression candidate
            ? entity.Properties.FirstOrDefault(p => p.Id == candidate.Field)?.DataType
            : null;
        scopes.Add(new(path, entity.Id, expression.Id, fieldType, entity.Properties, entity.Relationships));
        switch (expression)
        {
            case ComparisonExpression comparison when fieldType is null:
                issues.Add(new(path + ".field", "unknownField", $"Unknown field '{comparison.Field}' on '{entity.Id}'.", expression.Id));
                break;
            case GroupExpression group:
                if (group.Expressions is null || group.Expressions.Count == 0)
                {
                    issues.Add(new(path + ".expressions", "emptyGroup", "A group must contain at least one expression.", expression.Id));
                    break;
                }
                for (var i = 0; i < group.Expressions.Count; i++)
                {
                    var childPath = $"{path}.expressions[{i}]";
                    if (group.Expressions[i] is null)
                        issues.Add(new(childPath, "required", "An expression cannot be null."));
                    else
                        Visit(group.Expressions[i], entity, childPath, depth + 1, ref nodes, scopes, issues);
                }
                break;
            case NotExpression not:
                if (not.Expression is null)
                    issues.Add(new(path + ".expression", "required", "A negated expression is required.", expression.Id));
                else
                    Visit(not.Expression, entity, path + ".expression", depth + 1, ref nodes, scopes, issues);
                break;
            case CollectionExpression collection:
                var relationship = entity.Relationships.FirstOrDefault(r => r.Id == collection.Collection);
                if (relationship is null)
                {
                    issues.Add(new(path + ".collection", "unknownCollection", $"Unknown collection '{collection.Collection}' on '{entity.Id}'.", expression.Id));
                    break;
                }
                var target = catalog.FindEntity(relationship.TargetEntity);
                if (target is null)
                {
                    issues.Add(new(path + ".collection", "missingEntity", $"Relationship target '{relationship.TargetEntity}' is not registered.", expression.Id));
                    break;
                }
                if (collection.Expression is null)
                    issues.Add(new(path + ".expression", "required", "A collection predicate is required.", expression.Id));
                else
                    Visit(collection.Expression, target, path + ".expression", depth + 1, ref nodes, scopes, issues);
                break;
        }
    }
}
