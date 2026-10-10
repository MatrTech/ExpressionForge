using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class QueryScopeResolverTests
{
    private static string CatalogPath => Path.Combine(AppContext.BaseDirectory, "project-catalog.json");
    private static string QueryPath => Path.Combine(AppContext.BaseDirectory, "project-query.json");

    [TestMethod]
    public void Revision_RepeatedCatalogLoad_ReturnsSameFingerprint()
    {
        var first = QueryCatalogFile.Load(CatalogPath);
        var second = QueryCatalogFile.Load(CatalogPath);
        Assert.AreEqual(first.Revision, second.Revision);
        Assert.IsTrue(first.Revision.StartsWith("sha256:", StringComparison.Ordinal));
        Assert.AreEqual(71, first.Revision.Length);
    }

    [TestMethod]
    public void Revision_ReorderedEntitiesAndProperties_RemainsStable()
    {
        var first = QueryCatalog.CreateDemo();
        var builder = new QueryCatalogBuilder();
        foreach (var entity in first.Entities.Reverse())
            builder.AddEntity(entity with { Properties = entity.Properties.Reverse().ToArray(), Relationships = entity.Relationships.Reverse().ToArray() });
        foreach (var op in first.Operators.Reverse()) builder.AddOperator(op);
        Assert.AreEqual(first.Revision, builder.Build().Revision);
    }

    [TestMethod]
    public void Revision_ChangedSqlMapping_ChangesFingerprint()
    {
        var first = QueryCatalog.CreateDemo();
        var builder = new QueryCatalogBuilder();
        foreach (var entity in first.Entities)
            builder.AddEntity(entity.Id == "Order" ? entity with { Table = "ArchivedOrders" } : entity);
        foreach (var op in first.Operators) builder.AddOperator(op);
        Assert.AreNotEqual(first.Revision, builder.Build().Revision);
    }

    [TestMethod]
    public void Validate_MismatchedRevision_RejectsQueryBeforeCompilation()
    {
        var catalog = QueryCatalog.CreateDemo();
        var definition = new QueryDefinition
        {
            Entity = "Customer",
            CatalogRevision = "sha256:stale",
            Query = new ComparisonExpression { Field = "Age", Operator = "equals", Value = JsonSerializer.SerializeToElement(30) }
        };
        var validator = new QueryValidator(catalog);
        var result = validator.Validate(definition);
        Assert.IsTrue(result.Issues.Any(issue => issue.Code == "catalogRevisionMismatch" && issue.Path == "$.catalogRevision"));
        Assert.ThrowsException<QueryValidationException>(() => new SqlServerQueryCompiler(catalog, validator).Compile(definition));
    }

    [TestMethod]
    public void Validate_NoRevision_PreservesAstV1Compatibility()
    {
        var catalog = QueryCatalog.CreateDemo();
        var definition = new QueryDefinition
        {
            Entity = "Customer",
            Query = new ComparisonExpression { Field = "Age", Operator = "equals", Value = JsonSerializer.SerializeToElement(30) }
        };
        Assert.IsTrue(new QueryValidator(catalog).Validate(definition).IsValid);
        Assert.IsFalse(JsonSerializer.Serialize(definition, ExpressionForgeJson.CreateOptions()).Contains("catalogRevision", StringComparison.Ordinal));
    }

    [TestMethod]
    public void Resolve_ProjectTasksNestedScopes_ResolvesCorrectFieldTypes()
    {
        var catalog = QueryCatalogFile.Load(CatalogPath);
        using var json = JsonDocument.Parse(File.ReadAllText(QueryPath));
        var definition = JsonSerializer.Deserialize<QueryDefinition>(json.RootElement.GetProperty("definition"), ExpressionForgeJson.CreateOptions())!;
        var result = new QueryScopeResolver(catalog).Resolve(definition);
        Assert.IsTrue(result.IsValid, string.Join("; ", result.Issues.Select(issue => issue.Message)));
        Assert.AreEqual(catalog.Revision, result.CatalogRevision);
        Assert.AreEqual("Project", result.Scopes[0].EntityId);
        var taskScopes = result.Scopes.Where(scope => scope.EntityId == "Task").ToArray();
        Assert.IsTrue(taskScopes.Length >= 3);
        Assert.IsTrue(taskScopes.Any(scope => scope.FieldType == "decimal"));
        Assert.IsTrue(taskScopes.Any(scope => scope.FieldType == "string"));
        Assert.IsTrue(taskScopes.All(scope => scope.Path.Contains(".expression", StringComparison.Ordinal)));
    }

    [TestMethod]
    public void Resolve_NestedNotAndCollection_PreservesEntityBoundary()
    {
        var definition = new QueryDefinition
        {
            Entity = "Customer",
            Query = new NotExpression
            {
                Expression = new CollectionExpression
                {
                    Collection = "Orders", Quantifier = "none",
                    Expression = new ComparisonExpression { Field = "Total", Operator = "greaterThan", Value = JsonSerializer.SerializeToElement(50) }
                }
            }
        };
        var result = new QueryScopeResolver(QueryCatalog.CreateDemo()).Resolve(definition);
        Assert.IsTrue(result.IsValid);
        Assert.AreEqual(3, result.Scopes.Count);
        Assert.AreEqual("Customer", result.Scopes[1].EntityId);
        Assert.AreEqual("Order", result.Scopes[2].EntityId);
        Assert.AreEqual("decimal", result.Scopes[2].FieldType);
    }

    [TestMethod]
    public void Resolve_UnknownCollection_ReturnsStructuredIssue()
    {
        var definition = new QueryDefinition
        {
            Entity = "Customer",
            Query = new CollectionExpression
            {
                Id = "node_1", Collection = "NotVisible", Quantifier = "any",
                Expression = new ComparisonExpression { Field = "Total", Operator = "equals", Value = JsonSerializer.SerializeToElement(1) }
            }
        };
        var result = new QueryScopeResolver(QueryCatalog.CreateDemo()).Resolve(definition);
        Assert.IsFalse(result.IsValid);
        Assert.AreEqual("unknownCollection", result.Issues.Single().Code);
        Assert.AreEqual("node_1", result.Issues.Single().NodeId);
    }

    [TestMethod]
    public void Resolve_SerializedScopes_NeverExposePhysicalSqlMapping()
    {
        var definition = new QueryDefinition
        {
            Entity = "Customer",
            Query = new CollectionExpression
            {
                Collection = "Orders", Quantifier = "any",
                Expression = new ComparisonExpression { Field = "Total", Operator = "equals", Value = JsonSerializer.SerializeToElement(1) }
            }
        };
        var json = JsonSerializer.Serialize(new QueryScopeResolver(QueryCatalog.CreateDemo()).Resolve(definition), ExpressionForgeJson.CreateOptions());
        Assert.IsFalse(json.Contains("parentKey", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(json.Contains("childForeignKey", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(json.Contains("\"schema\"", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(json.Contains("\"table\"", StringComparison.OrdinalIgnoreCase));
    }

    [TestMethod]
    public void Resolve_TooDeepTree_EnforcesMaximumDepth()
    {
        QueryExpression query = new ComparisonExpression { Field = "Age", Operator = "equals", Value = JsonSerializer.SerializeToElement(1) };
        for (var i = 0; i < QueryValidator.MaximumDepth; i++)
            query = new NotExpression { Expression = query };
        var result = new QueryScopeResolver(QueryCatalog.CreateDemo()).Resolve(new QueryDefinition { Entity = "Customer", Query = query });
        Assert.IsTrue(result.Issues.Any(issue => issue.Code == "tooDeep"));
    }
}
