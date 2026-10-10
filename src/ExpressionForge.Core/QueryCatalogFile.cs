using System.Text.Json;

namespace ExpressionForge.Core;

/// <summary>Loads trusted server-side catalog mappings from a local JSON file, never from a query request.</summary>
public static class QueryCatalogFile
{
    public static QueryCatalog Load(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        return LoadJson(File.ReadAllText(path));
    }

    public static QueryCatalog LoadJson(string json)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(json);
        var document = JsonSerializer.Deserialize<CatalogFileDefinition>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("Catalog configuration is empty.");
        if (document.Entities is null) throw new InvalidOperationException("Catalog configuration requires entities.");

        var builder = new QueryCatalogBuilder();
        foreach (var op in QueryCatalog.StandardOperators) builder.AddOperator(op);
        foreach (var entity in document.Entities)
        {
            if (entity is null) throw new InvalidOperationException("Catalog contains a null entity.");
            var properties = entity.Properties?.Select(p =>
                new PropertyMetadata(p.Id, p.DisplayName, p.DataType, p.Nullable, p.Operators)).ToArray()
                ?? throw new InvalidOperationException($"Entity '{entity.Id}' requires properties.");
            var relationships = entity.Relationships?.Select(r =>
                new RelationshipMetadata(r.Id, r.DisplayName, r.TargetEntity, r.ParentKey, r.ChildForeignKey)).ToArray()
                ?? throw new InvalidOperationException($"Entity '{entity.Id}' requires relationships.");
            builder.AddEntity(new EntityMetadata(entity.Id, entity.DisplayName, properties, relationships, entity.Schema, entity.Table));
        }
        return builder.Build();
    }

    private sealed record CatalogFileDefinition(IReadOnlyList<CatalogEntityDefinition> Entities);
    private sealed record CatalogEntityDefinition(string Id, string DisplayName, string Schema, string Table,
        IReadOnlyList<CatalogPropertyDefinition> Properties, IReadOnlyList<CatalogRelationshipDefinition> Relationships);
    private sealed record CatalogPropertyDefinition(string Id, string DisplayName, string DataType, bool Nullable,
        IReadOnlyList<string> Operators);
    private sealed record CatalogRelationshipDefinition(string Id, string DisplayName, string TargetEntity, string ParentKey,
        string ChildForeignKey);
}
