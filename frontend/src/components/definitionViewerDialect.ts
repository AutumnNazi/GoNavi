import { getDataSourceSpec } from '../utils/dataSourceRegistry';
import { resolveObjectMetadataDialect } from '../utils/objectMetadataDialect';

// 定义查看器拼查询用的方言（与对象概览共用一套归类规则）。
export const resolveDefinitionViewerDialect = (conn: any): string =>
  resolveObjectMetadataDialect(conn?.config?.type || '', conn?.config?.driver, conn?.config?.oceanBaseProtocol);

// 视图定义是否交给后端 DBShowCreateTable：Oracle 走 DBMS_METADATA；描述表数据源由驱动给出原生 DDL
// （CockroachDB 的 SHOW CREATE、QuestDB / GreptimeDB 的 SHOW CREATE VIEW、TimescaleDB 连续聚合的
// CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous)），驱动不认识时后端再回落到方言查询。
export const usesBackendViewDefinition = (conn: any, dialect: string): boolean =>
  dialect === 'oracle' || Boolean(getDataSourceSpec(String(conn?.config?.type || '')));

// 例程与触发器定义是否交给驱动：只用于没有借用方言的描述表数据源（如 GBase 8s），驱动按对象名返回原文。
export const usesDriverObjectDefinition = (conn: any): boolean => {
  const spec = getDataSourceSpec(String(conn?.config?.type || ''));
  return Boolean(spec && !spec.ddlDialect && spec.wire !== 'http');
};
