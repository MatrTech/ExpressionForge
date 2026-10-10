using System.Text.Json;
using ExpressionForge.Core;

namespace ExpressionForge.Api;

/// <summary>
/// Runtime values are kept outside the portable query definition.
/// </summary>
public sealed record BoundQueryRequest(QueryDefinition Definition, Dictionary<string, JsonElement> Parameters);
