import type { AISafetyLevel, SavedConnection, TabData } from '../../types';
import type { AIInspectionTranslator } from './aiInspectionI18n';
import { translateInspectionCopy } from './aiInspectionI18n';

const SAFETY_LEVEL_FALLBACKS: Record<string, string> = {
  readonly: 'Read-only',
  readwrite: 'Read/write',
  full: 'Full access',
};

const SAFETY_RULE_FALLBACKS: Record<string, string> = {
  readonly: 'Read-only mode only allows query statements.',
  readwrite: 'Read/write mode allows queries and DML; DDL is still blocked.',
  full: 'Full access mode allows all SQL operations; high-risk or unrecognized statements still require confirmation.',
};

const normalizeSafetyLevel = (value: AISafetyLevel | string | undefined): string => {
  const level = String(value || 'readonly').trim().toLowerCase();
  if (level === 'readwrite' || level === 'full') {
    return level;
  }
  return 'readonly';
};

const buildPermissionMatrix = (safetyLevel: string) => ({
  allowQuery: true,
  allowDML: safetyLevel === 'readwrite' || safetyLevel === 'full',
  allowDDL: safetyLevel === 'full',
  requiresConfirmationForAllowedNonQuery: true,
  requiresMCPAllowMutatingForAllowedNonQuery: false,
});

export const buildAISafetySnapshot = (params: {
  safetyLevel?: AISafetyLevel | string;
  activeContext?: { connectionId: string; dbName?: string } | null;
  tabs?: TabData[];
  activeTabId?: string | null;
  connections: SavedConnection[];
  translate?: AIInspectionTranslator;
}) => {
  const {
    safetyLevel,
    activeContext = null,
    tabs = [],
    activeTabId = null,
    connections,
    translate,
  } = params;

  const normalizedSafetyLevel = normalizeSafetyLevel(safetyLevel);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const connectionId = String(activeContext?.connectionId || activeTab?.connectionId || '').trim();
  const activeDbName = String(activeContext?.dbName || activeTab?.dbName || '').trim();
  const connection = connectionId
    ? connections.find((item) => item.id === connectionId)
    : undefined;
  const config = connection?.config;
  const jvm = config?.jvm;
  const diagnostic = jvm?.diagnostic;
  const isJVMSession = config?.type === 'jvm';
  const activeResultReadOnly = activeTab?.readOnly === true;
  const jvmReadOnly = isJVMSession && jvm?.readOnly !== false;
  const safetyLabel = translateInspectionCopy(
    translate,
    `ai_chat.inspection.runtime.safety.${normalizedSafetyLevel}`,
    SAFETY_LEVEL_FALLBACKS[normalizedSafetyLevel] || normalizedSafetyLevel,
  );
  const sqlRuleText = translateInspectionCopy(
    translate,
    `ai_chat.inspection.safety.rule.${normalizedSafetyLevel}`,
    SAFETY_RULE_FALLBACKS[normalizedSafetyLevel] || SAFETY_RULE_FALLBACKS.readonly,
  );

  const effectiveRestrictions = [
    sqlRuleText,
  ];
  if (normalizedSafetyLevel === 'readonly') {
    effectiveRestrictions.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.restriction.readonly_blocks_mutating',
      'At the current safety level, all DML/DDL is blocked directly.',
    ));
  } else {
    effectiveRestrictions.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.restriction.non_query_confirmation',
      'Any allowed non-query statement still requires human confirmation.',
    ));
    effectiveRestrictions.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.restriction.mcp_allow_mutating',
      'GoNavi MCP execute_sql uses the same safety controls as the built-in assistant. Calling execute_sql is the confirmation; allowMutating is not required for SQL the current safety level already allows.',
    ));
  }
  if (activeResultReadOnly) {
    effectiveRestrictions.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.restriction.active_result_readonly',
      'The current active tab result set is read-only and cannot be treated as a directly writable data grid.',
    ));
  }
  if (jvmReadOnly) {
    effectiveRestrictions.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.restriction.jvm_readonly',
      'The current JVM connection is read-only, so diagnostic plans should default to observation and troubleshooting.',
    ));
  }
  if (isJVMSession && diagnostic?.allowMutatingCommands !== true) {
    effectiveRestrictions.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.restriction.jvm_mutating_disabled',
      'Current JVM diagnostics explicitly disallow mutating commands, even if the AI safety level allows writes.',
    ));
  }

  const recommendations: string[] = [];
  if (normalizedSafetyLevel === 'readonly') {
    recommendations.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.recommendation.enable_readwrite_for_dml',
      'Switch AI safety level to read/write mode before executing INSERT/UPDATE/DELETE.',
    ));
    recommendations.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.recommendation.enable_full_for_ddl',
      'Switch to full access mode before executing CREATE/ALTER/DROP/TRUNCATE schema changes.',
    ));
  } else if (normalizedSafetyLevel === 'readwrite') {
    recommendations.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.recommendation.full_required_for_schema',
      'DML is already allowed; schema changes still require full access mode.',
    ));
  }
  if (activeResultReadOnly) {
    recommendations.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.recommendation.open_editable_grid',
      'If the goal is editing a result grid, reopen an editable table or query result instead of the current read-only tab.',
    ));
  }
  if (jvmReadOnly) {
    recommendations.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.recommendation.confirm_jvm_policy',
      'The current JVM connection should be treated as read-only; confirm whether its policy should change before mutating diagnostics.',
    ));
  }
  if (isJVMSession && diagnostic?.allowMutatingCommands !== true) {
    recommendations.push(translateInspectionCopy(
      translate,
      'ai_chat.inspection.safety.recommendation.enable_jvm_mutating',
      'JVM diagnostics currently disallow mutating commands; adjust diagnostic permissions before high-risk commands.',
    ));
  }

  return {
    safetyLevel: normalizedSafetyLevel,
    safetyLabel,
    sqlRuleText,
    permissionMatrix: buildPermissionMatrix(normalizedSafetyLevel),
    hasActiveConnection: Boolean(connection),
    activeConnection: connection
      ? {
          connectionId: connection.id,
          connectionName: connection.name,
          connectionType: config?.type || '',
          host: config?.host || '',
          activeDbName: activeDbName || config?.database || '',
          readOnly: activeResultReadOnly || jvmReadOnly,
        }
      : null,
    activeTab: activeTab
      ? {
          id: activeTab.id,
          title: activeTab.title || '',
          type: activeTab.type || '',
          readOnly: activeResultReadOnly,
        }
      : null,
    jvmGuards: isJVMSession
      ? {
          readOnly: jvmReadOnly,
          transport: diagnostic?.transport || 'agent-bridge',
          allowObserveCommands: diagnostic?.allowObserveCommands !== false,
          allowTraceCommands: diagnostic?.allowTraceCommands === true,
          allowMutatingCommands: diagnostic?.allowMutatingCommands === true,
        }
      : null,
    effectiveRestrictions,
    recommendations,
    message: connection
      ? translateInspectionCopy(
        translate,
        'ai_chat.inspection.safety.message.active',
        `AI safety level is ${safetyLabel}; active connection is ${connection.name}`,
        { safety: safetyLabel, connection: connection.name },
      )
      : translateInspectionCopy(
        translate,
        'ai_chat.inspection.safety.message.no_connection',
        `AI safety level is ${safetyLabel}; no active connection is selected`,
        { safety: safetyLabel },
      ),
  };
};
