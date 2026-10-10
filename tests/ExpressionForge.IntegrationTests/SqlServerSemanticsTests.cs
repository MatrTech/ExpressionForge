using System.Data;
using System.Text.Json;
using ExpressionForge.Core;
using Microsoft.Data.SqlClient;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Testcontainers.MsSql;

namespace ExpressionForge.IntegrationTests;

[TestClass]
[TestCategory("Integration")]
public sealed class SqlServerSemanticsTests
{
    private static MsSqlContainer? _database;
    private static QueryCatalog _catalog = null!;

    public TestContext TestContext { get; set; } = null!;

    [ClassInitialize]
    public static async Task Initialize(TestContext context)
    {
        _database = new MsSqlBuilder().WithImage("mcr.microsoft.com/mssql/server:2022-latest").Build();
        await _database.StartAsync(context.CancellationToken);

        var demo = QueryCatalog.CreateDemo();
        var entities = demo.Entities.Select(entity => entity.Id switch
        {
            "Customer" => entity with
            {
                Properties = entity.Properties.Select(field =>
                    field.Id == "FirstName" ? field with { Nullable = true } : field).ToArray()
            },
            "Order" => entity with
            {
                Properties = entity.Properties.Select(field =>
                    field.Id == "Status" ? field with { Nullable = true } : field).ToArray()
            },
            _ => entity
        }).ToArray();
        _catalog = new QueryCatalog(entities, demo.Operators);

        await using var connection = new SqlConnection(_database.GetConnectionString());
        await connection.OpenAsync(context.CancellationToken);
        var commands = new[]
        {
            """
            CREATE TABLE dbo.Customers (
                Id int NOT NULL PRIMARY KEY,
                FirstName nvarchar(120) NULL,
                Age int NOT NULL,
                IsActive bit NOT NULL
            )
            """,
            """
            CREATE TABLE dbo.Orders (
                Id int NOT NULL PRIMARY KEY,
                CustomerId int NOT NULL REFERENCES dbo.Customers(Id),
                Total decimal(18, 2) NOT NULL,
                Status nvarchar(40) NULL
            )
            """,
            """
            CREATE TABLE dbo.Projects (
                Id int NOT NULL PRIMARY KEY,
                Name nvarchar(120) NOT NULL,
                Budget decimal(18, 2) NOT NULL,
                Archived bit NOT NULL
            )
            """,
            """
            CREATE TABLE dbo.Tasks (
                Id int NOT NULL PRIMARY KEY,
                ProjectId int NOT NULL REFERENCES dbo.Projects(Id),
                Hours decimal(18, 2) NOT NULL,
                State nvarchar(40) NOT NULL
            )
            """,
            """
            INSERT INTO dbo.Projects (Id, Name, Budget, Archived) VALUES
                (1, N'Platform', 20000, 0), (2, N'Prototype', 9000, 0),
                (3, N'Legacy', 30000, 1), (4, N'Quick fix', 15000, 0),
                (5, N'Finished', 25000, 0), (6, N'Expansion', 50000, 0);
            INSERT INTO dbo.Tasks (Id, ProjectId, Hours, State) VALUES
                (1, 1, 20, N'Open'), (2, 2, 20, N'Open'), (3, 3, 25, N'Open'),
                (4, 4, 8, N'Open'), (5, 5, 40, N'Closed'), (6, 6, 18, N'Open');
            """,
            """
            INSERT INTO dbo.Customers (Id, FirstName, Age, IsActive) VALUES
                (1, N'John', 27, 1), (2, N'John', 16, 0), (3, N'Alice', 34, 1),
                (4, N'John', 17, 1), (5, NULL, 40, 1);
            INSERT INTO dbo.Orders (Id, CustomerId, Total, Status) VALUES
                (1, 1, 160.00, N'Completed'), (2, 1, 25.00, N'Pending'),
                (3, 2, 15.00, N'Pending'), (4, 3, 250.00, N'Completed'),
                (5, 4, 120.00, NULL);
            """
        };

        foreach (var sql in commands)
        {
            await using var command = new SqlCommand(sql, connection);
            await command.ExecuteNonQueryAsync(context.CancellationToken);
        }
    }

