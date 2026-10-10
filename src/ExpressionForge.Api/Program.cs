using ExpressionForge.Api;
using ExpressionForge.Core;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton(QueryCatalog.CreateDemo());
builder.Services.AddSingleton<QueryValidator>();
builder.Services.AddSingleton<SqlServerQueryCompiler>();
builder.Services.AddSingleton<SqlServerQueryExecutor>();

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/query/metadata", (QueryCatalog catalog) => Results.Ok(new
{
    catalogVersion = catalog.Version,
    entities = catalog.Entities,
    operators = catalog.Operators,
    expressionTypes = new[] { "expression", "group", "collectionExpression", "not" },
    quantifiers = new[] { "any", "all", "none" },
    limits = new { maxDepth = QueryValidator.MaximumDepth, maxNodes = QueryValidator.MaximumNodes, maxRows = SqlServerQueryCompiler.MaximumRows }
}));

app.MapGet("/api/query/metadata/entities/{id}", (string id, QueryCatalog catalog) =>
{
    var entity = catalog.FindEntity(id);
    return entity is null ? Results.NotFound(new { error = "Unknown entity." }) : Results.Ok(entity);
});

app.MapPost("/api/query/validate", (QueryDefinition definition, QueryValidator validator) =>
    Results.Ok(validator.Validate(definition)));

app.MapPost("/api/query/describe", (QueryDefinition definition, QueryCatalog catalog, QueryValidator validator) =>
{
    var validation = validator.Validate(definition);
    if (!validation.IsValid) return Results.UnprocessableEntity(validation);
    var entity = catalog.FindEntity(definition.Entity)!;
    return Results.Ok(new
    {
        entity = entity.Id,
        columns = entity.Properties.Select(p => new ResultColumn(p.Id, p.DataType, p.Nullable))
    });
});

app.MapPost("/api/query/compile", (QueryDefinition definition, int? limit, SqlServerQueryCompiler compiler, QueryValidator validator) =>
{
    var validation = validator.Validate(definition);
    if (!validation.IsValid) return Results.UnprocessableEntity(validation);
    if (limit is < 1 or > SqlServerQueryCompiler.MaximumRows)
        return Results.BadRequest(new { error = $"Limit must be between 1 and {SqlServerQueryCompiler.MaximumRows}." });
    return Results.Ok(compiler.Compile(definition, limit ?? 25));
});

app.MapPost("/api/query/preview", async (QueryDefinition definition, int? limit, SqlServerQueryCompiler compiler,
    QueryValidator validator, SqlServerQueryExecutor executor, CancellationToken cancellationToken) =>
{
    var validation = validator.Validate(definition);
    if (!validation.IsValid) return Results.UnprocessableEntity(validation);
    if (limit is < 1 or > SqlServerQueryCompiler.MaximumRows)
        return Results.BadRequest(new { error = $"Limit must be between 1 and {SqlServerQueryCompiler.MaximumRows}." });
    if (!executor.IsConfigured)
        return Results.Problem("Configure ConnectionStrings__ExpressionForge to enable database preview.", statusCode: 503);
    var plan = compiler.Compile(definition, limit ?? 25);
    try
    {
        return Results.Ok(await executor.ExecuteAsync(plan, cancellationToken));
    }
    catch (Microsoft.Data.SqlClient.SqlException)
    {
        return Results.Problem("SQL Server query execution failed. Check the database schema, permissions and connection.", statusCode: 502);
    }
});

app.MapFallbackToFile("index.html");
app.Run();

public partial class Program { }
