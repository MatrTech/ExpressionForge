using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class RuntimeParameterTests
{
    private readonly QueryCatalog _catalog = QueryCatalog.CreateDemo();
    private QueryValidator Validator => new(_catalog);
    private SqlServerQueryCompiler Compiler => new(_catalog, Validator);

    [TestMethod]
    public void Deserialize_ParameterExpression_OmitsUndefinedLiteral()
    {
        var query = Parse("""{ "type": "expression", "field": "Age", "operator": "greaterThan", "parameter": "minimumAge" }""");
        var json = JsonSerializer.Serialize(query, ExpressionForgeJson.CreateOptions());

        StringAssert.Contains(json, "\"parameter\":\"minimumAge\"");
        Assert.IsFalse(json.Contains("\"value\"", StringComparison.Ordinal));
    }

    [TestMethod]
    public void Validate_ParameterWithoutBinding_ReturnsMissingParameter()
    {
        var query = Parse("""{ "type": "expression", "id": "age", "field": "Age", "operator": "greaterThan", "parameter": "minimumAge" }""");
        var issue = Validator.Validate(query).Issues.Single();

        Assert.AreEqual("missingParameter", issue.Code);
        Assert.AreEqual("age", issue.NodeId);
    }

    [TestMethod]
    public void Compile_BoundParameter_UsesTypedSqlParameter()
    {
        var query = Parse("""{ "type": "expression", "field": "Age", "operator": "greaterThan", "parameter": "minimumAge" }""");
        var bindings = Bind(("minimumAge", JsonSerializer.SerializeToElement(21)));
        var plan = Compiler.Compile(query, 15, bindings);

        StringAssert.Contains(plan.Sql, "[t0].[Age] > @p0");
        Assert.AreEqual(21, plan.Parameters[1].Value);
        Assert.AreEqual(System.Data.DbType.Int32, plan.Parameters[1].DbType);
        Assert.IsFalse(plan.Sql.Contains("21", StringComparison.Ordinal));
    }

    [TestMethod]
    public void Compile_ReusedParameter_InNestedGroup_BindsBothOccurrences()
    {
        var query = Parse("""
        { "type": "group", "operator": "and", "expressions": [
            { "type": "expression", "field": "Age", "operator": "greaterThan", "parameter": "minimumAge" },
            { "type": "expression", "field": "Id", "operator": "notEquals", "parameter": "minimumAge" }
        ] }
        """);
        var plan = Compiler.Compile(query, 25, Bind(("minimumAge", JsonSerializer.SerializeToElement(18))));

        Assert.AreEqual(3, plan.Parameters.Count);
        Assert.AreEqual(18, plan.Parameters[1].Value);
        Assert.AreEqual(18, plan.Parameters[2].Value);
    }

    [TestMethod]
    public void Validate_BoundParameterWrongType_RejectsValue()
    {
        var query = Parse("""{ "type": "expression", "field": "Age", "operator": "equals", "parameter": "age" }""");
        var issues = Validator.Validate(query, Bind(("age", JsonSerializer.SerializeToElement("eighteen")))).Issues;

        Assert.AreEqual("invalidValueType", issues.Single().Code);
    }

    [TestMethod]
    public void Validate_BothLiteralAndParameter_RejectsAmbiguity()
    {
        var query = Parse("""{ "type": "expression", "field": "Age", "operator": "equals", "value": 18, "parameter": "age" }""");
        var issues = Validator.Validate(query, Bind(("age", JsonSerializer.SerializeToElement(18)))).Issues;

        Assert.AreEqual("ambiguousValue", issues.Single().Code);
    }

    [TestMethod]
    public void Validate_InvalidParameterName_RejectsReference()
    {
        var query = Parse("""{ "type": "expression", "field": "Age", "operator": "equals", "parameter": "age;DROP" }""");
        Assert.AreEqual("invalidParameterName", Validator.Validate(query).Issues.Single().Code);
    }

    [TestMethod]
    public void Compile_ParameterizedContains_EscapesWildcardsAndSqlInjection()
    {
        var query = Parse("""{ "type": "expression", "field": "FirstName", "operator": "contains", "parameter": "search" }""");
        const string input = "a%'; DROP TABLE Customers;--";
        var plan = Compiler.Compile(query, 25, Bind(("search", JsonSerializer.SerializeToElement(input))));

        Assert.IsFalse(plan.Sql.Contains(input, StringComparison.Ordinal));
        StringAssert.Contains(plan.Sql, "ESCAPE '~'");
        Assert.AreEqual("%a~%'; DROP TABLE Customers;--%", plan.Parameters[1].Value);
    }

    [TestMethod]
    public void Compile_ParameterWithinCollection_UsesChildFieldType()
    {
        var query = Parse("""
        { "type": "collectionExpression", "collection": "Orders", "quantifier": "any",
          "expression": { "type": "expression", "field": "Total", "operator": "greaterThan", "parameter": "minimumTotal" } }
        """);
        var plan = Compiler.Compile(query, 25, Bind(("minimumTotal", JsonSerializer.SerializeToElement(100.5m))));

        StringAssert.Contains(plan.Sql, "[t1].[Total] > @p0");
        Assert.AreEqual(System.Data.DbType.Decimal, plan.Parameters[1].DbType);
        Assert.AreEqual(100.5m, plan.Parameters[1].Value);
    }

    private static Dictionary<string, JsonElement> Bind(params (string Name, JsonElement Value)[] values) =>
        values.ToDictionary(v => v.Name, v => v.Value, StringComparer.Ordinal);

    private static QueryDefinition Parse(string expressionJson)
    {
        var json = "{\"version\":1,\"entity\":\"Customer\",\"query\":" + expressionJson + "}";
        return JsonSerializer.Deserialize<QueryDefinition>(json, ExpressionForgeJson.CreateOptions())!;
    }
}
