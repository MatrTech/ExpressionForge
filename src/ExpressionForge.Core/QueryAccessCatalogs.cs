using System.Security.Claims;
using System.Text.Json;

namespace ExpressionForge.Core;

/// <summary>
/// Materializes role-filtered, immutable metadata catalogs from trusted server configuration.
/// The same catalog must be used for discovery, validation, compilation and preview.
/// </summary>
public sealed class QueryAccessCatalogs
{
    private readonly QueryCatalog _source;
    private readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, EntityGrant>>? _roles;

    private QueryAccessCatalogs(QueryCatalog source, IReadOnlyDictionary<string, IReadOnlyDictionary<string, EntityGrant>>? roles)
    {
        _source = source;
        _roles = roles;
    }

    public bool IsRestricted => _roles is not null;

    public static QueryAccessCatalogs Unrestricted(QueryCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        return new(catalog, null);
    }

    public static QueryAccessCatalogs Load(QueryCatalog catalog, string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        return Parse(catalog, File.ReadAllText(path));
    }

    public static QueryAccessCatalogs Parse(QueryCatalog catalog, string json)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentException.ThrowIfNullOrWhiteSpace(json);
        var definition = JsonSerializer.Deserialize<AccessDefinition>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        if (definition?.Roles is not { Count: > 0 })
            throw new InvalidOperationException("Access configuration must define at least one role.");

        var roles = new Dictionary<string, IReadOnlyDictionary<string, EntityGrant>>(StringComparer.Ordinal);
        foreach (var role in definition.Roles)
        {
            if (role is null || string.IsNullOrWhiteSpace(role.Role) || role.Entities is not { Count: > 0 })
                throw new InvalidOperationException("Each access role needs a name and at least one entity grant.");

            var grants = new Dictionary<string, EntityGrant>(StringComparer.Ordinal);
            foreach (var grant in role.Entities)
            {
                if (grant is null || catalog.FindEntity(grant.Entity) is not { } entity)
                    throw new InvalidOperationException("An access grant refers to an unknown entity.");
                if (grant.Properties is null || grant.Relationships is null || grant.Properties.Count == 0)
                    throw new InvalidOperationException($"Entity '{entity.Id}' must grant at least one property and declare relationships.");

                var properties = new HashSet<string>(grant.Properties, StringComparer.Ordinal);
                var relationships = new HashSet<string>(grant.Relationships, StringComparer.Ordinal);
                if (properties.Count != grant.Properties.Count || relationships.Count != grant.Relationships.Count ||
                    entity.Properties.Any(p => properties.Contains(p.Id)) is false && properties.Count > 0 ||
                    properties.Any(id => !entity.Properties.Any(p => p.Id == id)) ||
                    relationships.Any(id => !entity.Relationships.Any(r => r.Id == id)))
                    throw new InvalidOperationException($"Entity '{entity.Id}' has duplicate or unknown access members.");

                if (!grants.TryAdd(entity.Id, new EntityGrant(properties, relationships)))
                    throw new InvalidOperationException($"Role '{role.Role}' grants entity '{entity.Id}' more than once.");
            }
            if (!roles.TryAdd(role.Role, grants))
                throw new InvalidOperationException($"Duplicate access role '{role.Role}'.");
        }

        return new(catalog, roles);
    }

    /// <summary>
    /// Returns no catalog when a restricted request lacks authentication or applicable role grants.
    /// Claims must be established by trusted ASP.NET Core authentication middleware, never request JSON/headers.
    /// </summary>
    public QueryCatalog? ForUser(ClaimsPrincipal? principal)
    {
        if (_roles is null) return _source;
        if (principal?.Identity?.IsAuthenticated != true) return null;

        var visible = new Dictionary<string, EntityGrant>(StringComparer.Ordinal);
        foreach (var (role, grants) in _roles)
        {
            if (!principal.IsInRole(role)) continue;
            foreach (var (entityId, grant) in grants)
            {
                if (!visible.TryGetValue(entityId, out var merged))
                {
                    visible.Add(entityId, new EntityGrant(new(grant.Properties, StringComparer.Ordinal),
                        new(grant.Relationships, StringComparer.Ordinal)));
                    continue;
                }
                merged.Properties.UnionWith(grant.Properties);
                merged.Relationships.UnionWith(grant.Relationships);
            }
        }
        if (visible.Count == 0) return null;

        var allowedEntities = _source.Entities.Where(e => visible.ContainsKey(e.Id)).ToArray();
        var entityIds = allowedEntities.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);
        var entities = allowedEntities.Select(entity =>
        {
            var grant = visible[entity.Id];
            return entity with
            {
                Properties = Array.AsReadOnly(entity.Properties.Where(p => grant.Properties.Contains(p.Id)).ToArray()),
                Relationships = Array.AsReadOnly(entity.Relationships
                    .Where(r => grant.Relationships.Contains(r.Id) && entityIds.Contains(r.TargetEntity)).ToArray())
            };
        }).ToArray();
        var usedOperators = entities.SelectMany(e => e.Properties).SelectMany(p => p.Operators).ToHashSet(StringComparer.Ordinal);
        var operators = Array.AsReadOnly(_source.Operators.Where(op => usedOperators.Contains(op.Id)).ToArray());
        return new QueryCatalog(Array.AsReadOnly(entities), operators);
    }

    private sealed record EntityGrant(HashSet<string> Properties, HashSet<string> Relationships);
    private sealed record AccessDefinition(IReadOnlyList<RoleDefinition?>? Roles);
    private sealed record RoleDefinition(string Role, IReadOnlyList<EntityDefinition?>? Entities);
    private sealed record EntityDefinition(string Entity, IReadOnlyList<string>? Properties, IReadOnlyList<string>? Relationships);
}
