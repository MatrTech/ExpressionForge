using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class StringDateValueTests
{
    private static readonly QueryCatalog Catalog = CreateDateCatalog();

    private static QueryCatalog CreateDateCatalog()
    {
        var demo = QueryCatalog.CreateDemo();
        var entities = demo.Entities.Select(entity => entity.Id == "Customer" ? entity with
        {
            Properties = [..entity.Properties,
                new PropertyMetadata("StartedAt", "Started", "date", true, []),
                new PropertyMetadata("FinishedAt", "Finished", "date", true, []),
                new PropertyMetadata("LastSeen", "Last seen", "dateTime", true, [])]
        } : entity).ToArray();
        var builder = new QueryCatalogBuilder();
        foreach (var entity in entities) builder.AddEntity(entity);
        foreach (var op in demo.Operators) builder.AddOperator(op);
        return builder.Build();
    }

    private static QueryDefinition With(NumericValueExpression left) => new()
    {
        Entity = "Customer",
        Query = new ArithmeticComparisonExpression
        {
            Id = "function-node",
            Left = left,
            Operator = "greaterThan",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(5m) }
        }
    };

    [TestMethod]
    public void RoundTrip_StringLength_UsesTypedValueDiscriminator()
    {
        var definition = With(new StringLengthExpression { Field = "FirstName" });
        var json = JsonSerializer.Serialize(definition, ExpressionForgeJson.CreateOptions());
        StringAssert.Contains(json, "\"type\":\"stringLength\"");
        var restored = JsonSerializer.Deserialize<QueryDefinition>(json, ExpressionForgeJson.CreateOptions())!;
        Assert.IsTrue(new QueryValidator(Catalog).Validate(restored).IsValid);
        var plan = new SqlServerQueryCompiler(Catalog, new QueryValidator(Catalog)).Compile(restored);
        StringAssert.Contains(plan.Sql, "LEN([t0].[FirstName])");
        Assert.AreEqual(2, plan.Parameters.Count);
    }

    [TestMethod]
    public void RoundTrip_DateDiffDays_CompilesApprovedIdentifiers()
    {
        var definition = With(new DateDiffDaysExpression { StartField = "StartedAt", EndField = "FinishedAt" });
        var json = JsonSerializer.Serialize(definition, ExpressionForgeJson.CreateOptions());
        StringAssert.Contains(json, "\"type\":\"dateDiffDays\"");
        Assert.IsTrue(new QueryValidator(Catalog).Validate(definition).IsValid);
        var plan = new SqlServerQueryCompiler(Catalog, new QueryValidator(Catalog)).Compile(definition);
        StringAssert.Contains(plan.Sql, "DATEDIFF(day, [t0].[StartedAt], [t0].[FinishedAt])");
        Assert.AreEqual(2, plan.Parameters.Count);
    }

    [TestMethod]
    public void Validate_StringLength_RejectsNonStringAndHiddenFields()
    {
        var validator = new QueryValidator(Catalog);
        var notString = validator.Validate(With(new StringLengthExpression { Field = "Age" })).Issues.Single();
        Assert.AreEqual("invalidValueType", notString.Code);
        Assert.AreEqual("$.query.left.field", notString.Path);
        var unknown = validator.Validate(With(new StringLengthExpression { Field = "Secret" })).Issues.Single();
        Assert.AreEqual("unknownField", unknown.Code);
        Assert.AreEqual("function-node", unknown.NodeId);
        Assert.ThrowsException<QueryValidationException>(() => new SqlServerQueryCompiler(Catalog, validator)
            .Compile(With(new StringLengthExpression { Field = "Secret" })));
    }

    [TestMethod]
    public void Validate_DateDiffDays_RejectsUnknownIncompatibleAndNonDateFields()
    {
        var validator = new QueryValidator(Catalog);
        var missing = validator.Validate(With(new DateDiffDaysExpression
        { StartField = "StartedAt", EndField = "Secret" })).Issues.Single();
        Assert.AreEqual("unknownField", missing.Code);
        Assert.AreEqual("$.query.left.endField", missing.Path);
        var wrong = validator.Validate(With(new DateDiffDaysExpression
        { StartField = "StartedAt", EndField = "Age" })).Issues.Single();
        Assert.AreEqual("invalidValueType", wrong.Code);
        var mismatched = validator.Validate(With(new DateDiffDaysExpression
        { StartField = "StartedAt", EndField = "LastSeen" })).Issues.Single();
        Assert.AreEqual("incompatibleFieldTypes", mismatched.Code);
    }

    [TestMethod]
    public void Validate_StringLengthWithinCollection_UsesChildScope()
    {
        var definition = new QueryDefinition
        {
            Entity = "Customer",
            Query = new CollectionExpression
            {
                Collection = "Orders", Quantifier = "any",
                Expression = (ArithmeticComparisonExpression)With(new StringLengthExpression
                    { Field = "Status" }).Query
            }
        };
        var validator = new QueryValidator(Catalog);
        Assert.IsTrue(validator.Validate(definition).IsValid);
        var plan = new SqlServerQueryCompiler(Catalog, validator).Compile(definition);
        StringAssert.Contains(plan.Sql, "LEN([t1].[Status])");
        var invalid = definition with
        {
            Query = new CollectionExpression
            {
                Collection = "Orders", Quantifier = "any",
                Expression = (ArithmeticComparisonExpression)With(new StringLengthExpression
                    { Field = "FirstName" }).Query
            }
        };
        Assert.AreEqual("unknownField", validator.Validate(invalid).Issues.Single().Code);
    }

    [TestMethod]
    public void Validate_FunctionsShareNumericValueDepthBudget()
    {
        NumericValueExpression value = new StringLengthExpression { Field = "FirstName" };
        for (var i = 0; i < QueryValidator.MaximumDepth; i++)
            value = new NumericBinaryExpression
            {
                Operator = "add", Left = value,
                Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(1) }
            };
        var result = new QueryValidator(Catalog).Validate(With(value));
        Assert.IsTrue(result.Issues.Any(issue => issue.Code == "tooDeep"));
    }
}
