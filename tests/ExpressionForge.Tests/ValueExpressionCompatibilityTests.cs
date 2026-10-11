using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class ValueExpressionCompatibilityTests
{
    private static readonly JsonSerializerOptions Options = ExpressionForgeJson.CreateOptions();

    [TestMethod]
    public void Deserialize_LegacyCustomerV1_PreservesOriginalJsonContract()
    {
        const string source = """
            {
              "version": 1, "entity": "Customer", "query": {
                "type": "group", "operator": "and", "expressions": [
                  { "type": "expression", "field": "FirstName", "operator": "equals", "value": "John" },
                  { "type": "collectionExpression", "collection": "Orders", "quantifier": "any",
                    "expression": { "type": "expression", "field": "Total", "operator": "greaterThan", "value": 100 } }
                ]
              }
            }
            """;
        var definition = JsonSerializer.Deserialize<QueryDefinition>(source, Options)!;
        Assert.IsTrue(new QueryValidator(QueryCatalog.CreateDemo()).Validate(definition).IsValid);
        var exported = JsonSerializer.Serialize(definition, Options);
        using var original = JsonDocument.Parse(source);
        using var roundTrip = JsonDocument.Parse(exported);
        Assert.IsTrue(JsonElement.DeepEquals(original.RootElement, roundTrip.RootElement));
        Assert.AreEqual(1, definition.Version);
        Assert.IsNull(definition.CatalogId);
        Assert.IsNull(definition.CatalogRevision);
    }

    [TestMethod]
    public void Deserialize_ExistingProjectSample_PreservesIdsBindingsAndSubgraphs()
    {
        var json = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "project-query.json"));
        using var original = JsonDocument.Parse(json);
        var definition = original.RootElement.GetProperty("definition").Deserialize<QueryDefinition>(Options)!;
        var bindings = original.RootElement.GetProperty("parameters")
            .EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone(), StringComparer.Ordinal);
        var catalogJson = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "project-catalog.json"));
        var catalog = QueryCatalogFile.LoadJson(catalogJson);
        Assert.IsTrue(new QueryValidator(catalog).Validate(definition, bindings).IsValid);
        var serialized = JsonSerializer.Serialize(definition, Options);
        using var result = JsonDocument.Parse(serialized);
        Assert.IsTrue(JsonElement.DeepEquals(original.RootElement.GetProperty("definition"), result.RootElement));
        var plan = new SqlServerQueryCompiler(catalog, new QueryValidator(catalog)).Compile(definition, parameters: bindings);
        Assert.AreEqual(3, plan.Parameters.Count);
        StringAssert.Contains(plan.Sql, "EXISTS");
    }

    [TestMethod]
    public void Deserialize_NewNumericValues_PreservesNestedValueDiscriminators()
    {
        const string source = """
            {
              "version": 1, "entity": "Customer", "query": {
                "type": "arithmeticComparison", "id": "new-v05",
                "left": {
                  "type": "numericBinary", "operator": "multiply",
                  "left": { "type": "tryParseDecimal", "field": "FirstName" },
                  "right": { "type": "numericLiteral", "value": 5.500000 }
                },
                "operator": "greaterThan",
                "right": { "type": "numericParameter", "parameter": "minimum" }
              }
            }
            """;
        var bindings = new Dictionary<string, JsonElement>
        {
            ["minimum"] = JsonSerializer.SerializeToElement(100m)
        };
        var definition = JsonSerializer.Deserialize<QueryDefinition>(source, Options)!;
        Assert.IsTrue(new QueryValidator(QueryCatalog.CreateDemo()).Validate(definition, bindings).IsValid);
        var exported = JsonSerializer.Serialize(definition, Options);
        using var before = JsonDocument.Parse(source);
        using var after = JsonDocument.Parse(exported);
        Assert.IsTrue(JsonElement.DeepEquals(before.RootElement, after.RootElement));
    }

    [TestMethod]
    public void Deserialize_UnknownNumericType_IsExplicitlyRejected()
    {
        const string invalid = """
            {
              "version": 1, "entity": "Customer", "query": {
                "type": "arithmeticComparison",
                "left": { "type": "sqlFragment", "sql": "1 + 1" },
                "operator": "equals",
                "right": { "type": "numericLiteral", "value": 2 }
              }
            }
            """;
        Assert.ThrowsException<JsonException>(() => JsonSerializer.Deserialize<QueryDefinition>(invalid, Options));
    }
}
