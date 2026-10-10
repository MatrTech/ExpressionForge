using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class NodeIdentityTests
{
    private readonly QueryValidator _validator = new(QueryCatalog.CreateDemo());

    [TestMethod]
    public void Serialize_ExpressionWithId_PreservesIdentityAcrossRoundTrip()
    {
        var query = Parse("""{ "type": "expression", "id": "customer-first-name", "field": "FirstName", "operator": "equals", "value": "John" }""");
        var json = JsonSerializer.Serialize(query, ExpressionForgeJson.CreateOptions());
        var restored = JsonSerializer.Deserialize<QueryDefinition>(json, ExpressionForgeJson.CreateOptions())!;

        Assert.AreEqual("customer-first-name", restored.Query.Id);
        Assert.IsTrue(_validator.Validate(restored).IsValid);
    }

    [TestMethod]
    public void Validate_DuplicateNodeId_ReportsOffendingNode()
    {
        var query = Parse("""
        { "type": "group", "id": "root", "operator": "and", "expressions": [
          { "type": "expression", "id": "same", "field": "Age", "operator": "equals", "value": 18 },
          { "type": "expression", "id": "same", "field": "Age", "operator": "equals", "value": 21 }
        ] }
        """);

        var issue = _validator.Validate(query).Issues.Single(i => i.Code == "duplicateNodeId");
        Assert.AreEqual("$.query.expressions[1].id", issue.Path);
        Assert.AreEqual("same", issue.NodeId);
    }

    [TestMethod]
    public void Validate_InvalidNodeId_ReturnsStructuredIssue()
    {
        var query = Parse("""{ "type": "expression", "id": "unsafe/id", "field": "Age", "operator": "equals", "value": 18 }""");
        var issue = _validator.Validate(query).Issues.Single(i => i.Code == "invalidNodeId");
        Assert.AreEqual("unsafe/id", issue.NodeId);
    }

    [TestMethod]
    public void Validate_NestedInvalidValue_ReportsChildNodeId()
    {
        var query = Parse("""
        { "type": "group", "id": "root", "operator": "and", "expressions": [
          { "type": "expression", "id": "bad-age", "field": "Age", "operator": "equals", "value": "old" }
        ] }
        """);

        var issue = _validator.Validate(query).Issues.Single(i => i.Code == "invalidValueType");
        Assert.AreEqual("bad-age", issue.NodeId);
    }

    [TestMethod]
    public void Validate_MissingComparisonValue_RejectsRequest()
    {
        var query = Parse("""{ "type": "expression", "field": "Age", "operator": "equals" }""");
        Assert.AreEqual("invalidValueType", _validator.Validate(query).Issues.Single().Code);
    }

    [TestMethod]
    public void Validate_TooManyNodes_RejectsOversizedTree()
    {
        var expressions = Enumerable.Range(0, QueryValidator.MaximumNodes).Select(i => (QueryExpression)new ComparisonExpression
        {
            Field = "Age", Operator = "equals", Value = JsonSerializer.SerializeToElement(i)
        }).ToList();
        var query = new QueryDefinition { Entity = "Customer", Query = new GroupExpression { Operator = "and", Expressions = expressions } };

        Assert.IsTrue(_validator.Validate(query).Issues.Any(i => i.Code == "tooManyNodes"));
    }

    [TestMethod]
    public void Validate_LegacyTreeWithoutIds_RemainsSupported()
    {
        var query = Parse("""{ "type": "expression", "field": "FirstName", "operator": "equals", "value": "John" }""");
        Assert.IsNull(query.Query.Id);
        Assert.IsTrue(_validator.Validate(query).IsValid);
    }

    private static QueryDefinition Parse(string expressionJson)
    {
        var json = "{\"version\":1,\"entity\":\"Customer\",\"query\":" + expressionJson + "}";
        return JsonSerializer.Deserialize<QueryDefinition>(json, ExpressionForgeJson.CreateOptions())!;
    }
}
