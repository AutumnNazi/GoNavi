const SQL_EDITOR_DML_KEYWORDS = new Set(['insert', 'update', 'delete', 'replace', 'merge', 'upsert']);
const SQL_EDITOR_READ_KEYWORDS = new Set(['select', 'with', 'show', 'describe', 'desc', 'explain', 'pragma', 'values']);
const SQL_EDITOR_TRANSACTION_CONTROL_KEYWORDS = new Set(['begin', 'commit', 'rollback', 'savepoint', 'release']);
const SQL_EDITOR_BEGIN_TRANSACTION_CONTROL_KEYWORDS = new Set([
    'transaction',
    'tran',
    'work',
    'isolation',
    'read',
    'write',
    'deferred',
    'immediate',
    'exclusive',
    'distributed',
]);
const SQL_EDITOR_MANAGED_TRANSACTION_UNSUPPORTED_TYPES = new Set([
    'trino',
    'tdengine',
    'clickhouse',
    'iotdb',
    'rocketmq',
    'mqtt',
    'kafka',
    'rabbitmq',
]);

type SqlEditorWithAnalysis = {
    keyword: string;
    cteHasManagedWrite: boolean;
};

const isSqlEditorKeywordChar = (char: string | undefined): boolean => !!char && /[A-Za-z0-9_]/.test(char);

const skipSqlEditorTrivia = (text: string, start: number): number => {
    let pos = start;
    while (pos < text.length) {
        const char = text[pos];
        if (/\s/.test(char || '')) {
            pos++;
            continue;
        }
        if (text.startsWith('--', pos) || text.startsWith('#', pos)) {
            const nextLine = text.indexOf('\n', pos);
            if (nextLine < 0) return text.length;
            pos = nextLine + 1;
            continue;
        }
        if (text.startsWith('/*', pos)) {
            const blockEnd = text.indexOf('*/', pos + 2);
            if (blockEnd < 0) return text.length;
            pos = blockEnd + 2;
            continue;
        }
        return pos;
    }
    return pos;
};

const readSqlEditorKeyword = (text: string, start: number): { keyword: string; end: number } => {
    const pos = skipSqlEditorTrivia(text, start);
    if (!isSqlEditorKeywordChar(text[pos])) {
        return { keyword: '', end: pos };
    }
    let end = pos + 1;
    while (isSqlEditorKeywordChar(text[end])) {
        end++;
    }
    return { keyword: text.slice(pos, end).toLowerCase(), end };
};

const skipSqlEditorDelimited = (text: string, start: number, delimiter: string): number => {
    let pos = start + 1;
    while (pos < text.length) {
        if (text[pos] === delimiter) {
            if (text[pos + 1] === delimiter) {
                pos += 2;
                continue;
            }
            return pos + 1;
        }
        pos++;
    }
    return text.length;
};

const resolveSqlEditorDollarQuoteTag = (text: string, start: number): string => {
    if (text[start] !== '$') return '';
    let end = start + 1;
    while (isSqlEditorKeywordChar(text[end])) {
        end++;
    }
    return text[end] === '$' ? text.slice(start, end + 1) : '';
};

const skipSqlEditorQuotedOrComment = (text: string, start: number): number | null => {
    if (text.startsWith('--', start) || text.startsWith('#', start)) {
        const nextLine = text.indexOf('\n', start);
        return nextLine < 0 ? text.length : nextLine + 1;
    }
    if (text.startsWith('/*', start)) {
        const blockEnd = text.indexOf('*/', start + 2);
        return blockEnd < 0 ? text.length : blockEnd + 2;
    }
    const char = text[start];
    if (char === '\'' || char === '"' || char === '`') {
        return skipSqlEditorDelimited(text, start, char);
    }
    if (char === '[') {
        const bracketEnd = text.indexOf(']', start + 1);
        return bracketEnd < 0 ? text.length : bracketEnd + 1;
    }
    const dollarTag = resolveSqlEditorDollarQuoteTag(text, start);
    if (dollarTag) {
        const dollarEnd = text.indexOf(dollarTag, start + dollarTag.length);
        return dollarEnd < 0 ? text.length : dollarEnd + dollarTag.length;
    }
    return null;
};

const skipBalancedSqlEditorParens = (text: string, start: number): number => {
    if (text[start] !== '(') return -1;
    let depth = 0;
    let pos = start;
    while (pos < text.length) {
        const skipped = skipSqlEditorQuotedOrComment(text, pos);
        if (skipped !== null) {
            pos = skipped;
            continue;
        }
        if (text[pos] === '(') {
            depth++;
            pos++;
            continue;
        }
        if (text[pos] === ')') {
            depth--;
            pos++;
            if (depth === 0) return pos;
            continue;
        }
        pos++;
    }
    return -1;
};

