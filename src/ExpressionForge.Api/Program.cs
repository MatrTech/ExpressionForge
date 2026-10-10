using System.Text.Json;
using ExpressionForge.Api;
using ExpressionForge.Core;
using Microsoft.AspNetCore.Authentication.JwtBearer;

var builder = WebApplication.CreateBuilder(args);
var registryFile = builder.Configuration["ExpressionForge:RegistryFile"];
var catalogFile = builder.Configuration["ExpressionForge:CatalogFile"];
var accessFile = builder.Configuration["ExpressionForge:AccessFile"];
if (!string.IsNullOrWhiteSpace(registryFile) && (!string.IsNullOrWhiteSpace(catalogFile) || !string.IsNullOrWhiteSpace(accessFile)))
    throw new InvalidOperationException("RegistryFile cannot be combined with legacy CatalogFile or AccessFile settings.");

// Catalog sources and grants are trusted server configuration, never supplied by callers.
var registry = string.IsNullOrWhiteSpace(registryFile)
    ? CreateLegacyRegistry(catalogFile, accessFile, builder.Environment.ContentRootPath)
    : QueryCatalogRegistryFile.Load(Path.GetFullPath(registryFile, builder.Environment.ContentRootPath));

if (registry.IsRestricted)
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
if (registry.IsRestricted)
{
    app.UseAuthentication();
    app.UseAuthorization();
}

// List only those catalogs for which the current caller has grants.
var listing = app.MapGet("/api/query/catalogs", (HttpContext http) =>
{
    var available = registry.Discover(http.User);
    var selectedDefault = available.Any(catalog => catalog.Id == registry.DefaultId)
        ? registry.DefaultId : available.FirstOrDefault()?.Id;
    return Results.Ok(new { defaultCatalog = selectedDefault, catalogs = available });
});
if (registry.IsRestricted) listing.RequireAuthorization();

var api = app.MapGroup("/api/query");
if (registry.IsRestricted) api.RequireAuthorization();

// A pinned AST catalog cannot be overridden by the query string.
api.AddEndpointFilter(async (invocation, next) =>
{
    var http = invocation.HttpContext;
    var definition = invocation.Arguments.OfType<QueryDefinition>().FirstOrDefault() ??
        invocation.Arguments.OfType<BoundQueryRequest>().FirstOrDefault()?.Definition;
    var queryId = http.Request.Query["catalog"].FirstOrDefault();
    if (definition?.CatalogId is not null && queryId is not null &&
        !string.Equals(definition.CatalogId, queryId, StringComparison.Ordinal))
        return Results.BadRequest(new { error = "Catalog selection does not match the query definition." });
    var selected = definition?.CatalogId ?? queryId ?? registry.DefaultId;
    var scoped = registry.ForUser(selected, http.User);
    if (scoped is null) return Results.NotFound(new { error = "Unknown or unavailable catalog." });
    http.Items[typeof(QueryCatalog)] = scoped;
    http.Items["catalogId"] = selected;
    return await next(invocation);
});

api.MapGet("/metadata", (HttpContext http) =>
{
    var current = CurrentCatalog(http);
    return Results.Ok(new
    {
        catalogId = (string)http.Items["catalogId"]!,
        catalogVersion = current.Version,
        catalogRevision = current.Revision,
        entities = current.Entities,
        operators = current.Operators,
        expressionTypes = new[] { "expression", "fieldComparison", "arithmeticComparison", "group", "collectionExpression", "not" },
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

static QueryCatalogRegistry CreateLegacyRegistry(string? catalogFile, string? accessFile, string contentRoot)
{
    var catalog = string.IsNullOrWhiteSpace(catalogFile)
        ? QueryCatalog.CreateDemo()
        : QueryCatalogFile.Load(Path.GetFullPath(catalogFile, contentRoot));
    var access = string.IsNullOrWhiteSpace(accessFile)
        ? QueryAccessCatalogs.Unrestricted(catalog)
        : QueryAccessCatalogs.Load(catalog, Path.GetFullPath(accessFile, contentRoot));
    return QueryCatalogRegistry.Single(access);
}

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
