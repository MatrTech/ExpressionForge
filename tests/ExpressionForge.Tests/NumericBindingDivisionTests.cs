using System.Data;
using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class NumericBindingDivisionTests
{
    private static readonly QueryCatalog Catalog = QueryCatalog.CreateDemo();
    private static readonly QueryValidator Validator = new(Catalog);

    private static NumericLiteralExpression Number(decimal value) => new() { Value = JsonSerializer.SerializeToElement(value) };

    private static QueryDefinition Division(NumericValueExpression divisor) => new()
    {
        Entity = "Customer",
        Query = new ArithmeticComparisonExpression
        {
            Id = "safe-divide",
            Left = new NumericBinaryExpression
            {
                Operator = "divide",
                Left = new NumericFieldExpression { Field = "Age" },
                Right = divisor
            },
            Operator = "greaterThan",
            Right = Number(5)
        }
    };

    [TestMethod]
    public void Compile_DivisionWithZeroLiteral_UsesNullifWithoutDynamicSql()
    {
        var definition = Division(Number(0));
        Assert.IsTrue(Validator.Validate(definition).IsValid);
        var plan = new SqlServerQueryCompiler(Catalog, Validator).Compile(definition);
        StringAssert.Contains(plan.Sql, " / NULLIF(CONVERT(decimal(38,12), TRY_CONVERT(decimal(19,6), CONVERT(decimal(28,6), @p0))), CONVERT(decimal(38,12), 0))");
        Assert.AreEqual(3, plan.Parameters.Count);
        Assert.AreEqual(0m, plan.Parameters[1].Value);
        Assert.AreEqual(DbType.Decimal, plan.Parameters[1].DbType);
    }

    [TestMethod]
    public void Compile_RuntimeNumericBinding_UsesBoundDecimalAndNeverInterpolatesValue()
    {
        var definition = Division(new NumericParameterExpression { Parameter = "divisor" });
        var bindings = new Dictionary<string, JsonElement> { ["divisor"] = JsonSerializer.SerializeToElement(2m) };
        var json = JsonSerializer.Serialize(definition, ExpressionForgeJson.CreateOptions());
        StringAssert.Contains(json, "\"type\":\"numericParameter\"");
        var plan = new SqlServerQueryCompiler(Catalog, Validator).Compile(definition, parameters: bindings);
        Assert.AreEqual(3, plan.Parameters.Count);
        Assert.AreEqual(2m, plan.Parameters[1].Value);
        StringAssert.Contains(plan.Sql, "NULLIF(CONVERT(decimal(38,12), TRY_CONVERT(decimal(19,6), CONVERT(decimal(28,6), @p0)))");
        Assert.IsFalse(plan.Sql.Contains("divisor", StringComparison.Ordinal));
        Assert.IsFalse(plan.Sql.Contains(" 2 ", StringComparison.Ordinal));
    }

    [TestMethod]
    public void Validate_RuntimeBinding_RejectsMissingWrongTypeRangeAndPrecision()
    {
        var definition = Division(new NumericParameterExpression { Parameter = "divisor" });
        Assert.AreEqual("missingParameter", Validator.Validate(definition).Issues.Single().Code);
        foreach (var binding in new[]
        {
            JsonSerializer.SerializeToElement("3"),
            JsonSerializer.SerializeToElement(true),
            JsonSerializer.SerializeToElement(0.1234567m),
            JsonSerializer.SerializeToElement(1_000_000_000_001m)
        })
        {
            var supplied = new Dictionary<string, JsonElement> { ["divisor"] = binding };
            var issue = Validator.Validate(definition, supplied).Issues.Single();
            Assert.AreEqual("invalidValueType", issue.Code);
            Assert.AreEqual("$.query.left.right.value", issue.Path);
            Assert.AreEqual("safe-divide", issue.NodeId);
        }
    }

    [TestMethod]
    public void Validate_RuntimeBinding_RejectsInvalidParameterName()
    {
        var definition = Division(new NumericParameterExpression { Parameter = "unsafe param!" });
        var issues = Validator.Validate(definition).Issues;
        Assert.AreEqual("invalidParameterName", issues.Single().Code);
    }

    [TestMethod]
    public void Validate_ReusedParameterWithConflictingIntegerAndDecimalTypes_IsRejected()
    {
        var definition = new QueryDefinition
        {
            Entity = "Customer",
            Query = new GroupExpression
            {
                Operator = "and",
                Expressions =
                [
                    new ComparisonExpression
                    {
                        Field = "Age", Operator = "greaterThan", Parameter = "shared"
                    },
                    (QueryExpression)Division(new NumericParameterExpression { Parameter = "shared" }).Query
                ]
            }
        };
        var bindings = new Dictionary<string, JsonElement> { ["shared"] = JsonSerializer.SerializeToElement(2) };
        var issues = Validator.Validate(definition, bindings).Issues;
        Assert.IsTrue(issues.Any(issue => issue.Code == "conflictingParameterType"));
    }

    [TestMethod]
    public void Validate_ArithmeticParameterWithinCollection_UsesTargetScope()
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
                        Operator = "divide",
                        Left = new NumericFieldExpression { Field = "Total" },
                        Right = new NumericParameterExpression { Parameter = "multiplier" }
                    },
                    Operator = "greaterThan", Right = Number(20)
                }
            }
        };
        var bindings = new Dictionary<string, JsonElement> { ["multiplier"] = JsonSerializer.SerializeToElement(2m) };
        Assert.IsTrue(Validator.Validate(definition, bindings).IsValid);
        var plan = new SqlServerQueryCompiler(Catalog, Validator).Compile(definition, parameters: bindings);
        StringAssert.Contains(plan.Sql, "[t1].[Total]");
        StringAssert.Contains(plan.Sql, "NULLIF(");
    }
}