const skipSqlEditorIdentifierToken = (text: string, start: number): number => {
    if (start >= text.length) return -1;
    const char = text[start];
    if (char === '"' || char === '`') return skipSqlEditorDelimited(text, start, char);
    if (char === '[') {
        const bracketEnd = text.indexOf(']', start + 1);
        return bracketEnd < 0 ? text.length : bracketEnd + 1;
    }
    if (!isSqlEditorKeywordChar(char)) return -1;
    let end = start + 1;
    while (isSqlEditorKeywordChar(text[end])) {
        end++;
    }
    return end;
};

const findTopLevelSqlEditorKeyword = (text: string, start: number, keyword: string): number => {
    let depth = 0;
    let pos = start;
    while (pos < text.length) {
        const skipped = skipSqlEditorQuotedOrComment(text, pos);
        if (skipped !== null) {
            pos = skipped;
            continue;
        }
        if (text[pos] === '(') {
            depth++;
            pos++;
            continue;
        }
        if (text[pos] === ')') {
            if (depth > 0) depth--;
            pos++;
            continue;
        }
        if (depth === 0 && isSqlEditorKeywordChar(text[pos])) {
            let end = pos + 1;
            while (isSqlEditorKeywordChar(text[end])) {
                end++;
            }
            if (text.slice(pos, end).toLowerCase() === keyword) {
                return end;
            }
            pos = end;
            continue;
        }
        pos++;
    }
    return -1;
};

const resolveSqlEditorWithAnalysis = (text: string, start: number): SqlEditorWithAnalysis => {
    let pos = skipSqlEditorTrivia(text, start);
    let cteHasManagedWrite = false;
    const recursive = readSqlEditorKeyword(text, pos);
    if (recursive.keyword === 'recursive') {
        pos = recursive.end;
    }

    while (pos < text.length) {
        pos = skipSqlEditorTrivia(text, pos);
        const identifierEnd = skipSqlEditorIdentifierToken(text, pos);
        if (identifierEnd < 0) return { keyword: '', cteHasManagedWrite };
        pos = skipSqlEditorTrivia(text, identifierEnd);
        if (text[pos] === '(') {
            const columnsEnd = skipBalancedSqlEditorParens(text, pos);
            if (columnsEnd < 0) return { keyword: '', cteHasManagedWrite };
            pos = skipSqlEditorTrivia(text, columnsEnd);
        }

        const asEnd = findTopLevelSqlEditorKeyword(text, pos, 'as');
        if (asEnd < 0) return { keyword: '', cteHasManagedWrite };
        pos = skipSqlEditorTrivia(text, asEnd);
        const materialized = readSqlEditorKeyword(text, pos);
        if (materialized.keyword === 'not') {
            const next = readSqlEditorKeyword(text, materialized.end);
            if (next.keyword === 'materialized') {
                pos = next.end;
            }
        } else if (materialized.keyword === 'materialized') {
            pos = materialized.end;
        }

        pos = skipSqlEditorTrivia(text, pos);
        if (text[pos] !== '(') return { keyword: '', cteHasManagedWrite };
        const cteBodyStart = pos + 1;
        const cteEnd = skipBalancedSqlEditorParens(text, pos);
        if (cteEnd < 0) return { keyword: '', cteHasManagedWrite };
        const cteBody = text.slice(cteBodyStart, Math.max(cteBodyStart, cteEnd - 1));
        if (sqlEditorStatementHasManagedWrite(cteBody)) {
            cteHasManagedWrite = true;
        }
        pos = skipSqlEditorTrivia(text, cteEnd);
        if (text[pos] === ',') {
            pos++;
            continue;
        }

        return { keyword: readSqlEditorKeyword(text, pos).keyword, cteHasManagedWrite };
    }
    return { keyword: '', cteHasManagedWrite };
};

export const resolveSqlEditorOperationKeyword = (statement: string): string => {
    const text = String(statement || '');
    const leading = readSqlEditorKeyword(text, 0);
    if (leading.keyword !== 'with') {
        return leading.keyword;
    }
    return resolveSqlEditorWithAnalysis(text, leading.end).keyword || leading.keyword;
};

const sqlEditorStatementHasManagedWrite = (statement: string): boolean => {
    const text = String(statement || '');
    const leading = readSqlEditorKeyword(text, 0);
    if (leading.keyword === 'with') {
        const analysis = resolveSqlEditorWithAnalysis(text, leading.end);
        return analysis.cteHasManagedWrite || SQL_EDITOR_DML_KEYWORDS.has(analysis.keyword);
    }
    return SQL_EDITOR_DML_KEYWORDS.has(leading.keyword);
};

