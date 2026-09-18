package aicontext

import (
	"fmt"
	"strings"
)

// PromptTemplate AI 能力类型
type PromptTemplate string

const (
	PromptSQLGenerate   PromptTemplate = "sql_generate"
	PromptSQLExplain    PromptTemplate = "sql_explain"
	PromptSQLOptimize   PromptTemplate = "sql_optimize"
	PromptDataAnalyze   PromptTemplate = "data_analyze"
	PromptSchemaInsight PromptTemplate = "schema_insight"
	PromptGeneralChat   PromptTemplate = "general_chat"
)

// GetBuiltinPrompts 获取所有内置系统提示词集合，用于前端展示
func GetBuiltinPrompts() map[string]string {
	return GetBuiltinPromptsWithTitleLookup(nil)
}

type BuiltinPromptLookup func(key string) string
type BuiltinPromptTitleLookup = BuiltinPromptLookup
type DatabaseContextTextLookup func(key string, params map[string]any) string

var builtinPromptEntries = []struct {
	titleKey      string
	fallbackTitle string
	prompt        func(BuiltinPromptLookup) string
}{
	{"ai_service.backend.builtin_prompt.title.general_chat", "General chat assistant", buildGeneralChatPromptWithLookup},
	{"ai_service.backend.builtin_prompt.title.sql_generate", "SQL generator", buildSQLGeneratePromptWithLookup},
	{"ai_service.backend.builtin_prompt.title.sql_explain", "SQL explainer", buildSQLExplainPromptWithLookup},
	{"ai_service.backend.builtin_prompt.title.sql_optimize", "SQL optimizer", buildSQLOptimizePromptWithLookup},
	{"ai_service.backend.builtin_prompt.title.data_analyze", "Data insight analyst", buildDataAnalyzePromptWithLookup},
	{"ai_service.backend.builtin_prompt.title.schema_insight", "Schema reviewer", buildSchemaInsightPromptWithLookup},
}

// GetBuiltinPromptsWithTitleLookup returns builtin prompt bodies with localized display titles.
func GetBuiltinPromptsWithTitleLookup(lookup BuiltinPromptTitleLookup) map[string]string {
	prompts := make(map[string]string, len(builtinPromptEntries))
	for _, entry := range builtinPromptEntries {
		prompts[localizedBuiltinPromptTitle(lookup, entry.titleKey, entry.fallbackTitle)] = entry.prompt(lookup)
	}
	return prompts
}

func localizedBuiltinPromptTitle(lookup BuiltinPromptLookup, key string, fallback string) string {
	if lookup != nil {
		if title := strings.TrimSpace(lookup(key)); title != "" && title != key {
			return title
		}
	}
	return fallback
}

// BuildSystemPrompt 根据模板类型和上下文构建 System Prompt
func BuildSystemPrompt(template PromptTemplate, dbCtx *DatabaseContext) string {
	var prompt string

	switch template {
	case PromptSQLGenerate:
		prompt = buildSQLGeneratePrompt()
	case PromptSQLExplain:
		prompt = buildSQLExplainPrompt()
	case PromptSQLOptimize:
		prompt = buildSQLOptimizePrompt()
	case PromptDataAnalyze:
		prompt = buildDataAnalyzePrompt()
	case PromptSchemaInsight:
		prompt = buildSchemaInsightPrompt()
	case PromptGeneralChat:
		prompt = buildGeneralChatPrompt()
	default:
		prompt = buildGeneralChatPrompt()
	}

	if dbCtx != nil {
		prompt += "\n\n" + FormatDatabaseContext(dbCtx)
	}

	return prompt
}

// FormatDatabaseContext 将数据库上下文格式化为 LLM 友好的文本
func FormatDatabaseContext(ctx *DatabaseContext) string {
	return FormatDatabaseContextWithTextLookup(ctx, nil)
}

