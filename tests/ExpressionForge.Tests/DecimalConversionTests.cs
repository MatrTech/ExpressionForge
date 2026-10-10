using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class DecimalConversionTests
{
    private static readonly QueryCatalog Catalog = QueryCatalog.CreateDemo();
    private static readonly QueryValidator Validator = new(Catalog);

    private static QueryDefinition Query(NumericValueExpression source) => new()
    {
        Entity = "Customer",
        Query = new ArithmeticComparisonExpression
        {
            Id = "parse-number", Left = source, Operator = "greaterThan",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(100m) }
        }
    };

    [TestMethod]
    public void Serialize_TryParseDecimal_RoundTripsNumericAstV1()
    {
        var definition = Query(new TryParseDecimalExpression { Field = "FirstName" });
        var json = JsonSerializer.Serialize(definition, ExpressionForgeJson.CreateOptions());
        StringAssert.Contains(json, "\"type\":\"tryParseDecimal\"");
        var restored = JsonSerializer.Deserialize<QueryDefinition>(json, ExpressionForgeJson.CreateOptions())!;
        Assert.IsTrue(Validator.Validate(restored).IsValid);
        Assert.AreEqual("parse-number", restored.Query.Id);
    }

    [TestMethod]
    public void Compile_ConvertStringField_UsesSqlTryConvertInsteadOfUnsafeCast()
    {
        var definition = Query(new TryParseDecimalExpression { Field = "FirstName" });
        var plan = new SqlServerQueryCompiler(Catalog, Validator).Compile(definition);
        StringAssert.Contains(plan.Sql, "TRY_CONVERT(decimal(28,6), [t0].[FirstName])");
        Assert.IsFalse(plan.Sql.Contains("CAST(", StringComparison.Ordinal));
        Assert.AreEqual(2, plan.Parameters.Count);
    }

    [TestMethod]
    public void Validate_Conversion_RejectsHiddenOrNonStringFieldsWithOwner()
    {
        var missing = Validator.Validate(Query(new TryParseDecimalExpression { Field = "NotExposed" })).Issues.Single();
        Assert.AreEqual("unknownField", missing.Code);
        Assert.AreEqual("$.query.left.field", missing.Path);
        Assert.AreEqual("parse-number", missing.NodeId);

        var wrong = Validator.Validate(Query(new TryParseDecimalExpression { Field = "Age" })).Issues.Single();
        Assert.AreEqual("invalidValueType", wrong.Code);
        Assert.ThrowsException<QueryValidationException>(() =>
            new SqlServerQueryCompiler(Catalog, Validator).Compile(Query(new TryParseDecimalExpression { Field = "Age" })));
    }

    [TestMethod]
    public void Compile_ConversionNestedInsideArithmeticAndCollection_UsesChildScope()
    {
        var definition = new QueryDefinition
        {
            Entity = "Customer",
            Query = new CollectionExpression
            {
                Collection = "Orders", Quantifier = "any",
                Expression = new ArithmeticComparisonExpression
                {
                    Left = new NumericBinaryExpression
                    {
                        Operator = "subtract",
                        Left = new TryParseDecimalExpression { Field = "Status" },
                        Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(20m) }
                    },
                    Operator = "greaterThan",
                    Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(50m) }
                }
            }
        };
        Assert.IsTrue(Validator.Validate(definition).IsValid);
        var plan = new SqlServerQueryCompiler(Catalog, Validator).Compile(definition);
        StringAssert.Contains(plan.Sql, "TRY_CONVERT(decimal(28,6), [t1].[Status])");
        Assert.AreEqual(3, plan.Parameters.Count);
    }

    [TestMethod]
    public void Validate_ConversionPreservesDepthAndComplexityLimits()
    {
        NumericValueExpression value = new TryParseDecimalExpression { Field = "FirstName" };
        for (var i = 0; i < QueryValidator.MaximumDepth; i++)
            value = new NumericBinaryExpression
            {
                Operator = "add", Left = value,
                Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(1m) }
            };
        Assert.IsTrue(Validator.Validate(Query(value)).Issues.Any(x => x.Code == "tooDeep"));
    }
}
