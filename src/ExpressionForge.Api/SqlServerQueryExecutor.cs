using ExpressionForge.Core;
using Microsoft.Data.SqlClient;

namespace ExpressionForge.Api;

public sealed record QueryPreviewResult(IReadOnlyList<ResultColumn> Columns, IReadOnlyList<Dictionary<string, object?>> Rows);

public sealed class SqlServerQueryExecutor(IConfiguration configuration)
{
    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuration.GetConnectionString("ExpressionForge"));

    public async Task<QueryPreviewResult> ExecuteAsync(SqlQueryPlan plan, CancellationToken cancellationToken)
    {
        var connectionString = configuration.GetConnectionString("ExpressionForge");
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new InvalidOperationException("The ExpressionForge SQL Server connection has not been configured.");

        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(plan.Sql, connection) { CommandTimeout = 15 };
        foreach (var argument in plan.Parameters)
        {
            var parameter = command.Parameters.Add(argument.Name, ConvertDbType(argument.DbType));
            parameter.Value = argument.Value;
            if (argument.DbType == System.Data.DbType.String)
                parameter.Size = Math.Max(1, ((string)argument.Value).Length);
            if (argument.DbType == System.Data.DbType.Decimal)
            {
                parameter.Precision = 38;
                parameter.Scale = 10;
            }
        }

        await using var reader = await command.ExecuteReaderAsync(System.Data.CommandBehavior.SingleResult, cancellationToken);
        var rows = new List<Dictionary<string, object?>>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var row = new Dictionary<string, object?>(StringComparer.Ordinal);
            for (var i = 0; i < reader.FieldCount; i++)
            {
                var value = reader.IsDBNull(i) ? null : reader.GetValue(i);
                row[reader.GetName(i)] = value;
            }
            rows.Add(row);
        }
        return new QueryPreviewResult(plan.Columns, rows);
    }

    private static System.Data.SqlDbType ConvertDbType(System.Data.DbType type) => type switch
    {
        System.Data.DbType.Int32 => System.Data.SqlDbType.Int,
        System.Data.DbType.Decimal => System.Data.SqlDbType.Decimal,
        System.Data.DbType.Boolean => System.Data.SqlDbType.Bit,
        System.Data.DbType.String => System.Data.SqlDbType.NVarChar,
        _ => throw new NotSupportedException($"Unsupported parameter type: {type}")
    };
}