const sqlEditorStatementContainsKeyword = (statement: string, wantedKeyword: string): boolean => {
    const text = String(statement || '');
    for (let pos = 0; pos < text.length;) {
        const skipped = skipSqlEditorQuotedOrComment(text, pos);
        if (skipped !== null) {
            pos = skipped;
            continue;
        }
        if (!isSqlEditorKeywordChar(text[pos])) {
            pos++;
            continue;
        }
        let end = pos + 1;
        while (isSqlEditorKeywordChar(text[end])) {
            end++;
        }
        if (text.slice(pos, end).toLowerCase() === wantedKeyword) {
            return true;
        }
        pos = end;
    }
    return false;
};

const isSqlEditorBeginTransactionControlStatement = (statement: string, keywordEnd: number): boolean => {
    const text = String(statement || '');
    const next = skipSqlEditorTrivia(text, keywordEnd);
    if (next >= text.length || text[next] === ';') return true;
    return SQL_EDITOR_BEGIN_TRANSACTION_CONTROL_KEYWORDS.has(readSqlEditorKeyword(text, keywordEnd).keyword);
};

export const isSqlEditorTransactionControlStatement = (statement: string): boolean => {
    const text = String(statement || '');
    const leading = readSqlEditorKeyword(text, 0);
    if (leading.keyword === 'begin') {
        return isSqlEditorBeginTransactionControlStatement(text, leading.end);
    }
    if (SQL_EDITOR_TRANSACTION_CONTROL_KEYWORDS.has(leading.keyword)) return true;
    return leading.keyword === 'start' && readSqlEditorKeyword(text, leading.end).keyword === 'transaction';
};

const isSqlEditorManagedBlockWrite = (type: string, statement: string): boolean => {
    const text = String(statement || '');
    const leading = readSqlEditorKeyword(text, 0);
    const normalizedType = String(type || '').trim().toLowerCase();
    const isOracleLike = ['oracle', 'dameng', 'dm', 'dm8'].includes(normalizedType);
    const isSqlServer = ['sqlserver', 'mssql', 'sql_server', 'sql-server'].includes(normalizedType);

    if (isOracleLike) {
        if (leading.keyword !== 'begin' && leading.keyword !== 'declare') return false;
    } else if (isSqlServer) {
        if (leading.keyword !== 'begin' || isSqlEditorBeginTransactionControlStatement(text, leading.end)) return false;
    } else {
        return false;
    }

    return [...SQL_EDITOR_DML_KEYWORDS].some((keyword) => sqlEditorStatementContainsKeyword(text, keyword));
};

export const shouldUseSqlEditorManagedTransactionForType = (
    type: string,
    statements: string[],
): boolean => {
    if (SQL_EDITOR_MANAGED_TRANSACTION_UNSUPPORTED_TYPES.has(String(type || '').trim().toLowerCase())) {
        return false;
    }
    let hasManagedWrite = false;
    for (const statement of statements) {
        const trimmed = String(statement || '').trim();
        if (!trimmed) continue;
        if (isSqlEditorTransactionControlStatement(trimmed)) return false;
        if (isSqlEditorManagedBlockWrite(type, trimmed)) {
            hasManagedWrite = true;
            continue;
        }
        if (sqlEditorStatementHasManagedWrite(trimmed)) {
            hasManagedWrite = true;
            continue;
        }
        const keyword = resolveSqlEditorOperationKeyword(trimmed);
        if (SQL_EDITOR_READ_KEYWORDS.has(keyword)) continue;
        return false;
    }
    return hasManagedWrite;
};

export const shouldUseSqlEditorManagedTransaction = (statements: string[]): boolean =>
    shouldUseSqlEditorManagedTransactionForType('', statements);

export const canReusePendingSqlEditorTransactionForType = (
    type: string,
    statements: string[],
): boolean => {
    if (SQL_EDITOR_MANAGED_TRANSACTION_UNSUPPORTED_TYPES.has(String(type || '').trim().toLowerCase())) {
        return false;
    }
    let hasReadStatement = false;
    for (const statement of statements) {
        const trimmed = String(statement || '').trim();
        if (!trimmed) continue;
        if (isSqlEditorTransactionControlStatement(trimmed)) return false;
        if (isSqlEditorManagedBlockWrite(type, trimmed)) return false;
        if (sqlEditorStatementHasManagedWrite(trimmed)) return false;
        const keyword = resolveSqlEditorOperationKeyword(trimmed);
        if (!SQL_EDITOR_READ_KEYWORDS.has(keyword)) return false;
        hasReadStatement = true;
    }
    return hasReadStatement;
};

export const canReusePendingSqlEditorTransaction = (statements: string[]): boolean =>
    canReusePendingSqlEditorTransactionForType('', statements);