// FormatDatabaseContextWithTextLookup formats database metadata with localized markdown shell text.
func FormatDatabaseContextWithTextLookup(ctx *DatabaseContext, lookup DatabaseContextTextLookup) string {
	if ctx == nil || len(ctx.Tables) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString(databaseContextText(lookup, "ai_service.backend.database_context.title", nil))
	b.WriteString("\n\n")
	b.WriteString(databaseContextText(lookup, "ai_service.backend.database_context.database_type", map[string]any{
		"type": ctx.DatabaseType,
	}))
	b.WriteString("\n")
	if version := strings.TrimSpace(ctx.Version); version != "" {
		b.WriteString(databaseContextText(lookup, "ai_service.backend.database_context.database_version", map[string]any{
			"version": version,
		}))
		b.WriteString("\n")
	}
	b.WriteString(databaseContextText(lookup, "ai_service.backend.database_context.database_name", map[string]any{
		"name": ctx.DatabaseName,
	}))
	b.WriteString("\n\n")

	b.WriteString(databaseContextText(lookup, "ai_service.backend.database_context.table_schema", nil))
	b.WriteString("\n\n")
	for _, table := range ctx.Tables {
		b.WriteString(databaseContextText(lookup, "ai_service.backend.database_context.table_heading", map[string]any{
			"table": table.Name,
		}))
		if table.Comment != "" {
			b.WriteString(fmt.Sprintf(" (%s)", table.Comment))
		}
		if table.RowCount > 0 {
			b.WriteString(" ")
			b.WriteString(databaseContextText(lookup, "ai_service.backend.database_context.row_count", map[string]any{
				"count": fmt.Sprintf("%d", table.RowCount),
			}))
		}
		b.WriteString("\n\n")

		b.WriteString(fmt.Sprintf("| %s | %s | %s | %s | %s |\n",
			databaseContextText(lookup, "ai_service.backend.database_context.column_name", nil),
			databaseContextText(lookup, "ai_service.backend.database_context.column_type", nil),
			databaseContextText(lookup, "ai_service.backend.database_context.column_nullable", nil),
			databaseContextText(lookup, "ai_service.backend.database_context.column_primary_key", nil),
			databaseContextText(lookup, "ai_service.backend.database_context.column_comment", nil),
		))
		b.WriteString("|------|------|------|------|------|\n")
		for _, col := range table.Columns {
			nullable := databaseContextText(lookup, "ai_service.backend.database_context.value_no", nil)
			if col.Nullable {
				nullable = databaseContextText(lookup, "ai_service.backend.database_context.value_yes", nil)
			}
			pk := ""
			if col.PrimaryKey {
				pk = "✓"
			}
			comment := col.Comment
			if comment == "" {
				comment = "-"
			}
			b.WriteString(fmt.Sprintf("| %s | %s | %s | %s | %s |\n",
				col.Name, col.Type, nullable, pk, comment))
		}
		b.WriteString("\n")

		if len(table.Indexes) > 0 {
			b.WriteString(databaseContextText(lookup, "ai_service.backend.database_context.indexes", nil))
			b.WriteString("\n")
			for _, idx := range table.Indexes {
				unique := ""
				if idx.Unique {
					unique = databaseContextText(lookup, "ai_service.backend.database_context.unique_index", nil)
				}
				b.WriteString(fmt.Sprintf("- %s: [%s]%s\n",
					idx.Name, strings.Join(idx.Columns, ", "), unique))
			}
			b.WriteString("\n")
		}

		if len(table.SampleRows) > 0 {
			b.WriteString(databaseContextText(lookup, "ai_service.backend.database_context.sample_data", map[string]any{
				"count": fmt.Sprintf("%d", len(table.SampleRows)),
			}))
			b.WriteString("\n\n")
			if len(table.SampleRows) > 0 {
				// 使用第一行的 key 作为标题
				first := table.SampleRows[0]
				var keys []string
				for k := range first {
					keys = append(keys, k)
				}
				b.WriteString("| " + strings.Join(keys, " | ") + " |\n")
				b.WriteString("|" + strings.Repeat("------|", len(keys)) + "\n")
				for _, row := range table.SampleRows {
					var vals []string
					for _, k := range keys {
						vals = append(vals, fmt.Sprintf("%v", row[k]))
					}
					b.WriteString("| " + strings.Join(vals, " | ") + " |\n")
				}
				b.WriteString("\n")
			}
		}
	}

	return b.String()
}

func databaseContextText(lookup DatabaseContextTextLookup, key string, params map[string]any) string {
	if lookup != nil {
		if text := lookup(key, params); strings.TrimSpace(text) != "" && text != key {
			return text
		}
	}
	return defaultDatabaseContextText(key, params)
}

func defaultDatabaseContextText(key string, params map[string]any) string {
	switch key {
	case "ai_service.backend.database_context.title":
		return "## Current database context"
	case "ai_service.backend.database_context.database_type":
		return fmt.Sprintf("Database type: %s", stringParam(params, "type"))
	case "ai_service.backend.database_context.database_version":
		return fmt.Sprintf("Database version: %s", stringParam(params, "version"))
	case "ai_service.backend.database_context.database_name":
		return fmt.Sprintf("Database name: %s", stringParam(params, "name"))
	case "ai_service.backend.database_context.table_schema":
		return "### Table structure"
	case "ai_service.backend.database_context.table_heading":
		return fmt.Sprintf("#### Table: %s", stringParam(params, "table"))
	case "ai_service.backend.database_context.row_count":
		count := stringParam(params, "count")
		if count == "1" {
			return "[about 1 row]"
		}
		return fmt.Sprintf("[about %s rows]", count)
	case "ai_service.backend.database_context.column_name":
		return "Column"
	case "ai_service.backend.database_context.column_type":
		return "Type"
	case "ai_service.backend.database_context.column_nullable":
		return "Nullable"
	case "ai_service.backend.database_context.column_primary_key":
		return "Primary key"
	case "ai_service.backend.database_context.column_comment":
		return "Comment"
	case "ai_service.backend.database_context.value_yes":
		return "Yes"
	case "ai_service.backend.database_context.value_no":
		return "No"
	case "ai_service.backend.database_context.indexes":
		return "**Indexes:**"
	case "ai_service.backend.database_context.unique_index":
		return " (unique)"
	case "ai_service.backend.database_context.sample_data":
		count := stringParam(params, "count")
		if count == "1" {
			return "**Sample data (1 row):**"
		}
		return fmt.Sprintf("**Sample data (%s rows):**", count)
	default:
		return key
	}
}

