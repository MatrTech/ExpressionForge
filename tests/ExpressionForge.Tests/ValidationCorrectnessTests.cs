using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class ValidationCorrectnessTests
{
    private readonly QueryValidator _validator = new(QueryCatalog.CreateDemo());

    [TestMethod]
    public void Validate_ChildWithoutId_DoesNotInheritParentIdentity()
    {
        var definition = Define(new GroupExpression
        {
            Id = "root", Operator = "and",
            Expressions =
            [
                new ComparisonExpression { Field = "Age", Operator = "equals", Value = JsonSerializer.SerializeToElement("old") }
            ]
        });

        var issue = _validator.Validate(definition).Issues.Single();
        Assert.AreEqual("invalidValueType", issue.Code);
        Assert.AreEqual("$.query.expressions[0].value", issue.Path);
        Assert.IsNull(issue.NodeId);
    }

    [TestMethod]
    public void Validate_NegatedChildWithoutId_DoesNotInheritParentIdentity()
    {
        var definition = Define(new NotExpression
        {
            Id = "negation",
            Expression = new ComparisonExpression
            {
                Field = "Age", Operator = "equals", Value = JsonSerializer.SerializeToElement("old")
            }
        });

        var issue = _validator.Validate(definition).Issues.Single();
        Assert.AreEqual("$.query.expression.value", issue.Path);
        Assert.IsNull(issue.NodeId);
    }

    [TestMethod]
    public void Validate_ParentDiagnostic_UsesParentIdentity()
    {
        var definition = Define(new GroupExpression { Id = "root", Operator = "and", Expressions = [] });

        var issue = _validator.Validate(definition).Issues.Single();
        Assert.AreEqual("emptyGroup", issue.Code);
        Assert.AreEqual("root", issue.NodeId);
    }

    [TestMethod]
    public void Validate_ParameterReusedAcrossDifferentTypes_ReturnsConflictAtSecondNode()
    {
        var definition = Define(new GroupExpression
        {
            Id = "root", Operator = "and",
            Expressions =
            [
                new ComparisonExpression { Id = "age", Field = "Age", Operator = "greaterThan", Parameter = "threshold" },
                new CollectionExpression
                {
                    Id = "orders", Collection = "Orders", Quantifier = "any",
                    Expression = new ComparisonExpression
                    {
                        Id = "total", Field = "Total", Operator = "greaterThan", Parameter = "threshold"
                    }
                }
            ]
        });
        var parameters = new Dictionary<string, JsonElement> { ["threshold"] = JsonSerializer.SerializeToElement(21) };

        var issue = _validator.Validate(definition, parameters).Issues.Single();
        Assert.AreEqual("conflictingParameterType", issue.Code);
        Assert.AreEqual("$.query.expressions[1].expression.parameter", issue.Path);
        Assert.AreEqual("total", issue.NodeId);
    }

    [TestMethod]
    public void Validate_NullCheckWithLiteral_ReturnsUnexpectedValue()
    {
        var definition = Define(new ComparisonExpression
        {
            Id = "null-check", Field = "FirstName", Operator = "isNull", Value = JsonSerializer.SerializeToElement("ignored")
        });

        var issue = _validator.Validate(definition).Issues.Single();
        Assert.AreEqual("unexpectedValue", issue.Code);
        Assert.AreEqual("null-check", issue.NodeId);
    }

    [TestMethod]
    public void Validate_NullCheckWithoutLiteral_RemainsValid()
    {
        var definition = Define(new ComparisonExpression { Field = "FirstName", Operator = "isNull" });
        Assert.IsTrue(_validator.Validate(definition).IsValid);
    }

    private static QueryDefinition Define(QueryExpression query) => new() { Entity = "Customer", Query = query };
}
