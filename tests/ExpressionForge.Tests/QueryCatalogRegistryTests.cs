using System.Security.Claims;
using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ExpressionForge.Tests;

[TestClass]
public sealed class QueryCatalogRegistryTests
{
    private static string RegistryPath => Path.Combine(AppContext.BaseDirectory, "catalog-registry.json");

    [TestMethod]
    public void Load_DemoAndJsonProviders_ExposeDistinctDomains()
    {
        var registry = QueryCatalogRegistryFile.Load(RegistryPath);
        var catalogs = registry.Discover(new ClaimsPrincipal());
        Assert.IsFalse(registry.IsRestricted);
        Assert.AreEqual("customers", registry.DefaultId);
        CollectionAssert.AreEquivalent(new[] { "customers", "projects" }, catalogs.Select(c => c.Id).ToArray());
        Assert.IsNotNull(registry.ForUser("customers", null)!.FindEntity("Customer"));
        Assert.IsNull(registry.ForUser("customers", null)!.FindEntity("Project"));
        Assert.IsNotNull(registry.ForUser("projects", null)!.FindEntity("Project"));
        Assert.IsNull(registry.ForUser("projects", null)!.FindEntity("Customer"));
        Assert.AreNotEqual(catalogs[0].CatalogRevision, catalogs[1].CatalogRevision);
    }

    [TestMethod]
    public void ForUser_UnknownCatalog_DeniesResolution()
    {
        var registry = QueryCatalogRegistryFile.Load(RegistryPath);
        Assert.IsNull(registry.ForUser("does-not-exist", new ClaimsPrincipal()));
        Assert.AreSame(registry.ForUser("customers", null), registry.ForUser(null, null));
    }

    [TestMethod]
    public void Registry_MixedPublicAndRestrictedCatalogs_FailsClosed()
    {
        var demo = QueryCatalog.CreateDemo();
        var restricted = QueryAccessCatalogs.Parse(demo, """
            {"roles":[{"role":"reader","entities":[
                {"entity":"Customer","properties":["Id"],"relationships":[]}
            ]}]}
            """);
        var builder = new QueryCatalogRegistryBuilder()
            .Add("public", "Public", QueryAccessCatalogs.Unrestricted(demo))
            .Add("restricted", "Restricted", restricted);
        Assert.ThrowsException<InvalidOperationException>(() => builder.Build("public"));
    }

    [TestMethod]
    public void Discover_RestrictedCatalogs_ExcludeRolesWithoutGrants()
    {
        var demo = QueryCatalog.CreateDemo();
        var reader = QueryAccessCatalogs.Parse(demo, """
            {"roles":[{"role":"reader","entities":[
                {"entity":"Customer","properties":["Id"],"relationships":[]}
            ]}]}
            """);
        var manager = QueryAccessCatalogs.Parse(demo, """
            {"roles":[{"role":"manager","entities":[
                {"entity":"Customer","properties":["Id","Age"],"relationships":[]}
            ]}]}
            """);
        var registry = new QueryCatalogRegistryBuilder().Add("reader", "Reader", reader)
            .Add("manager", "Manager", manager).Build("reader");
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "manager")], "verified"));
        CollectionAssert.AreEqual(new[] { "manager" }, registry.Discover(principal).Select(c => c.Id).ToArray());
        Assert.IsNull(registry.ForUser("reader", principal));
        Assert.IsNotNull(registry.ForUser("manager", principal));
        Assert.AreEqual(0, registry.Discover(new ClaimsPrincipal()).Count);
    }

    [TestMethod]
    public void Registry_DuplicateOrUnknownDefault_RejectsConfiguration()
    {
        var catalog = QueryAccessCatalogs.Unrestricted(QueryCatalog.CreateDemo());
        var builder = new QueryCatalogRegistryBuilder().Add("a", "A", catalog);
        Assert.ThrowsException<InvalidOperationException>(() => builder.Add("a", "Another A", catalog));
        Assert.ThrowsException<InvalidOperationException>(() => builder.Build("not-registered"));
        Assert.ThrowsException<InvalidOperationException>(() => builder.Add("../unsafe", "Unsafe", catalog));
    }

    [TestMethod]
    public void Ast_ExplicitCatalogId_RoundTripsWithoutChangingVersion()
    {
        var query = new QueryDefinition
        {
            CatalogId = "projects", Entity = "Project",
            Query = new ComparisonExpression { Field = "Id", Operator = "equals", Value = JsonSerializer.SerializeToElement(1) }
        };
        var json = JsonSerializer.Serialize(query, ExpressionForgeJson.CreateOptions());
        var deserialized = JsonSerializer.Deserialize<QueryDefinition>(json, ExpressionForgeJson.CreateOptions())!;
        Assert.AreEqual(1, deserialized.Version);
        Assert.AreEqual("projects", deserialized.CatalogId);
        Assert.AreEqual("Project", deserialized.Entity);
    }

    [TestMethod]
    public void Ast_WithoutCatalogId_RemainsBackwardsCompatible()
    {
        var query = new QueryDefinition
        {
            Entity = "Customer", Query = new ComparisonExpression
            { Field = "Id", Operator = "equals", Value = JsonSerializer.SerializeToElement(1) }
        };
        var json = JsonSerializer.Serialize(query, ExpressionForgeJson.CreateOptions());
        Assert.IsFalse(json.Contains("catalogId", StringComparison.Ordinal));
        Assert.IsTrue(new QueryValidator(QueryCatalogRegistryFile.Load(RegistryPath).ForUser(null, null)!).Validate(query).IsValid);
    }

    [TestMethod]
    public void Load_CustomProvider_UsesRegisteredSourceWithoutChangingEngine()
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path, """
                {"defaultCatalog":"other","catalogs":[
                    {"id":"other","displayName":"Other domain","source":"custom"}
                ]}
                """);
            var registry = QueryCatalogRegistryFile.Load(path, [new CustomSource()]);
            Assert.IsNotNull(registry.ForUser("other", null)!.FindEntity("Customer"));
            Assert.AreEqual("other", registry.Discover(null).Single().Id);
        }
        finally { File.Delete(path); }
    }

    [TestMethod]
    public void Load_UnsupportedSource_RejectsTrustedManifest()
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path, """
                {"defaultCatalog":"unsafe","catalogs":[
                    {"id":"unsafe","displayName":"Unsafe","source":"executeSql"}
                ]}
                """);
            Assert.ThrowsException<InvalidOperationException>(() => QueryCatalogRegistryFile.Load(path));
        }
        finally { File.Delete(path); }
    }

    private sealed class CustomSource : IQueryCatalogSource
    {
        public string Kind => "custom";
        public QueryCatalog Load(string? location) => QueryCatalog.CreateDemo();
    }
}