func stringParam(params map[string]any, key string) string {
	if params == nil {
		return ""
	}
	return fmt.Sprint(params[key])
}

func buildSQLGeneratePrompt() string {
	return buildSQLGeneratePromptWithLookup(nil)
}

func buildSQLGeneratePromptWithLookup(lookup BuiltinPromptLookup) string {
	return localizedBuiltinPromptBody(lookup, "ai_service.backend.builtin_prompt.body.sql_generate", defaultSQLGeneratePrompt())
}

func localizedBuiltinPromptBody(lookup BuiltinPromptLookup, key string, fallback string) string {
	if lookup != nil {
		if body := strings.TrimSpace(lookup(key)); body != "" && body != key {
			return body
		}
	}
	return fallback
}

func defaultSQLGeneratePrompt() string {
	return `You are the GoNavi AI assistant, an expert database developer and SQL query builder. Generate accurate, elegant, and high-performance SQL queries or Redis commands from the user's natural-language request.

Strict output rules:
1. Prioritize pure code output: always place code in a markdown code block with the correct language identifier, such as sql or bash.
2. Stay concise: avoid excessive preamble and get straight to the answer.
3. Protect production safety: prefer parameterized queries or defensive patterns to prevent SQL injection. For DELETE or UPDATE statements without explicit conditions, raise a strong red-line warning.
4. Optimize for performance: add reasonable LIMIT clauses for large queries by default, such as LIMIT 100, and prefer efficient patterns for JOIN and aggregation.
5. Comment only when helpful: for complex nested logic, add brief single-line comments inside the code block to explain the idea.
6. Honor the connected database server version from context. Use only syntax, functions, and features that version already supports; never emit newer-version SQL. If the version is unknown, stay on a conservative dialect baseline and mention version-sensitive differences.`
}

func buildSQLExplainPrompt() string {
	return buildSQLExplainPromptWithLookup(nil)
}

func buildSQLExplainPromptWithLookup(lookup BuiltinPromptLookup) string {
	return localizedBuiltinPromptBody(lookup, "ai_service.backend.builtin_prompt.body.sql_explain", defaultSQLExplainPrompt())
}

func defaultSQLExplainPrompt() string {
	return `You are the GoNavi AI assistant, a senior database engineer with deep practical experience. Explain the underlying intent and execution logic of the user's SQL statement in professional, well-structured, and approachable developer language.

Explanation guidelines:
1. Macro logic breakdown: summarize in one concise sentence what business problem this SQL is trying to solve.
2. Step-by-step execution walkthrough: break down each key clause in the executor's real order, such as FROM -> JOIN -> WHERE -> GROUP BY -> SELECT -> ORDER BY.
3. Performance risk scan: point out likely performance traps, such as implicit type conversions, function calls that prevent index usage, possible Cartesian products, or full table scans.
4. Rigorous formatting: use lists for key points, emphasize important terms in bold, and keep long explanations readable.`
}

func buildSQLOptimizePrompt() string {
	return buildSQLOptimizePromptWithLookup(nil)
}

func buildSQLOptimizePromptWithLookup(lookup BuiltinPromptLookup) string {
	return localizedBuiltinPromptBody(lookup, "ai_service.backend.builtin_prompt.body.sql_optimize", defaultSQLOptimizePrompt())
}

func defaultSQLOptimizePrompt() string {
	return `You are the GoNavi AI assistant, a full-stack performance engineer and senior DBA with experience leading high-concurrency systems at large scale. Diagnose the user's original SQL with cold precision and provide a performance refactoring prescription.

Diagnosis and prescription requirements:
1. Performance bottleneck scan: identify the statement's weak points precisely, such as an unreasonable driving table, inability to use covering indexes, or unnecessary subqueries.
2. Refactored SQL: if there is room for performance improvement, show the user a thoroughly optimized high-performance version while preserving logical equivalence.
3. Explain the cause: do not only say what to change; explain why the executor will run faster after the change.
4. Index construction advice: when the current structure cannot support the workload, propose concrete DDL-level CREATE INDEX statements and state the basis, such as leftmost-prefix matching.
5. Priority assessment: end the answer by marking the urgency of the optimization advice, using high for blocking or lock-risk issues, medium for throughput bottlenecks, and low for long-term tuning.`
}

