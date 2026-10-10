using System.Text.Json;
using System.Text.Json.Serialization;

namespace ExpressionForge.Core;

public static class ExpressionForgeJson
{
    public static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}
