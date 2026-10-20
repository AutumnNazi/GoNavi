package app

import (
	"strings"

	"GoNavi-Wails/internal/ai"
)

func inspectionStatements(dbType, query string) []string {
	if strings.EqualFold(strings.TrimSpace(dbType), "redis") {
		// Redis executes one argument vector; semicolons can be part of keys or values.
		return []string{query}
	}
	return splitSQLStatementsForDialect(dbType, query)
}

func inspectStatement(dbType, statement string, index int) SQLStatementInspection {
	if strings.EqualFold(strings.TrimSpace(dbType), "redis") {
		args := parseRedisCommand(statement)
		operation := redisCommandOperation(args)
		item := SQLStatementInspection{Index: index, ReadOnly: operation == ai.SQLOpQuery, OperationType: operation}
		if len(args) > 0 {
			item.Keyword = strings.ToLower(args[0])
		}
		return item
	}
	return SQLStatementInspection{Index: index, Keyword: leadingSQLKeyword(statement), ReadOnly: isReadOnlySQLQuery(dbType, statement)}
}

func redisCommandOperation(args []string) ai.SQLOperationType {
	if len(args) == 0 {
		return ai.SQLOpOther
	}
	// Explicit allowlists keep scripts, administration, mixed read/write commands
	// (such as SORT ... STORE), and unknown module commands in full mode.
	switch strings.ToUpper(args[0]) {
	case "GET", "MGET", "STRLEN", "GETRANGE", "TYPE", "TTL", "PTTL", "EXPIRETIME", "PEXPIRETIME", "EXISTS", "DUMP",
		"KEYS", "SCAN", "HGET", "HMGET", "HGETALL", "HEXISTS", "HLEN", "HKEYS", "HVALS", "HSCAN", "HSTRLEN",
		"LINDEX", "LLEN", "LRANGE", "LPOS", "SCARD", "SMEMBERS", "SISMEMBER", "SMISMEMBER", "SSCAN", "SINTER", "SUNION", "SDIFF",
		"ZCARD", "ZCOUNT", "ZLEXCOUNT", "ZRANGE", "ZRANGEBYSCORE", "ZREVRANGE", "ZREVRANGEBYSCORE", "ZRANK", "ZREVRANK", "ZSCORE", "ZMSCORE", "ZSCAN",
		"XRANGE", "XREVRANGE", "XLEN", "XREAD", "XINFO", "BITCOUNT", "GETBIT", "BITFIELD_RO", "SORT_RO", "GEODIST", "GEOHASH", "GEOPOS", "GEOSEARCH",
		"PING", "ECHO", "DBSIZE", "INFO", "TIME":
		return ai.SQLOpQuery
	case "SET", "SETNX", "SETEX", "PSETEX", "MSET", "MSETNX", "GETSET", "GETDEL", "GETEX", "APPEND", "SETRANGE", "INCR", "INCRBY", "INCRBYFLOAT", "DECR", "DECRBY",
		"DEL", "UNLINK", "EXPIRE", "PEXPIRE", "EXPIREAT", "PEXPIREAT", "PERSIST", "RENAME", "RENAMENX", "COPY", "RESTORE", "TOUCH",
		"HSET", "HSETNX", "HMSET", "HDEL", "HINCRBY", "HINCRBYFLOAT", "LPUSH", "RPUSH", "LPUSHX", "RPUSHX", "LPOP", "RPOP", "LSET", "LREM", "LTRIM", "LINSERT", "LMOVE", "RPOPLPUSH",
		"SADD", "SREM", "SPOP", "SMOVE", "SINTERSTORE", "SUNIONSTORE", "SDIFFSTORE", "ZADD", "ZREM", "ZINCRBY", "ZPOPMIN", "ZPOPMAX", "ZREMRANGEBYRANK", "ZREMRANGEBYSCORE", "ZREMRANGEBYLEX",
		"ZUNIONSTORE", "ZINTERSTORE", "ZDIFFSTORE", "XADD", "XDEL", "XTRIM", "XACK", "XCLAIM", "XAUTOCLAIM", "XREADGROUP", "SETBIT", "BITOP", "GEOADD", "GEOSEARCHSTORE", "PFADD", "PFMERGE":
		return ai.SQLOpDML
	default:
		return ai.SQLOpOther
	}
}
