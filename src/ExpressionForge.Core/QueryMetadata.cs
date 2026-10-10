using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ExpressionForge.Core;

public sealed record PropertyMetadata(
    string Id,
    string DisplayName,
    string DataType,
    bool Nullable,
    IReadOnlyList<string> Operators);

public sealed record RelationshipMetadata(
    string Id,
    string DisplayName,
    string TargetEntity,
    [property: JsonIgnore] string ParentKey,
    [property: JsonIgnore] string ChildForeignKey);

public sealed record EntityMetadata(
    string Id,
    string DisplayName,
    IReadOnlyList<PropertyMetadata> Properties,
    IReadOnlyList<RelationshipMetadata> Relationships,
    [property: JsonIgnore] string Schema,
    [property: JsonIgnore] string Table);

public sealed record OperatorMetadata(string Id, string DisplayName, IReadOnlyList<string> SupportedTypes, bool RequiresValue);

public sealed class QueryCatalog
{
    public string Version { get; } = "0.2.0";
    // Opaque hash of logical metadata and SQL mappings, independent of registration order.
    public string Revision { get; }
    public IReadOnlyList<EntityMetadata> Entities { get; }
    public IReadOnlyList<OperatorMetadata> Operators { get; }

    public QueryCatalog(IReadOnlyList<EntityMetadata> entities, IReadOnlyList<OperatorMetadata> operators)
    {
        Entities = entities;
        Operators = operators;
        Revision = CalculateRevision(entities, operators);
    }

    private static string CalculateRevision(IReadOnlyList<EntityMetadata> entities, IReadOnlyList<OperatorMetadata> operators)
    {
        var canonical = new
        {
            Entities = entities.OrderBy(e => e.Id, StringComparer.Ordinal).Select(e => new
            {
                e.Id, e.DisplayName, e.Schema, e.Table,
                Properties = e.Properties.OrderBy(p => p.Id, StringComparer.Ordinal).Select(p => new
                {
                    p.Id, p.DisplayName, p.DataType, p.Nullable,
                    Operators = p.Operators.OrderBy(id => id, StringComparer.Ordinal).ToArray()
                }).ToArray(),
                Relationships = e.Relationships.OrderBy(r => r.Id, StringComparer.Ordinal).Select(r => new
                {
                    r.Id, r.DisplayName, r.TargetEntity, r.ParentKey, r.ChildForeignKey
                }).ToArray()
            }).ToArray(),
            Operators = operators.OrderBy(o => o.Id, StringComparer.Ordinal).Select(o => new
            {
                o.Id, o.DisplayName, o.RequiresValue,
                SupportedTypes = o.SupportedTypes.OrderBy(type => type, StringComparer.Ordinal).ToArray()
            }).ToArray()
        };
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(canonical));
        return "sha256:" + Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }

    public EntityMetadata? FindEntity(string? id) => Entities.FirstOrDefault(e => string.Equals(e.Id, id, StringComparison.Ordinal));

    public static QueryCatalog CreateDemo()
    {
        string[] stringOps = ["equals", "notEquals", "contains", "startsWith", "endsWith", "isNull", "isNotNull"];
        string[] numberOps = ["equals", "notEquals", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "isNull", "isNotNull"];
        string[] booleanOps = ["equals", "notEquals", "isNull", "isNotNull"];
        var entities = new List<EntityMetadata>
        {
            new("Customer", "Customers",
            [
                new("Id", "ID", "integer", false, numberOps),
                new("FirstName", "First name", "string", false, stringOps),
                new("Age", "Age", "integer", false, numberOps),
                new("IsActive", "Active", "boolean", false, booleanOps)
            ],
            [new("Orders", "Orders", "Order", "Id", "CustomerId")],
            "dbo", "Customers"),
            new("Order", "Orders",
            [
                new("Id", "ID", "integer", false, numberOps),
                new("CustomerId", "Customer ID", "integer", false, numberOps),
                new("Total", "Total", "decimal", false, numberOps),
                new("Status", "Status", "string", false, stringOps)
            ],
            [], "dbo", "Orders")
        };
        var builder = new QueryCatalogBuilder();
        foreach (var entity in entities) builder.AddEntity(entity);
        foreach (var op in StandardOperators) builder.AddOperator(op);
        return builder.Build();
    }

    public static IReadOnlyList<OperatorMetadata> StandardOperators { get; } = Array.AsReadOnly(new OperatorMetadata[]
        {
            new("equals", "Equals", ["string", "integer", "decimal", "boolean"], true),
            new("notEquals", "Not equals", ["string", "integer", "decimal", "boolean"], true),
            new("contains", "Contains", ["string"], true),
            new("startsWith", "Starts with", ["string"], true),
            new("endsWith", "Ends with", ["string"], true),
            new("greaterThan", "Greater than", ["integer", "decimal"], true),
            new("greaterThanOrEqual", "Greater than or equal", ["integer", "decimal"], true),
            new("lessThan", "Less than", ["integer", "decimal"], true),
            new("lessThanOrEqual", "Less than or equal", ["integer", "decimal"], true),
            new("isNull", "Is null", ["string", "integer", "decimal", "boolean"], false),
            new("isNotNull", "Is not null", ["string", "integer", "decimal", "boolean"], false)
    });

}
