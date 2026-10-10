using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class ShowcaseExamplesTests
{
    private sealed record ShowcaseParameter(string Label, string Type, JsonElement Value);
    private sealed record ShowcaseExample(string Id, QueryDefinition Definition, Dictionary<string, ShowcaseParameter> Parameters);

    [TestMethod]
    public void Compile_AllPublishedExamples_AreValidAndUseTypedBindings()
    {
        var examples = ReadExamples();
        Assert.AreEqual(5, examples.Count);
        var catalog = QueryCatalog.CreateDemo();
        var validator = new QueryValidator(catalog);
        var compiler = new SqlServerQueryCompiler(catalog, validator);

        foreach (var example in examples)
        {
            var bindings = example.Parameters.ToDictionary(item => item.Key, item => item.Value.Value, StringComparer.Ordinal);
            var result = validator.Validate(example.Definition, bindings);
            Assert.IsTrue(result.IsValid, $"{example.Id}: {string.Join("; ", result.Issues.Select(i => i.Code + ": " + i.Message))}");

            var plan = compiler.Compile(example.Definition, 25, bindings);
            StringAssert.Contains(plan.Sql, "SELECT TOP (@take)");
            StringAssert.Contains(plan.Sql, "FROM [dbo].[Customers]");
            Assert.AreEqual(25, plan.Parameters[0].Value);
            Assert.IsTrue(plan.Parameters.Count > 1, example.Id);
        }
    }

    [TestMethod]
    public void Compile_ReusedGalleryParameter_BindsEachOccurrenceIndependently()
    {
        var example = ReadExamples().Single(item => item.Id == "premium-only");
        var bindings = example.Parameters.ToDictionary(item => item.Key, item => item.Value.Value, StringComparer.Ordinal);
        var catalog = QueryCatalog.CreateDemo();
        var plan = new SqlServerQueryCompiler(catalog, new QueryValidator(catalog)).Compile(example.Definition, 25, bindings);

        Assert.AreEqual(3, plan.Parameters.Count);
        Assert.AreEqual(200m, plan.Parameters[1].Value);
        Assert.AreEqual(200m, plan.Parameters[2].Value);
        StringAssert.Contains(plan.Sql, "NOT EXISTS");
        StringAssert.Contains(plan.Sql, "EXISTS");
    }

    private static List<ShowcaseExample> ReadExamples()
    {
        var json = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "examples.json"));
        return JsonSerializer.Deserialize<List<ShowcaseExample>>(json, ExpressionForgeJson.CreateOptions())!;
    }
}
