import type { AIBuiltinToolInfo } from "./aiBuiltinToolInfo.types";

type DatabaseToolInfoTranslator = (key: string) => string;

interface DatabaseToolInfoCopy {
  name: string;
  icon: string;
  desc: string;
  detail: string;
  params: string;
  toolDescription: string;
  parameters: Record<string, { type: string; description: string }>;
  required?: string[];
}

const DATABASE_TOOL_INFO_KEY_PREFIX = "ai_chat.builtin_tools.database";

const translateDatabaseToolInfo = (
  t: DatabaseToolInfoTranslator | undefined,
  key: string,
  fallback: string,
): string => {
  if (!t) return fallback;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
};

const DATABASE_TOOL_INFO_COPY: DatabaseToolInfoCopy[] = [
  {
    name: "get_connections",
    icon: "🔗",
    desc: "Get all available database connections",
    detail:
      "Returns connection ID, name, type (such as MySQL or PostgreSQL), and Host address. AI uses the returned data to decide which connection to explore first.",
    params: "No parameters",
    toolDescription:
      "When database querying or operations are needed but the user has not selected any connection context, get all database connections available in the current app. Returned data includes connection ID (id) and name (name).",
    parameters: {},
  },
  {
    name: "get_databases",
    icon: "🗄️",
    desc: "Get all databases under a specified connection",
    detail: "Pass connectionId and return the database or Schema name list under that connection.",
    params: "connectionId: connection ID",
    toolDescription: "Get all database (Database/Schema) names under the specified connectionId.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID (from get_connections)" },
    },
    required: ["connectionId"],
  },
  {
    name: "get_tables",
    icon: "📋",
    desc: "Get all table names under a specified database",
    detail:
      "Pass connectionId and dbName, then return a table name list. AI uses it to locate the target table mentioned by the user.",
    params: "connectionId, dbName",
    toolDescription:
      "After the target connection and database name are known, if the user asks about a table or implicitly mentions one but the exact table name is unknown, call this tool to get all table names in that database (table names only) and infer the target table.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID" },
      dbName: { type: "string", description: "Database name" },
    },
    required: ["connectionId", "dbName"],
  },
  {
    name: "get_all_columns",
    icon: "🧱",
    desc: "Get field summaries for all tables in a database",
    detail:
      "Pass connectionId and dbName, then return a cross-table field list including table name, field name, type, and comment. Useful when the user knows a business field but not which table contains it.",
    params: "connectionId, dbName",
    toolDescription:
      "Get field summaries for all tables in the specified database, returning table names, field names, types, and comments. Use it for field-to-table lookup, cross-table field comparison, and data map exploration.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID" },
      dbName: { type: "string", description: "Database name" },
    },
    required: ["connectionId", "dbName"],
  },
  {
    name: "get_columns",
    icon: "🔍",
    desc: "Get the field structure of a specified table",
    detail:
      "Pass connectionId, dbName, and tableName, then return each field's name, type, nullability, default value, and comment. AI must call this before generating SQL to confirm real field names.",
    params: "connectionId, dbName, tableName",
    toolDescription:
      "Get the field list of the specified table, including field name, type, nullability, default value, comment, and related metadata. Before generating SQL, call this tool to confirm real field names and do not guess field names.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID" },
      dbName: { type: "string", description: "Database name" },
      tableName: { type: "string", description: "Table name" },
    },
    required: ["connectionId", "dbName", "tableName"],
  },
  {
    name: "get_indexes",
    icon: "🧭",
    desc: "Get index definitions for a specified table",
    detail:
      "Pass connectionId, dbName, and tableName, then return index name, index columns, uniqueness, and index type. AI should prefer this for slow SQL analysis, index optimization, and execution-plan inference.",
    params: "connectionId, dbName, tableName",
    toolDescription:
      "Get index definitions for the specified table, including index name, column order, uniqueness, and index type. Use it for slow SQL analysis, index optimization suggestions, and confirming existing index coverage.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID" },
      dbName: { type: "string", description: "Database name" },
      tableName: { type: "string", description: "Table name" },
    },
    required: ["connectionId", "dbName", "tableName"],
  },
  {
    name: "get_foreign_keys",
    icon: "🧬",
    desc: "Get foreign-key relationships for a specified table",
    detail:
      "Pass connectionId, dbName, and tableName, then return foreign-key mappings from the current table to other tables. AI can use it directly for relationship inference, join SQL generation, and data consistency review.",
    params: "connectionId, dbName, tableName",
    toolDescription:
      "Get foreign-key relationships for the specified table, including local fields, referenced table, referenced fields, and constraint names. Use it for join-path analysis, ER relationship mapping, and constraint checks.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID" },
      dbName: { type: "string", description: "Database name" },
      tableName: { type: "string", description: "Table name" },
    },
    required: ["connectionId", "dbName", "tableName"],
  },
  {
    name: "get_triggers",
    icon: "⏱️",
    desc: "Get trigger definitions for a specified table",
    detail:
      "Pass connectionId, dbName, and tableName, then return trigger name, timing, event type, and statement body. AI can inspect it directly when analyzing implicit writes, side effects, and audit logic.",
    params: "connectionId, dbName, tableName",
    toolDescription:
      "Get trigger definitions for the specified table, including timing, event, and trigger statement. Use it to investigate implicit data changes, audit logic, and table-level side effects.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID" },
      dbName: { type: "string", description: "Database name" },
      tableName: { type: "string", description: "Table name" },
    },
    required: ["connectionId", "dbName", "tableName"],
  },
  {
    name: "get_server_version",
    icon: "🏷️",
    desc: "Read the live database server version",
    detail:
      "Pass connectionId and return that connection's real server version. Call this before generating SQL so older databases are not given newer-version syntax.",
    params: "connectionId: connection ID",
    toolDescription:
      "Read the live database server version for the specified connection. Call this before generating SQL and use only syntax and functions that version already supports.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID (from get_connections)" },
    },
    required: ["connectionId"],
  },
  {
    name: "get_table_ddl",
    icon: "📝",
    desc: "Get the table creation statement (DDL)",
    detail:
      "Pass connectionId, dbName, and tableName, then return the complete CREATE TABLE statement, including field definitions, indexes, constraints, and related structure details.",
    params: "connectionId, dbName, tableName",
    toolDescription:
      "Get the complete table creation statement (CREATE TABLE DDL) for the specified table, including fields, indexes, constraints, and complete structure information.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID" },
      dbName: { type: "string", description: "Database name" },
      tableName: { type: "string", description: "Table name" },
    },
    required: ["connectionId", "dbName", "tableName"],
  },
  {
    name: "preview_table_rows",
    icon: "👀",
    desc: "Preview the first rows of a specified table",
    detail:
      "Pass connectionId, dbName, tableName, and optional limit, then return real sample rows from the table. Use it to inspect data shape, null distribution, and enum values before deciding how to write SQL.",
    params: "connectionId, dbName, tableName, limit?",
    toolDescription:
      "Preview sample rows from the specified table. Use it to quickly understand field value shapes, nulls, time formats, and status enums, reducing blind SQL generation by the model.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID" },
      dbName: { type: "string", description: "Database name" },
      tableName: { type: "string", description: "Table name" },
      limit: { type: "number", description: "Optional. Preview row count. Default 20, maximum 100." },
    },
    required: ["connectionId", "dbName", "tableName"],
  },
  {
    name: "inspect_table_bundle",
    icon: "🧰",
    desc: "Capture a structure snapshot for a specified table",
    detail:
      "Pass connectionId, dbName, and tableName, then return columns, indexes, foreign keys, triggers, and DDL; sample rows can also be included. Useful before writing SQL, reviewing table design, or investigating side effects.",
    params: "connectionId, dbName, tableName, includeSampleRows?, sampleLimit?",
    toolDescription:
      "Get a complete structure snapshot for the specified table, returning columns, indexes, foreign keys, triggers, DDL, and optional sample rows. Use it for full table-design exploration, quickly understanding table relationships, and reducing repeated round trips.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID" },
      dbName: { type: "string", description: "Database name" },
      tableName: { type: "string", description: "Table name" },
      includeSampleRows: { type: "boolean", description: "Optional. Whether to include sample rows." },
      sampleLimit: { type: "number", description: "Optional. Sample row count. Default 10, maximum 100." },
    },
    required: ["connectionId", "dbName", "tableName"],
  },
  {
    name: "inspect_database_bundle",
    icon: "🗂️",
    desc: "Capture a structure overview for a specified database",
    detail:
      "Pass connectionId and dbName, then return table list, table count, total field count, and per-table field summary preview. Useful for first-pass exploration of an unfamiliar database before drilling into target tables.",
    params: "connectionId, dbName, includeColumns?, tableLimit?, perTableColumnLimit?",
    toolDescription:
      "Get a structure overview for the specified database, returning table name list, total field count, and per-table field summary preview. Use it for unfamiliar database exploration, data mapping, and quickly choosing the next table to analyze deeply.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID" },
      dbName: { type: "string", description: "Database name" },
      includeColumns: { type: "boolean", description: "Optional. Whether to include per-table field summaries. Default true." },
      tableLimit: { type: "number", description: "Optional. Maximum tables to return. Default 80, maximum 200." },
      perTableColumnLimit: { type: "number", description: "Optional. Maximum field summaries per table. Default 8, maximum 30." },
    },
    required: ["connectionId", "dbName"],
  },
  {
    name: "execute_sql",
    icon: "▶️",
    desc: "Execute a SQL query and return results",
    detail:
      "Pass connectionId, dbName, and sql, then execute SQL on the target database and return results (up to 50 rows). Controlled by safety level; read-only mode only allows SELECT/SHOW/DESCRIBE.",
    params: "connectionId, dbName, sql",
    toolDescription:
      "Execute SQL on the specified connection and database and return results. Controlled by safety level; read-only mode only allows query operations such as SELECT/SHOW/DESCRIBE. Results return at most 50 rows.",
    parameters: {
      connectionId: { type: "string", description: "Connection ID" },
      dbName: { type: "string", description: "Database name" },
      sql: { type: "string", description: "SQL statement to execute" },
    },
    required: ["connectionId", "dbName", "sql"],
  },
];