    [ClassCleanup]
    public static async Task Cleanup()
    {
        if (_database is not null)
            await _database.DisposeAsync();
    }

    [TestMethod]
    [DataRow("any", "1,3,4")]
    [DataRow("none", "2,5")]
    [DataRow("all", "3,4,5")]
    public async Task Execute_CollectionQuantifier_RespectsEmptyCollections(string quantifier, string expected)
    {
        var query = Collection(quantifier, Compare("Total", "greaterThan", 100m));
        await AssertIds(query, expected);
    }

    [TestMethod]
    public async Task Execute_AllWithUnknownPredicate_ExcludesNullMatchingRows()
    {
        var query = Collection("all", Compare("Status", "notEquals", "Cancelled"));
        await AssertIds(query, "1,2,3,5");
    }

    [TestMethod]
    public async Task Execute_AnyIsNull_MatchesNullableChildField()
    {
        var query = Collection("any", new ComparisonExpression { Field = "Status", Operator = "isNull" });
        await AssertIds(query, "4");
    }

    [TestMethod]
    public async Task Execute_IsNull_MatchesNullableRootField()
    {
        var query = new ComparisonExpression { Field = "FirstName", Operator = "isNull" };
        await AssertIds(query, "5");
    }

    [TestMethod]
    public async Task Execute_NotEquals_ExcludesUnknownNullComparison()
    {
        await AssertIds(Compare("FirstName", "notEquals", "John"), "3");
    }

    [TestMethod]
    public async Task Execute_NegatedCollection_RespectsNonMatchingAndEmptyCollections()
    {
        var query = new NotExpression { Expression = Collection("any", Compare("Total", "greaterThan", 100m)) };
        await AssertIds(query, "2,5");
    }

    [TestMethod]
    public async Task Execute_RuntimeBinding_UsesTypedValueInCorrelatedCollection()
    {
        var query = Collection("any", new ComparisonExpression
        {
            Field = "Total", Operator = "greaterThan", Parameter = "minimumTotal"
        });
        var bindings = new Dictionary<string, JsonElement>
        {
            ["minimumTotal"] = JsonSerializer.SerializeToElement(100m)
        };
        await AssertIds(query, "1,3,4", bindings);
    }

    [TestMethod]
    public async Task Execute_UntrustedRuntimeString_IsNotExecutedAsSql()
    {
        var query = new ComparisonExpression { Field = "FirstName", Operator = "contains", Parameter = "search" };
        var bindings = new Dictionary<string, JsonElement>
        {
            ["search"] = JsonSerializer.SerializeToElement("John'; DROP TABLE dbo.Customers;--")
        };
        await AssertIds(query, "", bindings);
        await AssertIds(Compare("Id", "greaterThan", 0), "1,2,3,4,5");
    }

