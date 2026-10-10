using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class QueryEngineTests
{
    private readonly QueryCatalog _catalog = QueryCatalog.CreateDemo();
    private QueryValidator Validator => new(_catalog);
    private SqlServerQueryCompiler Compiler => new(_catalog, Validator);

    [TestMethod]
    public void Deserialize_NestedExpressions_ProducesTypedTree()
    {
        var query = Parse("""
        { "type": "group", "operator": "and", "expressions": [
            { "type": "expression", "field": "FirstName", "operator": "equals", "value": "John" },
            { "type": "collectionExpression", "collection": "Orders", "quantifier": "any",
              "expression": { "type": "expression", "field": "Total", "operator": "greaterThan", "value": 100 } }
        ] }
        """);

        Assert.IsInstanceOfType(query.Query, typeof(GroupExpression));
        var group = (GroupExpression)query.Query;
        Assert.AreEqual(2, group.Expressions.Count);
        Assert.IsInstanceOfType(group.Expressions[1], typeof(CollectionExpression));
        Assert.IsTrue(Validator.Validate(query).IsValid);
    }

    [TestMethod]
    public void Compile_ValidNestedGroup_PreservesParenthesesAndParameters()
    {
        var query = Parse("""
        { "type": "group", "operator": "or", "expressions": [
            { "type": "expression", "field": "Age", "operator": "greaterThan", "value": 18 },
            { "type": "expression", "field": "IsActive", "operator": "equals", "value": true }
        ] }
        """);

        var plan = Compiler.Compile(query, 10);
        StringAssert.Contains(plan.Sql, "([t0].[Age] > @p0) OR ([t0].[IsActive] = @p1)");
        StringAssert.Contains(plan.Sql, "TOP (@take)");
        Assert.AreEqual(3, plan.Parameters.Count);
        Assert.AreEqual(18, plan.Parameters[1].Value);
        Assert.AreEqual(true, plan.Parameters[2].Value);
    }

    [TestMethod]
    public void Compile_AnyCollection_ProducesCorrelatedExists()
    {
        var query = Parse("""
        { "type": "collectionExpression", "collection": "Orders", "quantifier": "any",
          "expression": { "type": "expression", "field": "Total", "operator": "greaterThan", "value": 100 } }
        """);

        var plan = Compiler.Compile(query);
        StringAssert.Contains(plan.Sql, "EXISTS (SELECT 1 FROM [dbo].[Orders] AS [t1]");
        StringAssert.Contains(plan.Sql, "[t1].[CustomerId] = [t0].[Id]");
        StringAssert.Contains(plan.Sql, "[t1].[Total] > @p0");
    }

    [TestMethod]
    public void Compile_NoneCollection_ProducesNotExists()
    {
        var query = Parse("""
        { "type": "collectionExpression", "collection": "Orders", "quantifier": "none",
          "expression": { "type": "expression", "field": "Total", "operator": "greaterThan", "value": 100 } }
        """);

        StringAssert.Contains(Compiler.Compile(query).Sql, "NOT EXISTS");
    }

    [TestMethod]
    public void Compile_AllCollection_HandlesFalseOrUnknownPredicate()
    {
        var query = Parse("""
        { "type": "collectionExpression", "collection": "Orders", "quantifier": "all",
          "expression": { "type": "expression", "field": "Total", "operator": "greaterThan", "value": 100 } }
        """);

        StringAssert.Contains(Compiler.Compile(query).Sql, "CASE WHEN ([t1].[Total] > @p0) THEN 1 ELSE 0 END = 0");
    }

    [TestMethod]
    public void Compile_SqlInjectionLikeValue_UsesParameters()
    {
        const string attacker = "John'; DROP TABLE Customers;--";
        var query = Parse("""
        { "type": "expression", "field": "FirstName", "operator": "equals", "value": "John'; DROP TABLE Customers;--" }
        """);
        var plan = Compiler.Compile(query);

        Assert.IsFalse(plan.Sql.Contains(attacker, StringComparison.Ordinal));
        Assert.AreEqual(attacker, plan.Parameters[1].Value);
    }

    [TestMethod]
    public void Compile_ContainsWildcard_EscapesLiteralCharacters()
    {
        var query = Parse("""
        { "type": "expression", "field": "FirstName", "operator": "contains", "value": "a%_~[" }
        """);
        var plan = Compiler.Compile(query);

        StringAssert.Contains(plan.Sql, "ESCAPE '~'");
        Assert.AreEqual("%a~%~_~~~[%", plan.Parameters[1].Value);
    }

    [TestMethod]
    public void Compile_Negation_ProducesNotPredicate()
    {
        var query = Parse("""
        { "type": "not", "expression":
          { "type": "expression", "field": "IsActive", "operator": "equals", "value": true } }
        """);

        StringAssert.Contains(Compiler.Compile(query).Sql, "NOT (([t0].[IsActive] = @p0))");
    }

    [TestMethod]
    public void Validate_UnknownField_ReturnsStructuredError()
    {
        var query = Parse("""
        { "type": "expression", "field": "PasswordHash", "operator": "equals", "value": "secret" }
        """);

        var result = Validator.Validate(query);
        Assert.IsFalse(result.IsValid);
        Assert.AreEqual("unknownField", result.Issues[0].Code);
        Assert.AreEqual("$.query.field", result.Issues[0].Path);
    }

    [TestMethod]
    public void Validate_IncompatibleOperator_RejectsComparison()
    {
        var query = Parse("""
        { "type": "expression", "field": "IsActive", "operator": "contains", "value": "yes" }
        """);

        Assert.AreEqual("invalidOperator", Validator.Validate(query).Issues[0].Code);
    }

    [TestMethod]
    public void Validate_MismatchedJsonValue_RejectsComparison()
    {
        var query = Parse("""
        { "type": "expression", "field": "Age", "operator": "equals", "value": "eighteen" }
        """);

        Assert.AreEqual("invalidValueType", Validator.Validate(query).Issues[0].Code);
    }

    [TestMethod]
    public void Validate_UnknownRelationship_RejectsTraversal()
    {
        var query = Parse("""
        { "type": "collectionExpression", "collection": "InternalLogs", "quantifier": "any",
          "expression": { "type": "expression", "field": "Id", "operator": "equals", "value": 1 } }
        """);

        Assert.AreEqual("unknownCollection", Validator.Validate(query).Issues[0].Code);
    }

    [TestMethod]
    public void Validate_EmptyGroup_ReturnsError()
    {
        var query = Parse("""{ "type": "group", "operator": "and", "expressions": [] }""");
        Assert.AreEqual("emptyGroup", Validator.Validate(query).Issues[0].Code);
    }

    [TestMethod]
    public void Validate_TooDeepTree_ReturnsError()
    {
        QueryExpression expression = new ComparisonExpression
        {
            Field = "Age", Operator = "equals", Value = JsonSerializer.SerializeToElement(18)
        };
        for (var i = 0; i < QueryValidator.MaximumDepth; i++)
            expression = new NotExpression { Expression = expression };
        var query = new QueryDefinition { Entity = "Customer", Query = expression };

        Assert.IsTrue(Validator.Validate(query).Issues.Any(i => i.Code == "tooDeep"));
    }

    [TestMethod]
    public void Compile_OverMaximumRows_Throws()
    {
        var query = Parse("""
        { "type": "expression", "field": "Age", "operator": "equals", "value": 18 }
        """);

        Assert.ThrowsException<ArgumentOutOfRangeException>(() => Compiler.Compile(query, 101));
    }

    [TestMethod]
    public void Metadata_SqlMapping_IsHiddenFromSerializedResponse()
    {
        var json = JsonSerializer.Serialize(_catalog.Entities[0], ExpressionForgeJson.CreateOptions());
        Assert.IsFalse(json.Contains("parentKey", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(json.Contains("childForeignKey", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(json.Contains("schema", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(json.Contains("table", StringComparison.OrdinalIgnoreCase));
    }

    private static QueryDefinition Parse(string expressionJson)
    {
        var document = "{\"version\":1,\"entity\":\"Customer\",\"query\":" + expressionJson + "}";
        return JsonSerializer.Deserialize<QueryDefinition>(document, ExpressionForgeJson.CreateOptions())!;
    }
}
