using System.Data;
using System.Security.Claims;
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
                IsActive bit NOT NULL,
                StartedAt date NULL,
                FinishedAt date NULL,
                BalanceText nvarchar(64) NULL
            )
            """,
            """
            CREATE TABLE dbo.Orders (
                Id int NOT NULL PRIMARY KEY,
                CustomerId int NOT NULL REFERENCES dbo.Customers(Id),
                Total decimal(18, 2) NOT NULL,
                Status nvarchar(40) NULL,
                AmountText nvarchar(64) NULL
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
            """,
            """
            """
            UPDATE dbo.Customers SET BalanceText = CASE Id
                WHEN 1 THEN N'123.50' WHEN 2 THEN N'0'
                WHEN 3 THEN N'not-a-number' WHEN 5 THEN N'-2.75' END;
            UPDATE dbo.Orders SET AmountText = CASE Id
                WHEN 1 THEN N'120.50' WHEN 2 THEN N'unparsable'
                WHEN 3 THEN N'15' WHEN 4 THEN N'225' END;
            """,
            UPDATE dbo.Customers SET
                StartedAt = CASE Id
                    WHEN 1 THEN '2026-01-01' WHEN 2 THEN '2026-01-01'
                    WHEN 3 THEN '2026-02-10' WHEN 5 THEN '2026-03-01' END,
                FinishedAt = CASE Id
                    WHEN 1 THEN '2026-01-11' WHEN 2 THEN '2026-01-03'
                    WHEN 3 THEN '2026-02-01' WHEN 5 THEN '2026-03-08' END;
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
    public async Task Execute_FieldComparison_RespectsRootColumnValues()
    {
        await AssertIds(new FieldComparisonExpression
        {
            LeftField = "Id", Operator = "lessThan", RightField = "Age"
        }, "1,2,3,4,5");
    }

    [TestMethod]
    public async Task Execute_FieldComparisonInCollection_UsesChildColumns()
    {
        await AssertIds(Collection("any", new FieldComparisonExpression
        {
            LeftField = "Id", Operator = "greaterThan", RightField = "CustomerId"
        }), "1,2,3,4");
    }

    [TestMethod]
    public async Task Execute_TryParseDecimal_ConvertsValidTextAndExcludesInvalidOrNullValues()
    {
        var baseCatalog = QueryCatalog.CreateDemo();
        var catalog = new QueryCatalog(baseCatalog.Entities.Select(e => e.Id == "Customer" ? e with
        {
            Properties = [..e.Properties, new PropertyMetadata("BalanceText", "Balance text", "string", true,
                ["equals"])]
        } : e).ToArray(), baseCatalog.Operators);
        await AssertIds(new ArithmeticComparisonExpression
        {
            Left = new TryParseDecimalExpression { Field = "BalanceText" },
            Operator = "greaterThan",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(100m) }
        }, "1", schema: catalog);
        await AssertIds(new ArithmeticComparisonExpression
        {
            Left = new TryParseDecimalExpression { Field = "BalanceText" },
            Operator = "lessThan",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(0m) }
        }, "5", schema: catalog);
    }

    [TestMethod]
    public async Task Execute_TryParseDecimal_InCollection_PreservesScopedStringConversion()
    {
        var baseCatalog = QueryCatalog.CreateDemo();
        var catalog = new QueryCatalog(baseCatalog.Entities.Select(e => e.Id == "Order" ? e with
        {
            Properties = [..e.Properties, new PropertyMetadata("AmountText", "Amount text", "string", true,
                ["equals"])]
        } : e).ToArray(), baseCatalog.Operators);
        await AssertIds(Collection("any", new ArithmeticComparisonExpression
        {
            Left = new TryParseDecimalExpression { Field = "AmountText" },
            Operator = "greaterThan",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(100m) }
        }), "1,3", schema: catalog);
    }

    [TestMethod]
    public async Task Execute_StringLength_RespectsNullAndSqlLenSemantics()
    {
        await AssertIds(new ArithmeticComparisonExpression
        {
            Left = new StringLengthExpression { Field = "FirstName" },
            Operator = "greaterThanOrEqual",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(5m) }
        }, "3");
    }

    [TestMethod]
    public async Task Execute_StringLength_InNestedOrderCollectionUsesChildScope()
    {
        await AssertIds(Collection("any", new ArithmeticComparisonExpression
        {
            Left = new StringLengthExpression { Field = "Status" },
            Operator = "greaterThan",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(7m) }
        }), "1,3");
    }

    [TestMethod]
    [DataRow("greaterThan", 7, "1")]
    [DataRow("lessThan", 0, "3")]
    public async Task Execute_DateDiffDays_HandlesPositiveNegativeAndNullDates(string op, int threshold, string expected)
    {
        var baseCatalog = QueryCatalog.CreateDemo();
        var entities = baseCatalog.Entities.Select(e => e.Id == "Customer" ? e with
        {
            Properties = [.. e.Properties,
                new PropertyMetadata("StartedAt", "Started", "date", true, []),
                new PropertyMetadata("FinishedAt", "Finished", "date", true, [])]
        } : e).ToArray();
        var builder = new QueryCatalogBuilder();
        foreach (var entity in entities) builder.AddEntity(entity);
        foreach (var registeredOperator in baseCatalog.Operators) builder.AddOperator(registeredOperator);
        var catalog = builder.Build();
        await AssertIds(new ArithmeticComparisonExpression
        {
            Left = new DateDiffDaysExpression { StartField = "StartedAt", EndField = "FinishedAt" },
            Operator = op,
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement((decimal)threshold) }
        }, expected, schema: catalog);
    }

    [TestMethod]
    public async Task Execute_NumericSubtraction_FiltersRootRows()
    {
        await AssertIds(new ArithmeticComparisonExpression
        {
            Left = new NumericBinaryExpression
            {
                Operator = "subtract",
                Left = new NumericFieldExpression { Field = "Age" },
                Right = new NumericFieldExpression { Field = "Id" }
            },
            Operator = "greaterThan",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(20m) }
        }, "1,3,5");
    }

    [TestMethod]
    public async Task Execute_NumericArithmetic_InCollectionUsesScopedSqlAndParameters()
    {
        await AssertIds(Collection("any", new ArithmeticComparisonExpression
        {
            Left = new NumericBinaryExpression
            {
                Operator = "subtract",
                Left = new NumericFieldExpression { Field = "Total" },
                Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(100m) }
            },
            Operator = "greaterThan",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(20m) }
        }), "1,3");
    }

    [TestMethod]
    public async Task Execute_DivisionByZeroLiteral_ReturnsNoRowsWithoutSqlError()
    {
        await AssertIds(new ArithmeticComparisonExpression
        {
            Left = new NumericBinaryExpression
            {
                Operator = "divide",
                Left = new NumericFieldExpression { Field = "Age" },
                Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(0m) }
            },
            Operator = "greaterThan",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(10m) }
        }, "");
    }

    [TestMethod]
    [DataRow(0, "")]
    [DataRow(2, "1,3,5")]
    public async Task Execute_DivisionByRuntimeZeroOrPositive_ReturnsExpectedRows(int divisor, string expected)
    {
        var predicate = new ArithmeticComparisonExpression
        {
            Left = new NumericBinaryExpression
            {
                Operator = "divide",
                Left = new NumericFieldExpression { Field = "Age" },
                Right = new NumericParameterExpression { Parameter = "divisor" }
            },
            Operator = "greaterThan",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(10m) }
        };
        var bindings = new Dictionary<string, JsonElement>
        {
            ["divisor"] = JsonSerializer.SerializeToElement((decimal)divisor)
        };
        await AssertIds(predicate, expected, bindings);
    }

    [TestMethod]
    [DataRow(0, "")]
    [DataRow(2, "1,3")]
    public async Task Execute_DivisionWithinCollection_PreservesScopeAndZeroSemantics(int divisor, string expected)
    {
        var expression = new ArithmeticComparisonExpression
        {
            Left = new NumericBinaryExpression
            {
                Operator = "divide",
                Left = new NumericFieldExpression { Field = "Total" },
                Right = new NumericParameterExpression { Parameter = "divisor" }
            },
            Operator = "greaterThan",
            Right = new NumericLiteralExpression { Value = JsonSerializer.SerializeToElement(75m) }
        };
        var bindings = new Dictionary<string, JsonElement>
        {
            ["divisor"] = JsonSerializer.SerializeToElement((decimal)divisor)
        };
        await AssertIds(Collection("any", expression), expected, bindings);
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

    [TestMethod]
    public async Task Execute_AuthorizedCatalog_OnlyReturnsPermittedColumnsAndRows()
    {
        Assert.IsNotNull(_database);
        var rules = QueryAccessCatalogs.Parse(_catalog, """
            {
              "roles": [{
                "role": "analyst",
                "entities": [
                  { "entity": "Customer", "properties": ["Id", "Age"], "relationships": ["Orders"] },
                  { "entity": "Order", "properties": ["Total"], "relationships": [] }
                ]
              }]
            }
            """);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.Role, "analyst")], "verified-test-auth"));
        var scoped = rules.ForUser(principal)!;
        var definition = new QueryDefinition
        {
            Entity = "Customer",
            Query = Collection("any", Compare("Total", "greaterThan", 100m))
        };
        var plan = new SqlServerQueryCompiler(scoped, new QueryValidator(scoped)).Compile(definition);
        CollectionAssert.AreEqual(new[] { "Id", "Age" }, plan.Columns.Select(column => column.Name).ToArray());
        Assert.IsFalse(plan.Sql.Contains("FirstName", StringComparison.Ordinal));

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
        }

        var ids = new List<int>();
        await using var reader = await command.ExecuteReaderAsync(TestContext.CancellationToken);
        Assert.AreEqual(2, reader.FieldCount);
        Assert.AreEqual("Id", reader.GetName(0));
        Assert.AreEqual("Age", reader.GetName(1));
        while (await reader.ReadAsync(TestContext.CancellationToken))
            ids.Add(reader.GetInt32(0));
        CollectionAssert.AreEquivalent(new[] { 1, 3, 4 }, ids.ToArray());
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
        IReadOnlyDictionary<string, JsonElement>? bindings = null, QueryCatalog? schema = null)
    {
        Assert.IsNotNull(_database);
        var definition = new QueryDefinition { Entity = "Customer", Query = query };
        var selected = schema ?? _catalog;
        var compiler = new SqlServerQueryCompiler(selected, new QueryValidator(selected));
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
