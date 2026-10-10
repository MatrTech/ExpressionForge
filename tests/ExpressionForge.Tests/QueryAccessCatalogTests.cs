using System.Security.Claims;
using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class QueryAccessCatalogTests
{
    private const string Rules = """
        {
          "roles": [
            {
              "role": "analyst",
              "entities": [
                { "entity": "Customer", "properties": ["Id", "Age", "IsActive"], "relationships": ["Orders"] },
                { "entity": "Order", "properties": ["Total"], "relationships": [] }
              ]
            },
            {
              "role": "viewer",
              "entities": [
                { "entity": "Customer", "properties": ["Id"], "relationships": [] }
              ]
            },
            {
              "role": "order-reader",
              "entities": [
                { "entity": "Order", "properties": ["Id", "Status"], "relationships": [] }
              ]
            }
          ]
        }
        """;

    private static QueryAccessCatalogs Restricted => QueryAccessCatalogs.Parse(QueryCatalog.CreateDemo(), Rules);

    private static ClaimsPrincipal Principal(params string[] roles) =>
        new(new ClaimsIdentity(roles.Select(role => new Claim(ClaimTypes.Role, role)), "verified-test-auth"));

    private static QueryDefinition Compare(string entity, string field, string op, object value) =>
        new() { Entity = entity, Query = new ComparisonExpression { Field = field, Operator = op, Value = JsonSerializer.SerializeToElement(value) } };

    [TestMethod]
    public void ForUser_AnonymousAndUnknownRole_DeniesAccess()
    {
        var policy = Restricted;
        Assert.IsTrue(policy.IsRestricted);
        Assert.IsNull(policy.ForUser(new ClaimsPrincipal()));
        Assert.IsNull(policy.ForUser(Principal("not-listed")));
    }

    [TestMethod]
    public void ForUser_AnalystRole_ExcludesHiddenFieldsFromDiscovery()
    {
        var catalog = Restricted.ForUser(Principal("analyst"))!;
        var customer = catalog.FindEntity("Customer")!;
        CollectionAssert.AreEquivalent(new[] { "Id", "Age", "IsActive" }, customer.Properties.Select(p => p.Id).ToArray());
        CollectionAssert.AreEqual(new[] { "Orders" }, customer.Relationships.Select(r => r.Id).ToArray());
        CollectionAssert.AreEqual(new[] { "Total" }, catalog.FindEntity("Order")!.Properties.Select(p => p.Id).ToArray());

        var json = JsonSerializer.Serialize(customer, ExpressionForgeJson.CreateOptions());
        Assert.IsFalse(json.Contains("FirstName", StringComparison.Ordinal));
        Assert.IsFalse(json.Contains("parentKey", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(json.Contains("childForeignKey", StringComparison.OrdinalIgnoreCase));
    }

    [TestMethod]
    public void Compile_RestrictedProjection_DoesNotReturnHiddenColumns()
    {
        var catalog = Restricted.ForUser(Principal("analyst"))!;
        var definition = Compare("Customer", "Age", "greaterThan", 21);
        var validator = new QueryValidator(catalog);
        var plan = new SqlServerQueryCompiler(catalog, validator).Compile(definition);

        CollectionAssert.AreEquivalent(new[] { "Id", "Age", "IsActive" }, plan.Columns.Select(c => c.Name).ToArray());
        Assert.IsFalse(plan.Sql.Contains("FirstName", StringComparison.Ordinal));
        StringAssert.Contains(plan.Sql, "[t0].[Age]");
    }

    [TestMethod]
    public void Validate_HiddenFieldAndRelationship_RejectsClientSuppliedAst()
    {
        var catalog = Restricted.ForUser(Principal("viewer"))!;
        var validator = new QueryValidator(catalog);
        var field = validator.Validate(Compare("Customer", "Age", "equals", 21));
        Assert.AreEqual("unknownField", field.Issues.Single().Code);

        var relation = new QueryDefinition
        {
            Entity = "Customer",
            Query = new CollectionExpression
            {
                Collection = "Orders", Quantifier = "any",
                Expression = new ComparisonExpression { Field = "Total", Operator = "greaterThan", Value = JsonSerializer.SerializeToElement(100) }
            }
        };
        Assert.AreEqual("unknownCollection", validator.Validate(relation).Issues.Single().Code);
        Assert.ThrowsException<QueryValidationException>(() => new SqlServerQueryCompiler(catalog, validator).Compile(relation));
    }

    [TestMethod]
    public void Validate_UnavailableRootEntity_RejectsClientSuppliedAst()
    {
        var catalog = Restricted.ForUser(Principal("viewer"))!;
        Assert.AreEqual("unknownEntity", new QueryValidator(catalog)
            .Validate(Compare("Order", "Id", "equals", 1)).Issues.Single().Code);
    }

    [TestMethod]
    public void Compile_HiddenJoinKeys_RemainUsableForAuthorizedTraversal()
    {
        var catalog = Restricted.ForUser(Principal("analyst"))!;
        var definition = new QueryDefinition
        {
            Entity = "Customer",
            Query = new CollectionExpression
            {
                Collection = "Orders", Quantifier = "any",
                Expression = new ComparisonExpression { Field = "Total", Operator = "greaterThan", Value = JsonSerializer.SerializeToElement(100) }
            }
        };
        var validator = new QueryValidator(catalog);
        Assert.IsTrue(validator.Validate(definition).IsValid);
        var plan = new SqlServerQueryCompiler(catalog, validator).Compile(definition);
        StringAssert.Contains(plan.Sql, "[t1].[CustomerId] = [t0].[Id]");
        Assert.IsFalse(plan.Columns.Any(c => c.Name == "CustomerId"));
        Assert.IsFalse(plan.Sql.Contains("FirstName", StringComparison.Ordinal));
    }

    [TestMethod]
    public void ForUser_MultipleRoles_UnionsAllowlistedFieldsAndRelationships()
    {
        var catalog = Restricted.ForUser(Principal("analyst", "order-reader"))!;
        CollectionAssert.AreEquivalent(new[] { "Id", "Total", "Status" },
            catalog.FindEntity("Order")!.Properties.Select(p => p.Id).ToArray());
        Assert.AreEqual(1, catalog.FindEntity("Customer")!.Relationships.Count);
        Assert.IsTrue(new QueryValidator(catalog).Validate(Compare("Order", "Status", "equals", "Open")).IsValid);
    }

    [TestMethod]
    public void Resolve_ViewerRole_NeverExposesUnlistedProperties()
    {
        var catalog = Restricted.ForUser(Principal("viewer"))!;
        var result = new QueryScopeResolver(catalog).Resolve(Compare("Customer", "Id", "equals", 1));
        Assert.IsTrue(result.IsValid);
        CollectionAssert.AreEqual(new[] { "Id" }, result.Scopes.Single().Properties.Select(p => p.Id).ToArray());
        Assert.AreEqual(0, result.Scopes.Single().Relationships.Count);
    }

    [TestMethod]
    public void Revision_ChangedEffectivePermissions_InvalidatesPinnedQuery()
    {
        var policy = Restricted;
        var analyst = policy.ForUser(Principal("analyst"))!;
        var viewer = policy.ForUser(Principal("viewer"))!;
        Assert.AreNotEqual(analyst.Revision, viewer.Revision);

        var definition = Compare("Customer", "Id", "equals", 1) with { CatalogRevision = analyst.Revision };
        Assert.IsTrue(new QueryValidator(analyst).Validate(definition).IsValid);
        Assert.AreEqual("catalogRevisionMismatch", new QueryValidator(viewer).Validate(definition).Issues.Single().Code);
    }

    [TestMethod]
    public void ForUser_NoPolicy_PreservesUnrestrictedDemo()
    {
        var original = QueryCatalog.CreateDemo();
        var policy = QueryAccessCatalogs.Unrestricted(original);
        Assert.IsFalse(policy.IsRestricted);
        Assert.AreSame(original, policy.ForUser(new ClaimsPrincipal()));
    }

    [TestMethod]
    public void Parse_UnknownMember_RejectsTrustedConfiguration()
    {
        var rules = Rules.Replace("\"Age\"", "\"PasswordHash\"", StringComparison.Ordinal);
        Assert.ThrowsException<InvalidOperationException>(() => QueryAccessCatalogs.Parse(QueryCatalog.CreateDemo(), rules));
    }

    [TestMethod]
    public void Parse_DuplicateRole_RejectsTrustedConfiguration()
    {
        var rules = Rules.Replace("\"order-reader\"", "\"analyst\"", StringComparison.Ordinal);
        Assert.ThrowsException<InvalidOperationException>(() => QueryAccessCatalogs.Parse(QueryCatalog.CreateDemo(), rules));
    }

    [TestMethod]
    public void Parse_EmptyPermissions_RejectsTrustedConfiguration()
    {
        var rules = Rules.Replace("\"properties\": [\"Id\"]", "\"properties\": []", StringComparison.Ordinal);
        Assert.ThrowsException<InvalidOperationException>(() => QueryAccessCatalogs.Parse(QueryCatalog.CreateDemo(), rules));
    }
}
