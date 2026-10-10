using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class FieldComparisonTests
{
    private static readonly QueryCatalog Catalog = QueryCatalog.CreateDemo();
    private static QueryValidator Validator => new(Catalog);

    private static QueryDefinition Parse(string predicate) => JsonSerializer.Deserialize<QueryDefinition>(
        "{\"version\":1,\"entity\":\"Customer\",\"query\":" + predicate + "}",
        ExpressionForgeJson.CreateOptions())!;

    [TestMethod]
    public void Deserialize_FieldComparison_PreservesAstV1AndNodeIdentity()
    {
        var definition = Parse("""
            {"type":"fieldComparison","id":"compare-1","leftField":"Id","operator":"lessThan","rightField":"Age"}
            """);
        var predicate = (FieldComparisonExpression)definition.Query;
        Assert.AreEqual("compare-1", predicate.Id);
        Assert.AreEqual("Id", predicate.LeftField);
        Assert.AreEqual("Age", predicate.RightField);
        Assert.IsTrue(Validator.Validate(definition).IsValid);
        var json = JsonSerializer.Serialize(definition, ExpressionForgeJson.CreateOptions());
        StringAssert.Contains(json, "\"type\":\"fieldComparison\"");
        StringAssert.Contains(json, "\"rightField\":\"Age\"");
    }

    [TestMethod]
    public void Compile_NumericFields_UsesApprovedColumnIdentifiersAndNoExtraParameters()
    {
        var definition = Parse("""
            {"type":"fieldComparison","leftField":"Id","operator":"lessThan","rightField":"Age"}
            """);
        var plan = new SqlServerQueryCompiler(Catalog, Validator).Compile(definition);
        StringAssert.Contains(plan.Sql, "([t0].[Id] < [t0].[Age])");
        Assert.AreEqual(1, plan.Parameters.Count);
        Assert.AreEqual("@take", plan.Parameters[0].Name);
    }

    [TestMethod]
    public void Validate_CrossTypeFields_ReportsTypeMismatch()
    {
        var definition = Parse("""
            {"type":"fieldComparison","leftField":"Id","operator":"equals","rightField":"FirstName"}
            """);
        var issue = Validator.Validate(definition).Issues.Single();
        Assert.AreEqual("incompatibleFieldTypes", issue.Code);
        Assert.AreEqual("$.query.rightField", issue.Path);
        Assert.ThrowsException<QueryValidationException>(() =>
            new SqlServerQueryCompiler(Catalog, Validator).Compile(definition));
    }

    [TestMethod]
    public void Validate_UnknownFields_ReportsBothSidesWithNodeIdentity()
    {
        var definition = Parse("""
            {"type":"fieldComparison","id":"bad-1","leftField":"DROP TABLE","operator":"equals","rightField":"PrivateData"}
            """);
        var issues = Validator.Validate(definition).Issues;
        Assert.AreEqual(2, issues.Count);
        CollectionAssert.AreEquivalent(new[] { "$.query.leftField", "$.query.rightField" },
            issues.Select(issue => issue.Path).ToArray());
        Assert.IsTrue(issues.All(issue => issue.Code == "unknownField" && issue.NodeId == "bad-1"));
    }

    [TestMethod]
    public void Validate_InvalidOperator_RejectsNonComparisonAndNullOperators()
    {
        foreach (var op in new[] { "startsWith", "isNull", "contains" })
        {
            var definition = Parse($$"""
                {"type":"fieldComparison","leftField":"Id","operator":"{{op}}","rightField":"Age"}
                """);
            Assert.AreEqual("invalidOperator", Validator.Validate(definition).Issues.Single().Code);
        }
    }

    [TestMethod]
    public void Compile_CollectionFieldComparison_PreservesChildAlias()
    {
        var definition = Parse("""
            {"type":"collectionExpression","collection":"Orders","quantifier":"any","expression":{
              "type":"fieldComparison","leftField":"Id","operator":"greaterThan","rightField":"CustomerId"
            }}
            """);
        Assert.IsTrue(Validator.Validate(definition).IsValid);
        var plan = new SqlServerQueryCompiler(Catalog, Validator).Compile(definition);
        StringAssert.Contains(plan.Sql, "([t1].[Id] > [t1].[CustomerId])");
        Assert.AreEqual(1, plan.Parameters.Count);
        var scoped = new QueryScopeResolver(Catalog).Resolve(definition);
        Assert.IsTrue(scoped.IsValid);
        Assert.AreEqual("Order", scoped.Scopes[1].EntityId);
        Assert.AreEqual("integer", scoped.Scopes[1].FieldType);
    }

    [TestMethod]
    public void Validate_AuthorizationScopedCatalog_CannotReferenceHiddenFields()
    {
        var restricted = new QueryCatalog(
            [Catalog.Entities[0] with { Properties = Catalog.Entities[0].Properties.Where(p => p.Id == "Age").ToArray(),
                Relationships = [] }],
            Catalog.Operators);
        var definition = new QueryDefinition { Entity = "Customer", Query = new FieldComparisonExpression
        {
            LeftField = "Age", RightField = "Id", Operator = "equals"
        }};
        Assert.AreEqual("unknownField", new QueryValidator(restricted).Validate(definition).Issues.Single().Code);
    }
}
