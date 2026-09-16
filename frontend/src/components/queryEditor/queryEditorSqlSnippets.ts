import { v4 as uuidv4 } from 'uuid';

const buildSqlSnippetVariableMap = (now: Date): Record<string, string> => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return {
        CURRENT_YEAR: String(now.getFullYear()),
        CURRENT_MONTH: pad(now.getMonth() + 1),
        CURRENT_DATE: pad(now.getDate()),
        CURRENT_HOUR: pad(now.getHours()),
        CURRENT_MINUTE: pad(now.getMinutes()),
        CURRENT_SECOND: pad(now.getSeconds()),
        CURRENT_SECONDS_UNIX: String(Math.floor(now.getTime() / 1000)),
        UUID: uuidv4(),
        RANDOM: String(Math.floor(100000 + Math.random() * 900000)),
    };
};

export const materializeSqlSnippetText = (body: string, now = new Date()): string => {
    const tabstopValues = new Map<string, string>();
    const variableMap = buildSqlSnippetVariableMap(now);
    return String(body || '')
        .replace(/\$\{(\d+)\|([^}]+)\|\}/g, (_match, index: string, rawChoices: string) => {
            const choice = String(rawChoices || '')
                .split(',')
                .map((item) => item.trim())
                .find(Boolean) || '';
            if (index !== '0') {
                tabstopValues.set(index, choice);
            }
            return choice;
        })
        .replace(/\$\{([A-Z_]+)\}/g, (match, variableName: string) => (
            Object.prototype.hasOwnProperty.call(variableMap, variableName)
                ? variableMap[variableName]
                : match
        ))
        .replace(/\$\{(\d+):([^}]+)\}/g, (_match, index: string, placeholder: string) => {
            const value = String(placeholder || '');
            if (index !== '0') {
                tabstopValues.set(index, value);
            }
            return value;
        })
        .replace(/\$(\d+)/g, (_match, index: string) => (
            index === '0' ? '' : (tabstopValues.get(index) ?? '')
        ));
};
