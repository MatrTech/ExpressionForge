using System.Data;
using System.Text.Json;
using System.Text.Json.Nodes;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class DynamicCatalogTests
{
    private static string CatalogPath => Path.Combine(AppContext.BaseDirectory, "project-catalog.json");
    private static string QueryPath => Path.Combine(AppContext.BaseDirectory, "project-query.json");

    [TestMethod]
    public void Load_CustomCatalog_ExposesTypedEntitiesAndRelationships()
    {
        var catalog = QueryCatalogFile.Load(CatalogPath);
        Assert.AreEqual(2, catalog.Entities.Count);
        var project = catalog.FindEntity("Project")!;
        Assert.AreEqual("Projects", project.DisplayName);
        Assert.AreEqual("decimal", project.Properties.Single(p => p.Id == "Budget").DataType);
        Assert.AreEqual("Task", project.Relationships.Single().TargetEntity);
        Assert.IsNull(catalog.FindEntity("Customer"));
    }

    [TestMethod]
    public void Compile_CustomCatalog_UsesRegisteredTablesAndTypedParameters()
    {
        var catalog = QueryCatalogFile.Load(CatalogPath);
        using var json = JsonDocument.Parse(File.ReadAllText(QueryPath));
        var definition = JsonSerializer.Deserialize<QueryDefinition>(json.RootElement.GetProperty("definition"), ExpressionForgeJson.CreateOptions())!;
        var bindings = json.RootElement.GetProperty("parameters").EnumerateObject().ToDictionary(
            p => p.Name, p => p.Value.Clone(), StringComparer.Ordinal);
        var validator = new QueryValidator(catalog);
        Assert.IsTrue(validator.Validate(definition, bindings).IsValid);
        var plan = new SqlServerQueryCompiler(catalog, validator).Compile(definition, 10, bindings);

        StringAssert.Contains(plan.Sql, "FROM [dbo].[Projects] AS [t0]");
        StringAssert.Contains(plan.Sql, "FROM [dbo].[Tasks] AS [t1]");
        StringAssert.Contains(plan.Sql, "[t1].[ProjectId] = [t0].[Id]");
        Assert.AreEqual(DbType.Decimal, plan.Parameters[2].DbType);
        Assert.AreEqual(10000m, plan.Parameters[2].Value);
        Assert.AreEqual(12m, plan.Parameters[4].Value);
    }

    [TestMethod]
    public void Serialize_CustomCatalog_DoesNotExposeSqlMappings()
    {
        var json = JsonSerializer.Serialize(QueryCatalogFile.Load(CatalogPath).Entities, ExpressionForgeJson.CreateOptions());
        Assert.IsFalse(json.Contains("parentKey", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(json.Contains("childForeignKey", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(json.Contains("schema", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(json.Contains("table", StringComparison.OrdinalIgnoreCase));
    }

    [TestMethod]
    public void Load_UnknownOperator_RejectsCatalog()
    {
        var json = ReadCatalog();
        json["entities"]![0]!["properties"]![0]!["operators"]![0] = "executeSql";
        StringAssert.Contains(Assert.ThrowsException<InvalidOperationException>(() => QueryCatalogFile.LoadJson(json.ToJsonString())).Message,
            "not registered");
    }

    [TestMethod]
    public void Load_UnsafeSqlTableName_RejectsCatalog()
    {
        var json = ReadCatalog();
        json["entities"]![0]!["table"] = "Projects]; DROP TABLE Tasks;--";
        StringAssert.Contains(Assert.ThrowsException<InvalidOperationException>(() => QueryCatalogFile.LoadJson(json.ToJsonString())).Message,
            "SQL table");
    }

    [TestMethod]
    public void Load_DuplicateEntity_RejectsCatalog()
    {
        var json = ReadCatalog();
        json["entities"]![1]!["id"] = "Project";
        StringAssert.Contains(Assert.ThrowsException<InvalidOperationException>(() => QueryCatalogFile.LoadJson(json.ToJsonString())).Message,
            "Duplicate entity");
    }

    [TestMethod]
    public void Load_UnregisteredRelationshipTarget_RejectsCatalog()
    {
        var json = ReadCatalog();
        json["entities"]![0]!["relationships"]![0]!["targetEntity"] = "Unknown";
        StringAssert.Contains(Assert.ThrowsException<InvalidOperationException>(() => QueryCatalogFile.LoadJson(json.ToJsonString())).Message,
            "unregistered entity");
    }

    [TestMethod]
    public void Load_IncompatibleRelationshipKeyTypes_RejectsCatalog()
    {
        var json = ReadCatalog();
        json["entities"]![1]!["properties"]![1]!["dataType"] = "string";
        json["entities"]![1]!["properties"]![1]!["operators"] = JsonSerializer.SerializeToNode(new[] { "equals" });
        StringAssert.Contains(Assert.ThrowsException<InvalidOperationException>(() => QueryCatalogFile.LoadJson(json.ToJsonString())).Message,
            "matching registered join-key types");
    }

    [TestMethod]
    public void Load_DateFieldsWithoutScalarOperators_EnablesMetadataSafeDateDifferences()
    {
        var json = ReadCatalog();
        var fields = json["entities"]![1]!["properties"]!.AsArray();
        foreach (var id in new[] { "StartedAt", "FinishedAt" })
            fields.Add(new JsonObject
            {
                ["id"] = id, ["displayName"] = id, ["dataType"] = "date", ["nullable"] = true,
                ["operators"] = new JsonArray()
            });
        var catalog = QueryCatalogFile.LoadJson(json.ToJsonString());
        Assert.AreEqual("date", catalog.FindEntity("Task")!.Properties.Single(p => p.Id == "StartedAt").DataType);
        Assert.AreEqual(0, catalog.FindEntity("Task")!.Properties.Single(p => p.Id == "StartedAt").Operators.Count);
        var query = new QueryDefinition
        {
            Entity = "Project",
            Query = new CollectionExpression
            {
                Collection = "Tasks", Quantifier = "any",
                Expression = new ArithmeticComparisonExpression
                {
                    Left = new DateDiffDaysExpression { StartField = "StartedAt", EndField = "FinishedAt" },
                    Operator = "greaterThan",
                    Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(7) }
                }
            }
        };
        var validator = new QueryValidator(catalog);
        Assert.IsTrue(validator.Validate(query).IsValid);
        var plan = new SqlServerQueryCompiler(catalog, validator).Compile(query);
        StringAssert.Contains(plan.Sql, "DATEDIFF(day, [t1].[StartedAt], [t1].[FinishedAt])");
    }

    [TestMethod]
    public void Load_DateTimeFieldsAreAllowedButUnimplementedScalarOperatorsAreRejected()
    {
        var json = ReadCatalog();
        var fields = json["entities"]![1]!["properties"]!.AsArray();
        fields.Add(new JsonObject
        {
            ["id"] = "RecordedAt", ["displayName"] = "Recorded", ["dataType"] = "dateTime",
            ["nullable"] = true, ["operators"] = new JsonArray()
        });
        Assert.IsNotNull(QueryCatalogFile.LoadJson(json.ToJsonString()).FindEntity("Task"));
        fields[^1]!["operators"] = JsonSerializer.SerializeToNode(new[] { "equals" });
        StringAssert.Contains(Assert.ThrowsException<InvalidOperationException>(() =>
            QueryCatalogFile.LoadJson(json.ToJsonString())).Message, "not registered");
    }

    [TestMethod]
    public void Load_NonDateFieldsStillRequireAtLeastOneRegisteredOperator()
    {
        var json = ReadCatalog();
        json["entities"]![0]!["properties"]![0]!["operators"] = new JsonArray();
        StringAssert.Contains(Assert.ThrowsException<InvalidOperationException>(() =>
            QueryCatalogFile.LoadJson(json.ToJsonString())).Message, "distinct operators");
    }

    [TestMethod]
    public void Build_AfterSourceListMutation_PreservesRegisteredSnapshot()
    {
        var fields = new List<PropertyMetadata> { new("Id", "ID", "integer", false, ["equals"]) };
        var builder = new QueryCatalogBuilder().AddEntity(new EntityMetadata("Thing", "Things", fields, [], "dbo", "Things"));
        foreach (var op in QueryCatalog.StandardOperators) builder.AddOperator(op);
        var catalog = builder.Build();
        fields.Add(new PropertyMetadata("Injected", "Injected", "string", false, ["equals"]));
        builder.AddEntity(new EntityMetadata("Other", "Other", fields, [], "dbo", "Other"));

        Assert.AreEqual(1, catalog.Entities.Count);
        Assert.AreEqual(1, catalog.Entities[0].Properties.Count);
    }

    private static JsonNode ReadCatalog() => JsonNode.Parse(File.ReadAllText(CatalogPath))!;
}