const buildDatabaseToolInfo = (
  copy: DatabaseToolInfoCopy,
  t?: DatabaseToolInfoTranslator,
): AIBuiltinToolInfo => {
  const keyPrefix = `${DATABASE_TOOL_INFO_KEY_PREFIX}.${copy.name}`;
  const translatedProperties = Object.fromEntries(
    Object.entries(copy.parameters).map(([paramName, schema]) => [
      paramName,
      {
        type: schema.type,
        description: translateDatabaseToolInfo(
          t,
          `${keyPrefix}.parameters.${paramName}.description`,
          schema.description,
        ),
      },
    ]),
  );

  return {
    name: copy.name,
    icon: copy.icon,
    desc: translateDatabaseToolInfo(t, `${keyPrefix}.desc`, copy.desc),
    detail: translateDatabaseToolInfo(t, `${keyPrefix}.detail`, copy.detail),
    params: translateDatabaseToolInfo(t, `${keyPrefix}.params`, copy.params),
    tool: {
      type: "function",
      function: {
        name: copy.name,
        description: translateDatabaseToolInfo(t, `${keyPrefix}.tool_description`, copy.toolDescription),
        parameters: {
          type: "object",
          properties: translatedProperties,
          ...(copy.required ? { required: copy.required } : {}),
        },
      },
    },
  };
};

export const localizeBuiltinDatabaseToolInfo = (
  t?: DatabaseToolInfoTranslator,
): AIBuiltinToolInfo[] =>
  DATABASE_TOOL_INFO_COPY.map((copy) => buildDatabaseToolInfo(copy, t));

export const BUILTIN_AI_DATABASE_TOOL_INFO: AIBuiltinToolInfo[] =
  localizeBuiltinDatabaseToolInfo();
