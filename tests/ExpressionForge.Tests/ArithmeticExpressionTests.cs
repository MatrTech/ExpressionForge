using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class ArithmeticExpressionTests
{
    private static readonly QueryCatalog Catalog = QueryCatalog.CreateDemo();
    private static QueryValidator Validator => new(Catalog);

    private static QueryDefinition Parse(string json) => JsonSerializer.Deserialize<QueryDefinition>(
        json, ExpressionForgeJson.CreateOptions())!;

    private static NumericLiteralExpression Number(decimal number) => new()
    {
        Value = JsonSerializer.SerializeToElement(number)
    };

    private static QueryDefinition Definition(NumericValueExpression left, string op, NumericValueExpression right) => new()
    {
        Entity = "Customer",
        Query = new ArithmeticComparisonExpression
        {
            Id = "computed-1", Left = left, Operator = op, Right = right
        }
    };

    [TestMethod]
    public void Serialize_ArithmeticComparison_RoundTripsNestedNumericValues()
    {
        var definition = Definition(new NumericBinaryExpression
        {
            Operator = "subtract",
            Left = new NumericFieldExpression { Field = "Age" },
            Right = new NumericFieldExpression { Field = "Id" }
        }, "greaterThan", Number(20));
        var json = JsonSerializer.Serialize(definition, ExpressionForgeJson.CreateOptions());
        StringAssert.Contains(json, "\"type\":\"arithmeticComparison\"");
        StringAssert.Contains(json, "\"type\":\"numericBinary\"");
        var restored = Parse(json);
        Assert.IsTrue(Validator.Validate(restored).IsValid);
        Assert.AreEqual("computed-1", restored.Query.Id);
    }

    [TestMethod]
    public void Compile_NestedArithmetic_UsesTrustedFieldsAndDecimalParameters()
    {
        var definition = Definition(new NumericBinaryExpression
        {
            Operator = "add",
            Left = new NumericBinaryExpression
            {
                Operator = "multiply",
                Left = new NumericFieldExpression { Field = "Age" },
                Right = Number(2)
            },
            Right = Number(5)
        }, "greaterThan", Number(60));
        var plan = new SqlServerQueryCompiler(Catalog, Validator).Compile(definition);
        StringAssert.Contains(plan.Sql, "CONVERT(decimal(28,6), [t0].[Age])");
        StringAssert.Contains(plan.Sql, "*");
        StringAssert.Contains(plan.Sql, "+");
        Assert.AreEqual(4, plan.Parameters.Count);
        Assert.AreEqual(2m, plan.Parameters[1].Value);
        Assert.AreEqual(60m, plan.Parameters[3].Value);
    }

    [TestMethod]
    public void Validate_UnauthorizedOrNonNumericField_RejectsValueTree()
    {
        var unknown = Definition(new NumericFieldExpression { Field = "NotAuthorized" }, "equals", Number(1));
        var issue = Validator.Validate(unknown).Issues.Single();
        Assert.AreEqual("unknownField", issue.Code);
        Assert.AreEqual("computed-1", issue.NodeId);
        Assert.AreEqual("$.query.left.field", issue.Path);
        var invalid = Definition(new NumericFieldExpression { Field = "FirstName" }, "equals", Number(1));
        Assert.AreEqual("invalidValueType", Validator.Validate(invalid).Issues.Single().Code);
        Assert.ThrowsException<QueryValidationException>(() =>
            new SqlServerQueryCompiler(Catalog, Validator).Compile(invalid));
    }

    [TestMethod]
    public void Validate_NonNumericAndTooPreciseLiterals_RejectsInput()
    {
        var invalid = Definition(Number(1), "greaterThan", new NumericLiteralExpression
        {
            Value = JsonSerializer.SerializeToElement("1 OR 1=1")
        });
        Assert.AreEqual("invalidValueType", Validator.Validate(invalid).Issues.Single().Code);
        var precision = Definition(Number(1), "equals", Number(0.1234567m));
        Assert.AreEqual("invalidValueType", Validator.Validate(precision).Issues.Single().Code);
        var huge = Definition(Number(1), "equals", Number(1_000_000_000_001m));
        Assert.AreEqual("invalidValueType", Validator.Validate(huge).Issues.Single().Code);
    }

    [TestMethod]
    public void Validate_UnsupportedOperations_RejectsDivideAndUnknownComparison()
    {
        var left = new NumericBinaryExpression { Operator = "divide", Left = Number(4), Right = Number(0) };
        var invalid = Definition(left, "equals", Number(1));
        Assert.AreEqual("invalidOperator", Validator.Validate(invalid).Issues.Single().Code);
        var other = Definition(Number(1), "contains", Number(2));
        Assert.AreEqual("invalidOperator", Validator.Validate(other).Issues.Single().Code);
    }

    [TestMethod]
    public void Validate_DeepNumericTree_IsBoundedByQueryDepth()
    {
        NumericValueExpression value = Number(1);
        for (var i = 0; i < QueryValidator.MaximumDepth; i++)
            value = new NumericBinaryExpression { Operator = "add", Left = value, Right = Number(1) };
        var issues = Validator.Validate(Definition(value, "greaterThan", Number(10))).Issues;
        Assert.IsTrue(issues.Any(issue => issue.Code == "tooDeep"));
    }

    [TestMethod]
    public void Validate_ArithmeticWithinOrders_ResolvesChildFields()
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
                        Left = new NumericFieldExpression { Field = "Total" },
                        Right = Number(100)
                    },
                    Operator = "greaterThan", Right = Number(20)
                }
            }
        };
        Assert.IsTrue(Validator.Validate(definition).IsValid);
        var plan = new SqlServerQueryCompiler(Catalog, Validator).Compile(definition);
        StringAssert.Contains(plan.Sql, "CONVERT(decimal(28,6), [t1].[Total])");
        Assert.AreEqual(3, plan.Parameters.Count);
    }
}