    [TestMethod]
    [DataRow("loyal-spenders", "1,3")]
    [DataRow("quiet-accounts", "1,3")]
    [DataRow("premium-only", "3")]
    [DataRow("segmentation", "1,2,3")]
    [DataRow("all-clear", "3")]
    public async Task Execute_PublishedShowcaseExample_MatchesRealSqlServerRows(string exampleId, string expected)
    {
        var json = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "examples.json"), TestContext.CancellationToken);
        using var document = JsonDocument.Parse(json);
        var example = document.RootElement.EnumerateArray()
            .Single(item => item.GetProperty("id").GetString() == exampleId);
        var definition = JsonSerializer.Deserialize<QueryDefinition>(
            example.GetProperty("definition").GetRawText(), ExpressionForgeJson.CreateOptions())!;
        var bindings = example.GetProperty("parameters").EnumerateObject().ToDictionary(
            item => item.Name, item => item.Value.GetProperty("value").Clone(), StringComparer.Ordinal);

        await AssertIds(definition.Query, expected, bindings);
    }

    [TestMethod]
    public async Task Execute_CustomRegisteredCatalog_ReturnsExpectedProjectIds()
    {
        Assert.IsNotNull(_database);
        var catalog = QueryCatalogFile.Load(Path.Combine(AppContext.BaseDirectory, "project-catalog.json"));
        using var document = JsonDocument.Parse(await File.ReadAllTextAsync(
            Path.Combine(AppContext.BaseDirectory, "project-query.json"), TestContext.CancellationToken));
        var definition = JsonSerializer.Deserialize<QueryDefinition>(
            document.RootElement.GetProperty("definition"), ExpressionForgeJson.CreateOptions())!;
        var bindings = document.RootElement.GetProperty("parameters").EnumerateObject().ToDictionary(
            item => item.Name, item => item.Value.Clone(), StringComparer.Ordinal);
        var plan = new SqlServerQueryCompiler(catalog, new QueryValidator(catalog)).Compile(definition, 100, bindings);

        await using var connection = new SqlConnection(_database.GetConnectionString());
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = new SqlCommand(plan.Sql, connection) { CommandTimeout = 30 };
        foreach (var parameter in plan.Parameters)
        {
            var sqlParameter = command.Parameters.Add(parameter.Name, parameter.DbType switch
            {
                DbType.Int32 => SqlDbType.Int,
                DbType.Decimal => SqlDbType.Decimal,
                DbType.Boolean => SqlDbType.Bit,
                DbType.String => SqlDbType.NVarChar,
                _ => throw new NotSupportedException(parameter.DbType.ToString())
            });
            sqlParameter.Value = parameter.Value;
            if (parameter.DbType == DbType.Decimal)
            {
                sqlParameter.Precision = 38;
                sqlParameter.Scale = 10;
            }
            if (parameter.DbType == DbType.String)
                sqlParameter.Size = Math.Max(1, ((string)parameter.Value).Length);
        }

        var ids = new List<int>();
        await using var reader = await command.ExecuteReaderAsync(TestContext.CancellationToken);
        while (await reader.ReadAsync(TestContext.CancellationToken))
            ids.Add(reader.GetInt32(0));
        CollectionAssert.AreEquivalent(new[] { 1, 6 }, ids.ToArray());
    }

    private static ComparisonExpression Compare<T>(string field, string op, T value) => new()
    {
        Field = field, Operator = op, Value = JsonSerializer.SerializeToElement(value)
    };

    private static CollectionExpression Collection(string quantifier, QueryExpression predicate) => new()
    {
        Collection = "Orders", Quantifier = quantifier, Expression = predicate
    };

    private async Task AssertIds(QueryExpression query, string expected,
        IReadOnlyDictionary<string, JsonElement>? bindings = null)
    {
        Assert.IsNotNull(_database);
        var definition = new QueryDefinition { Entity = "Customer", Query = query };
        var compiler = new SqlServerQueryCompiler(_catalog, new QueryValidator(_catalog));
        var plan = compiler.Compile(definition, 100, bindings);
        var actual = new List<int>();

        await using var connection = new SqlConnection(_database.GetConnectionString());
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = new SqlCommand(plan.Sql, connection) { CommandTimeout = 30 };
        foreach (var parameter in plan.Parameters)
        {
            var sqlParameter = command.Parameters.Add(parameter.Name, parameter.DbType switch
            {
                DbType.Int32 => SqlDbType.Int,
                DbType.Decimal => SqlDbType.Decimal,
                DbType.Boolean => SqlDbType.Bit,
                DbType.String => SqlDbType.NVarChar,
                _ => throw new NotSupportedException(parameter.DbType.ToString())
            });
            sqlParameter.Value = parameter.Value;
            if (parameter.DbType == DbType.String)
                sqlParameter.Size = Math.Max(1, ((string)parameter.Value).Length);
            if (parameter.DbType == DbType.Decimal)
            {
                sqlParameter.Precision = 38;
                sqlParameter.Scale = 10;
            }
        }

        await using var reader = await command.ExecuteReaderAsync(TestContext.CancellationToken);
        while (await reader.ReadAsync(TestContext.CancellationToken))
            actual.Add(reader.GetInt32(0));

        var expectedIds = expected.Length == 0 ? Array.Empty<int>() : expected.Split(',').Select(int.Parse).ToArray();
        CollectionAssert.AreEquivalent(expectedIds, actual.ToArray());
    }
}
