using System.Text.Json;
using ExpressionForge.Api;
using ExpressionForge.Core;
using Microsoft.AspNetCore.Authentication.JwtBearer;

var builder = WebApplication.CreateBuilder(args);
var catalogFile = builder.Configuration["ExpressionForge:CatalogFile"];
var catalog = string.IsNullOrWhiteSpace(catalogFile)
    ? QueryCatalog.CreateDemo()
    : QueryCatalogFile.Load(Path.GetFullPath(catalogFile, builder.Environment.ContentRootPath));

// Access grants are trusted SERVER-SIDE configuration. No endpoint accepts role/grant data from clients.
var accessFile = builder.Configuration["ExpressionForge:AccessFile"];
var access = string.IsNullOrWhiteSpace(accessFile)
    ? QueryAccessCatalogs.Unrestricted(catalog)
    : QueryAccessCatalogs.Load(catalog, Path.GetFullPath(accessFile, builder.Environment.ContentRootPath));

if (access.IsRestricted)
{
    var authority = builder.Configuration["ExpressionForge:Authorization:Authority"];
    var audience = builder.Configuration["ExpressionForge:Authorization:Audience"];
    if (!Uri.TryCreate(authority, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
        string.IsNullOrWhiteSpace(audience))
        throw new InvalidOperationException("Restricted catalogs require an HTTPS JWT authority and an audience.");

    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
    {
        options.Authority = authority;
        options.Audience = audience;
        options.RequireHttpsMetadata = true;
    });
    builder.Services.AddAuthorization();
}
builder.Services.AddSingleton<SqlServerQueryExecutor>();

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();
if (access.IsRestricted)
{
    app.UseAuthentication();
    app.UseAuthorization();
}

var api = app.MapGroup("/api/query");
if (access.IsRestricted) api.RequireAuthorization();

// The same per-request catalog drives discovery, semantic validation, SQL projections and preview.
// An anonymous/ungranted principal cannot produce a usable catalog in restricted mode.
api.AddEndpointFilter(async (invocation, next) =>
{
    var scoped = access.ForUser(invocation.HttpContext.User);
    if (scoped is null) return Results.StatusCode(StatusCodes.Status403Forbidden);
    invocation.HttpContext.Items[typeof(QueryCatalog)] = scoped;
    return await next(invocation);
});

api.MapGet("/metadata", (HttpContext http) =>
{
    var current = CurrentCatalog(http);
    return Results.Ok(new
    {
        catalogVersion = current.Version,
        catalogRevision = current.Revision,
        entities = current.Entities,
        operators = current.Operators,
        expressionTypes = new[] { "expression", "group", "collectionExpression", "not" },
        quantifiers = new[] { "any", "all", "none" },
        limits = new { maxDepth = QueryValidator.MaximumDepth, maxNodes = QueryValidator.MaximumNodes, maxRows = SqlServerQueryCompiler.MaximumRows }
    });
});

api.MapGet("/metadata/entities/{id}", (string id, HttpContext http) =>
{
    var entity = CurrentCatalog(http).FindEntity(id);
    return entity is null ? Results.NotFound(new { error = "Unknown entity." }) : Results.Ok(entity);
});

api.MapPost("/metadata/scopes", (QueryDefinition definition, HttpContext http) =>
    Results.Ok(new QueryScopeResolver(CurrentCatalog(http)).Resolve(definition)));

api.MapPost("/validate", (QueryDefinition definition, HttpContext http) =>
    Results.Ok(CurrentValidator(http).Validate(definition)));

api.MapPost("/describe", (QueryDefinition definition, HttpContext http) =>
{
    var validation = CurrentValidator(http).Validate(definition);
    if (!validation.IsValid) return Results.UnprocessableEntity(validation);
    var entity = CurrentCatalog(http).FindEntity(definition.Entity)!;
    return Results.Ok(new
    {
        entity = entity.Id,
        columns = entity.Properties.Select(p => new ResultColumn(p.Id, p.DataType, p.Nullable))
    });
});

api.MapPost("/compile", (QueryDefinition definition, int? limit, HttpContext http) =>
    Compile(definition, null, limit, http));

api.MapPost("/preview", (QueryDefinition definition, int? limit, HttpContext http,
    SqlServerQueryExecutor executor, CancellationToken cancellationToken) =>
    Preview(definition, null, limit, http, executor, cancellationToken));

api.MapPost("/validate/bound", (BoundQueryRequest request, HttpContext http) =>
    Results.Ok(CurrentValidator(http).Validate(request.Definition, request.Parameters)));

api.MapPost("/compile/bound", (BoundQueryRequest request, int? limit, HttpContext http) =>
    Compile(request.Definition, request.Parameters, limit, http));

api.MapPost("/preview/bound", (BoundQueryRequest request, int? limit, HttpContext http,
    SqlServerQueryExecutor executor, CancellationToken cancellationToken) =>
    Preview(request.Definition, request.Parameters, limit, http, executor, cancellationToken));

app.MapFallbackToFile("index.html");
app.Run();

static QueryCatalog CurrentCatalog(HttpContext http) => (QueryCatalog)http.Items[typeof(QueryCatalog)]!;
static QueryValidator CurrentValidator(HttpContext http) => new(CurrentCatalog(http));

static IResult Compile(QueryDefinition definition, IReadOnlyDictionary<string, JsonElement>? bindings, int? limit, HttpContext http)
{
    var validator = CurrentValidator(http);
    var validation = validator.Validate(definition, bindings);
    if (!validation.IsValid) return Results.UnprocessableEntity(validation);
    if (limit is < 1 or > SqlServerQueryCompiler.MaximumRows)
        return Results.BadRequest(new { error = $"Limit must be between 1 and {SqlServerQueryCompiler.MaximumRows}." });
    return Results.Ok(new SqlServerQueryCompiler(CurrentCatalog(http), validator).Compile(definition, limit ?? 25, bindings));
}

static async Task<IResult> Preview(QueryDefinition definition, IReadOnlyDictionary<string, JsonElement>? bindings, int? limit,
    HttpContext http, SqlServerQueryExecutor executor, CancellationToken cancellationToken)
{
    var validator = CurrentValidator(http);
    var validation = validator.Validate(definition, bindings);
    if (!validation.IsValid) return Results.UnprocessableEntity(validation);
    if (limit is < 1 or > SqlServerQueryCompiler.MaximumRows)
        return Results.BadRequest(new { error = $"Limit must be between 1 and {SqlServerQueryCompiler.MaximumRows}." });
    if (!executor.IsConfigured)
        return Results.Problem("Configure ConnectionStrings__ExpressionForge to enable database preview.", statusCode: 503);

    var plan = new SqlServerQueryCompiler(CurrentCatalog(http), validator).Compile(definition, limit ?? 25, bindings);
    try
    {
        return Results.Ok(await executor.ExecuteAsync(plan, cancellationToken));
    }
    catch (Microsoft.Data.SqlClient.SqlException)
    {
        return Results.Problem("SQL Server query execution failed. Check the database schema, permissions and connection.", statusCode: 502);
    }
}

public partial class Program { }