func buildDataAnalyzePrompt() string {
	return buildDataAnalyzePromptWithLookup(nil)
}

func buildDataAnalyzePromptWithLookup(lookup BuiltinPromptLookup) string {
	return localizedBuiltinPromptBody(lookup, "ai_service.backend.builtin_prompt.body.data_analyze", defaultDataAnalyzePrompt())
}

func defaultDataAnalyzePrompt() string {
	return `You are the GoNavi AI assistant, a senior data analysis expert with sharp business instincts. Review the data sample produced by the user's query and extract the valuable information hidden in it.

Insight goals:
1. Hard statistics: summarize the overall row count and key numeric metrics, such as extremes, averages, and aggregate medians.
2. Trends and anomalies: if the data contains timestamps, detect rising or falling trends; if there are outliers, highlight them clearly.
3. Business value mining: do not merely translate the data. Combine the visible data patterns with AI judgment and give one constructive action suggestion that can help business decision makers or developers.
4. Presentation format: structure the analysis as a concise mini report with a title and condensed bullet points, and avoid flat, mechanical narration.`
}

func buildSchemaInsightPrompt() string {
	return buildSchemaInsightPromptWithLookup(nil)
}

func buildSchemaInsightPromptWithLookup(lookup BuiltinPromptLookup) string {
	return localizedBuiltinPromptBody(lookup, "ai_service.backend.builtin_prompt.body.schema_insight", defaultSchemaInsightPrompt())
}

func defaultSchemaInsightPrompt() string {
	return `You are the GoNavi AI assistant, a chief database architect responsible for the full database lifecycle. In this mode, perform a strict normalization and forward-looking review of the table structures provided by the user.

Review lens:
1. Normalization trade-offs: identify obvious denormalized designs and judge whether the redundancy supports performance appropriately or is simply a design flaw.
2. Index robustness review: assess primary key choices, such as auto-increment keys versus UUIDs, redundant indexes that slow writes, and missing high-frequency composite indexes.
3. Physical capacity foresight: inspect data type allocation, such as oversized VARCHAR fields or unnecessary BIGINT columns that may waste storage.
4. Code-level guidance: when structural defects exist, do not only complain. Provide concrete ALTER TABLE improvement scripts where appropriate.`
}

func buildGeneralChatPrompt() string {
	return buildGeneralChatPromptWithLookup(nil)
}

func buildGeneralChatPromptWithLookup(lookup BuiltinPromptLookup) string {
	return localizedBuiltinPromptBody(lookup, "ai_service.backend.builtin_prompt.body.general_chat", defaultGeneralChatPrompt())
}

func defaultGeneralChatPrompt() string {
	return `You are the GoNavi AI assistant, a dedicated expert system deeply integrated into the GoNavi database and cache client.
Your goal is to be the most useful second brain for developers, DBAs, and data scientists by providing professional, precise, and forward-looking data-side solutions.

Core persona and interaction tone:
- Professionally grounded: make sound judgments about database products such as MySQL, PostgreSQL, DuckDB, and Redis, including execution plans, indexing, and storage behavior.
- Direct and practical: avoid empty chatter. When the user's intent is clear, lead with elegant code or steps they can use directly.
- Structured and readable: use Markdown headings, emphasis, and fenced code blocks with the correct language identifier, such as sql, json, or bash.
- Production safety first: if a SQL statement may create serious risk, such as DELETE or UPDATE without a WHERE clause or a query that can lock a large production table, raise a clear warning before proceeding.

Capability map:
1. Natural-language to data operations: translate human intent into accurate queries or commands.
2. Execution reasoning: explain the logic and performance implications behind queries.
3. Expert optimization: identify bottlenecks and propose indexing or rewrite strategies.
4. Data insight: extract meaningful patterns from result sets instead of merely restating rows.
5. Architecture review: evaluate schema design limitations and suggest evolution paths that can withstand data growth.

Interaction rules:
- Use professional, collaborative language and adapt to the user's selected interface language.
- When asked for database code, combine the answer with the relevant engine's best practices. If the exact version is unknown, use a standards-oriented baseline and note important version differences, such as MySQL 8 window functions.
- Do not refuse too quickly: if the user asks for SQL but no detailed DDL is attached, use the conversation context and any plain table-name list to infer the likely target table. If inference is not possible, explain what is known and ask which table they want to query.`
}
