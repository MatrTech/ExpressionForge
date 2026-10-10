using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ExpressionForge.Core;

/// <summary>Trusted server-side catalog provider. Never accept a source configuration from the query payload.</summary>
public interface IQueryCatalogSource
{
    string Kind { get; }
    QueryCatalog Load(string? location);
}

public sealed class DemoQueryCatalogSource : IQueryCatalogSource
{
    public string Kind => "demo";
    public QueryCatalog Load(string? location)
    {
        if (!string.IsNullOrWhiteSpace(location))
            throw new InvalidOperationException("The demo catalog does not accept a file path.");
        return QueryCatalog.CreateDemo();
    }
}

public sealed class JsonFileQueryCatalogSource : IQueryCatalogSource
{
    public string Kind => "json";
    public QueryCatalog Load(string? location) => QueryCatalogFile.Load(
        !string.IsNullOrWhiteSpace(location) ? location : throw new InvalidOperationException("JSON catalog requires a trusted file path."));
}

public sealed record QueryCatalogSummary(string Id, string DisplayName, string CatalogVersion, string CatalogRevision, bool IsDefault);

public sealed record RegisteredQueryCatalog(string Id, string DisplayName, QueryAccessCatalogs Access);

/// <summary>Immutable collection of independently named and permission-scoped registered catalogs.</summary>
public sealed class QueryCatalogRegistry
{
    private readonly IReadOnlyDictionary<string, RegisteredQueryCatalog> _catalogs;
    public string DefaultId { get; }
    public bool IsRestricted { get; }

    internal QueryCatalogRegistry(string defaultId, IReadOnlyDictionary<string, RegisteredQueryCatalog> catalogs)
    {
        DefaultId = defaultId;
        _catalogs = catalogs;
        // Mixed public/protected registries are refused instead of accidentally exposing sensitive sources.
        if (catalogs.Values.Select(c => c.Access.IsRestricted).Distinct().Count() != 1)
            throw new InvalidOperationException("A catalog registry must not mix restricted and unrestricted catalogs.");
        IsRestricted = catalogs.Values.First().Access.IsRestricted;
    }

    public QueryCatalog? ForUser(string? id, ClaimsPrincipal? user)
    {
        var key = id ?? DefaultId;
        return _catalogs.TryGetValue(key, out var registration) ? registration.Access.ForUser(user) : null;
    }

    public IReadOnlyList<QueryCatalogSummary> Discover(ClaimsPrincipal? user) =>
        _catalogs.Values.Select(registration =>
        {
            var catalog = registration.Access.ForUser(user);
            return catalog is null ? null : new QueryCatalogSummary(registration.Id, registration.DisplayName,
                catalog.Version, catalog.Revision, registration.Id == DefaultId);
        }).OfType<QueryCatalogSummary>().ToArray();

    public static QueryCatalogRegistry Single(QueryAccessCatalogs access) =>
        new QueryCatalogRegistryBuilder().Add("default", "Default catalog", access).Build("default");
}

public sealed class QueryCatalogRegistryBuilder
{
    private static readonly Regex ValidId = new("^[A-Za-z_][A-Za-z0-9_-]{0,63}$", RegexOptions.CultureInvariant);
    private readonly Dictionary<string, RegisteredQueryCatalog> _catalogs = new(StringComparer.Ordinal);

    public QueryCatalogRegistryBuilder Add(string id, string displayName, QueryAccessCatalogs access)
    {
        if (id is null || !ValidId.IsMatch(id) || string.IsNullOrWhiteSpace(displayName))
            throw new InvalidOperationException("Catalogs require a safe ID and a display name.");
        ArgumentNullException.ThrowIfNull(access);
        if (!_catalogs.TryAdd(id, new RegisteredQueryCatalog(id, displayName, access)))
            throw new InvalidOperationException($"Duplicate catalog ID '{id}'.");
        return this;
    }

    public QueryCatalogRegistry Build(string defaultId)
    {
        if (!_catalogs.ContainsKey(defaultId))
            throw new InvalidOperationException($"Default catalog '{defaultId}' was not registered.");
        return new(defaultId, new System.Collections.ObjectModel.ReadOnlyDictionary<string, RegisteredQueryCatalog>(
            new Dictionary<string, RegisteredQueryCatalog>(_catalogs, StringComparer.Ordinal)));
    }
}

/// <summary>Loads provider registrations from trusted local configuration. Relative paths resolve against the manifest directory.</summary>
public static class QueryCatalogRegistryFile
{
    public static QueryCatalogRegistry Load(string manifestPath, IEnumerable<IQueryCatalogSource>? sources = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(manifestPath);
        var fullPath = Path.GetFullPath(manifestPath);
        var document = JsonSerializer.Deserialize<RegistryDefinition>(File.ReadAllText(fullPath),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        if (document?.Catalogs is not { Count: > 0 })
            throw new InvalidOperationException("A registry manifest must contain catalogs.");

        var registeredSources = (sources ?? [new DemoQueryCatalogSource(), new JsonFileQueryCatalogSource()]).ToArray();
        if (registeredSources.Any(source => source is null) ||
            registeredSources.Select(source => source.Kind).Distinct(StringComparer.Ordinal).Count() != registeredSources.Length)
            throw new InvalidOperationException("Catalog source providers must have distinct kinds.");

        var root = Path.GetDirectoryName(fullPath)!;
        var builder = new QueryCatalogRegistryBuilder();
        foreach (var entry in document.Catalogs)
        {
            if (entry is null || string.IsNullOrWhiteSpace(entry.Source))
                throw new InvalidOperationException("Catalog entries require a source.");
            var provider = registeredSources.SingleOrDefault(source => source.Kind == entry.Source)
                ?? throw new InvalidOperationException($"Unknown catalog source '{entry.Source}'.");
            var location = entry.Path is null ? null : Path.GetFullPath(entry.Path, root);
            var catalog = provider.Load(location);
            var access = entry.AccessFile is null ? QueryAccessCatalogs.Unrestricted(catalog) :
                QueryAccessCatalogs.Load(catalog, Path.GetFullPath(entry.AccessFile, root));
            builder.Add(entry.Id, entry.DisplayName, access);
        }
        return builder.Build(document.DefaultCatalog);
    }

    private sealed record RegistryDefinition(string DefaultCatalog, IReadOnlyList<CatalogEntry?>? Catalogs);
    private sealed record CatalogEntry(string Id, string DisplayName, string Source, string? Path, string? AccessFile);
}
