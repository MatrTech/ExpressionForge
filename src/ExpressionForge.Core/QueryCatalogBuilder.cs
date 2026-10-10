using System.Text.RegularExpressions;

namespace ExpressionForge.Core;

/// <summary>Registers trusted server-side entity mappings and validates the catalog before queries can use it.</summary>
public sealed class QueryCatalogBuilder
{
    private static readonly HashSet<string> SupportedTypes = ["string", "integer", "decimal", "boolean"];
    private static readonly Regex SqlIdentifier = new("^[A-Za-z_][A-Za-z0-9_]{0,127}$", RegexOptions.CultureInvariant);
    private readonly List<EntityMetadata> _entities = [];
    private readonly List<OperatorMetadata> _operators = [];

    public QueryCatalogBuilder AddEntity(EntityMetadata entity)
    {
        ArgumentNullException.ThrowIfNull(entity);
        _entities.Add(entity);
        return this;
    }

    public QueryCatalogBuilder AddOperator(OperatorMetadata metadata)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        _operators.Add(metadata);
        return this;
    }

    public QueryCatalog Build()
    {
        var entityIds = new HashSet<string>(StringComparer.Ordinal);
        var operatorIds = new HashSet<string>(StringComparer.Ordinal);
        if (_entities.Count == 0) throw new InvalidOperationException("A catalog must register at least one entity.");
        if (_operators.Count == 0) throw new InvalidOperationException("A catalog must register operators.");

        foreach (var op in _operators)
        {
            RequireIdentifier(op.Id, "Operator ID");
            if (!operatorIds.Add(op.Id)) throw new InvalidOperationException($"Duplicate operator '{op.Id}'.");
            if (string.IsNullOrWhiteSpace(op.DisplayName)) throw new InvalidOperationException($"Operator '{op.Id}' requires a display name.");
            if (op.SupportedTypes is null || op.SupportedTypes.Count == 0 || op.SupportedTypes.Any(type => !SupportedTypes.Contains(type)))
                throw new InvalidOperationException($"Operator '{op.Id}' has unsupported data types.");
            if (!StandardOperators.TryGetValue(op.Id, out var expected) || expected.RequiresValue != op.RequiresValue ||
                !op.SupportedTypes.All(expected.SupportedTypes.Contains))
                throw new InvalidOperationException($"Operator '{op.Id}' has no matching SQL compiler semantics.");
        }

        foreach (var entity in _entities)
        {
            RequireIdentifier(entity.Id, "Entity ID");
            RequireIdentifier(entity.Schema, "SQL schema");
            RequireIdentifier(entity.Table, "SQL table");
            if (!entityIds.Add(entity.Id)) throw new InvalidOperationException($"Duplicate entity '{entity.Id}'.");
            if (string.IsNullOrWhiteSpace(entity.DisplayName)) throw new InvalidOperationException($"Entity '{entity.Id}' requires a display name.");
            if (entity.Properties is null || entity.Properties.Count == 0)
                throw new InvalidOperationException($"Entity '{entity.Id}' must expose at least one property.");
            var properties = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in entity.Properties)
            {
                RequireIdentifier(property.Id, "Property ID");
                if (!properties.Add(property.Id)) throw new InvalidOperationException($"Duplicate property '{entity.Id}.{property.Id}'.");
                if (string.IsNullOrWhiteSpace(property.DisplayName)) throw new InvalidOperationException($"Property '{entity.Id}.{property.Id}' requires a display name.");
                if (!SupportedTypes.Contains(property.DataType))
                    throw new InvalidOperationException($"Property '{entity.Id}.{property.Id}' has unsupported type '{property.DataType}'.");
                if (property.Operators is null || property.Operators.Count == 0 || property.Operators.Distinct(StringComparer.Ordinal).Count() != property.Operators.Count)
                    throw new InvalidOperationException($"Property '{entity.Id}.{property.Id}' requires distinct operators.");
                foreach (var operatorId in property.Operators)
                {
                    var op = _operators.FirstOrDefault(item => item.Id == operatorId);
                    if (op is null || !op.SupportedTypes.Contains(property.DataType, StringComparer.Ordinal))
                        throw new InvalidOperationException($"Operator '{operatorId}' is not registered for '{entity.Id}.{property.Id}'.");
                }
            }
            if (entity.Relationships is null) throw new InvalidOperationException($"Entity '{entity.Id}' has no relationship collection.");
            var relationships = new HashSet<string>(StringComparer.Ordinal);
            foreach (var relationship in entity.Relationships)
            {
                RequireIdentifier(relationship.Id, "Relationship ID");
                RequireIdentifier(relationship.ParentKey, "Parent join key");
                RequireIdentifier(relationship.ChildForeignKey, "Child join key");
                if (!relationships.Add(relationship.Id))
                    throw new InvalidOperationException($"Duplicate relationship '{entity.Id}.{relationship.Id}'.");
                if (string.IsNullOrWhiteSpace(relationship.DisplayName))
                    throw new InvalidOperationException($"Relationship '{entity.Id}.{relationship.Id}' requires a display name.");
            }
        }

        foreach (var entity in _entities)
        {
            foreach (var relationship in entity.Relationships)
            {
                var target = _entities.FirstOrDefault(item => item.Id == relationship.TargetEntity);
                if (target is null)
                    throw new InvalidOperationException($"Relationship '{entity.Id}.{relationship.Id}' targets unregistered entity '{relationship.TargetEntity}'.");
                var parentKey = entity.Properties.FirstOrDefault(item => item.Id == relationship.ParentKey);
                var childKey = target.Properties.FirstOrDefault(item => item.Id == relationship.ChildForeignKey);
                if (parentKey is null || childKey is null || parentKey.DataType != childKey.DataType)
                    throw new InvalidOperationException($"Relationship '{entity.Id}.{relationship.Id}' requires matching registered join-key types.");
            }
        }

        var operators = Array.AsReadOnly(_operators.Select(op => op with { SupportedTypes = Array.AsReadOnly(op.SupportedTypes.ToArray()) }).ToArray());
        var entities = Array.AsReadOnly(_entities.Select(entity => entity with
        {
            Properties = Array.AsReadOnly(entity.Properties.Select(property => property with
            {
                Operators = Array.AsReadOnly(property.Operators.ToArray())
            }).ToArray()),
            Relationships = Array.AsReadOnly(entity.Relationships.ToArray())
        }).ToArray());
        return new QueryCatalog(entities, operators);
    }

    private static void RequireIdentifier(string? identifier, string label)
    {
        if (identifier is null || !SqlIdentifier.IsMatch(identifier))
            throw new InvalidOperationException($"{label} must be 1-128 ASCII letters, digits or underscores, beginning with a letter or underscore.");
    }

    private static readonly IReadOnlyDictionary<string, OperatorMetadata> StandardOperators =
        QueryCatalog.StandardOperators.ToDictionary(op => op.Id, StringComparer.Ordinal);
}
