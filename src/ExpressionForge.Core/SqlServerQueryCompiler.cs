using System.Data;
using System.Text.Json;

namespace ExpressionForge.Core;

public sealed record QueryParameter(string Name, DbType DbType, object Value);
public sealed record ResultColumn(string Name, string DataType, bool Nullable);
public sealed record SqlQueryPlan(string Sql, IReadOnlyList<QueryParameter> Parameters, IReadOnlyList<ResultColumn> Columns);

public sealed class QueryValidationException(IReadOnlyList<QueryIssue> issues) : Exception("Query validation failed.")
{
    public IReadOnlyList<QueryIssue> Issues { get; } = issues;
}

public sealed class SqlServerQueryCompiler(QueryCatalog catalog, QueryValidator validator)
{
    public const int MaximumRows = 100;

    public SqlQueryPlan Compile(QueryDefinition definition, int limit = 25, IReadOnlyDictionary<string, JsonElement>? parameters = null)
    {
        if (limit is < 1 or > MaximumRows)
            throw new ArgumentOutOfRangeException(nameof(limit), $"Result limit must be between 1 and {MaximumRows}.");
        var validation = validator.Validate(definition, parameters);
        if (!validation.IsValid)
            throw new QueryValidationException(validation.Issues);

        var entity = catalog.FindEntity(definition.Entity)!;
        var state = new CompilationState(parameters);
        state.Parameters.Add(new("@take", DbType.Int32, limit));
        var columns = entity.Properties.Select(p => new ResultColumn(p.Id, p.DataType, p.Nullable)).ToArray();
        var projection = string.Join(", ", entity.Properties.Select(p => $"[t0].{Quote(p.Id)} AS {Quote(p.Id)}"));
        var filter = BuildPredicate(definition.Query, entity, "t0", state);
        var sql = $"SELECT TOP (@take) {projection}\nFROM {TableName(entity)} AS [t0]\nWHERE {filter};";
        return new(sql, state.Parameters, columns);
    }

    private string BuildPredicate(QueryExpression expression, EntityMetadata entity, string alias, CompilationState state) => expression switch
    {
        ComparisonExpression comparison => BuildComparison(comparison, entity, alias, state),
        GroupExpression group => "(" + string.Join(group.Operator == "and" ? " AND " : " OR ",
            group.Expressions.Select(child => BuildPredicate(child, entity, alias, state))) + ")",
        CollectionExpression collection => BuildCollection(collection, entity, alias, state),
        NotExpression not => $"(NOT ({BuildPredicate(not.Expression, entity, alias, state)}))",
        _ => throw new NotSupportedException("Unexpected expression type.")
    };

    private string BuildComparison(ComparisonExpression expression, EntityMetadata entity, string alias, CompilationState state)
    {
        var field = entity.Properties.Single(p => p.Id == expression.Field);
        var left = $"[{alias}].{Quote(field.Id)}";
        if (expression.Operator == "isNull") return $"({left} IS NULL)";
        if (expression.Operator == "isNotNull") return $"({left} IS NOT NULL)";

        var suppliedValue = expression.Parameter is null ? expression.Value : state.Bindings![expression.Parameter];
        object value = field.DataType switch
        {
            "string" => suppliedValue.GetString()!,
            "integer" => suppliedValue.GetInt32(),
            "decimal" => suppliedValue.GetDecimal(),
            "boolean" => suppliedValue.GetBoolean(),
            _ => throw new NotSupportedException($"Unsupported type: {field.DataType}")
        };
        if (expression.Operator is "contains" or "startsWith" or "endsWith")
        {
            var escaped = EscapeLike((string)value);
            value = expression.Operator switch
            {
                "contains" => $"%{escaped}%",
                "startsWith" => $"{escaped}%",
                _ => $"%{escaped}"
            };
        }
        var parameter = $"@p{state.Parameters.Count - 1}";
        state.Parameters.Add(new(parameter, field.DataType switch
        {
            "integer" => DbType.Int32,
            "decimal" => DbType.Decimal,
            "boolean" => DbType.Boolean,
            _ => DbType.String
        }, value));
        if (expression.Operator is "contains" or "startsWith" or "endsWith")
            return $"({left} LIKE {parameter} ESCAPE '~')";
        var op = expression.Operator switch
        {
            "equals" => "=", "notEquals" => "<>", "greaterThan" => ">", "greaterThanOrEqual" => ">=",
            "lessThan" => "<", "lessThanOrEqual" => "<=",
            _ => throw new NotSupportedException($"Unsupported operator: {expression.Operator}")
        };
        return $"({left} {op} {parameter})";
    }

    private string BuildCollection(CollectionExpression collection, EntityMetadata parent, string parentAlias, CompilationState state)
    {
        var relationship = parent.Relationships.Single(r => r.Id == collection.Collection);
        var child = catalog.FindEntity(relationship.TargetEntity)!;
        var childAlias = $"t{++state.NextAlias}";
        var join = $"[{childAlias}].{Quote(relationship.ChildForeignKey)} = [{parentAlias}].{Quote(relationship.ParentKey)}";
        var predicate = BuildPredicate(collection.Expression, child, childAlias, state);
        var matching = collection.Quantifier == "all" ? $"(CASE WHEN {predicate} THEN 1 ELSE 0 END = 0)" : predicate;
        var exists = $"EXISTS (SELECT 1 FROM {TableName(child)} AS [{childAlias}] WHERE {join} AND {matching})";
        return collection.Quantifier == "any" ? $"({exists})" : $"(NOT {exists})";
    }

    private static string EscapeLike(string value) => value.Replace("~", "~~", StringComparison.Ordinal)
        .Replace("%", "~%", StringComparison.Ordinal).Replace("_", "~_", StringComparison.Ordinal)
        .Replace("[", "~[", StringComparison.Ordinal);

    private static string Quote(string identifier) => "[" + identifier.Replace("]", "]]", StringComparison.Ordinal) + "]";
    private static string TableName(EntityMetadata entity) => $"{Quote(entity.Schema)}.{Quote(entity.Table)}";

    private sealed class CompilationState(IReadOnlyDictionary<string, JsonElement>? bindings)
    {
        public IReadOnlyDictionary<string, JsonElement>? Bindings { get; } = bindings;
        public int NextAlias { get; set; }
        public List<QueryParameter> Parameters { get; } = [];
    }
}
