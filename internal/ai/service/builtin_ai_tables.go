package aiservice

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/ai/runharness"
)

// The built-in model guesses table names it has not seen: asked for "some data" on KingBase it
// queried dbms_job.job_info, which does not exist, and gave up when that failed, instead of first
// listing the tables. So every turn tells it the real names: the tables of the database the person
// is in, read with the same get_tables tool it could call, and kept for a short while.

const (
	builtinAITablesTTL     = 2 * time.Minute
	builtinAITablesTimeout = 3 * time.Second
	// builtinAITablesMaxBytes bounds the list; the rest is counted, and get_tables has it all.
	builtinAITablesMaxBytes = 1200
)

type builtinAITableCache struct {
	mu      sync.Mutex
	entries map[string]builtinAITableEntry
}

type builtinAITableEntry struct {
	names []string
	at    time.Time
}

// builtinAITables lists the tables of the target's database, or nil when they cannot be read (no
// tool catalog, no connection, an error or a slow server: the turn goes ahead without them).
func (s *Service) builtinAITables(ctx context.Context, target builtinAITarget) []string {
	if s == nil || target.connectionID == "" || s.agentToolCatalog == nil {
		return nil
	}
	key := target.connectionID + "\x00" + target.dbName
	cache := &s.builtinTableCache
	cache.mu.Lock()
	if entry, ok := cache.entries[key]; ok && time.Since(entry.at) < builtinAITablesTTL {
		cache.mu.Unlock()
		return entry.names
	}
	cache.mu.Unlock()

	names := listBuiltinAITables(ctx, s.agentToolCatalog, target)
	cache.mu.Lock()
	if cache.entries == nil {
		cache.entries = map[string]builtinAITableEntry{}
	}
	cache.entries[key] = builtinAITableEntry{names: names, at: time.Now()}
	cache.mu.Unlock()
	return names
}

func listBuiltinAITables(ctx context.Context, catalog runharness.ToolCatalog, target builtinAITarget) []string {
	ctx, cancel := context.WithTimeout(ctx, builtinAITablesTimeout)
	defer cancel()
	_, executor, err := catalog.Resolve(ctx, "get_tables")
	if err != nil || executor == nil {
		return nil
	}
	args, _ := json.Marshal(map[string]string{"connectionId": target.connectionID, "dbName": target.dbName})
	result, err := executor.Execute(ctx, runharness.ToolExecutionRequest{ToolName: "get_tables", Effect: runharness.ToolEffectReadOnly, Arguments: args})
	if err != nil {
		return nil
	}
	encoded, err := json.Marshal(result.Value)
	if err != nil {
		return nil
	}
	var listed struct {
		Tables []string `json:"tables"`
	}
	if json.Unmarshal(encoded, &listed) != nil {
		return nil
	}
	return listed.Tables
}

// builtinAITablesLine is the line the model reads. With a current schema only its tables are
// listed (others are counted), since a database such as KingBase also lists system schemas.
func builtinAITablesLine(names []string, schema string) string {
	if len(names) == 0 {
		return ""
	}
	listed, elsewhere := names, 0
	if schema = strings.TrimSpace(schema); schema != "" {
		var own []string
		for _, name := range names {
			if strings.HasPrefix(name, schema+".") {
				own = append(own, name)
			}
		}
		if len(own) > 0 {
			listed, elsewhere = own, len(names)-len(own)
		}
	}
	var b strings.Builder
	b.WriteString("Tables in this database (use these exact names): ")
	shown := 0
	for _, name := range listed {
		if shown > 0 && b.Len()+len(name)+2 > builtinAITablesMaxBytes {
			break
		}
		if shown > 0 {
			b.WriteString(", ")
		}
		b.WriteString(name)
		shown++
	}
	if more := len(listed) - shown; more > 0 {
		fmt.Fprintf(&b, ", and %d more", more)
	}
	if elsewhere > 0 {
		fmt.Fprintf(&b, ". %d more in other schemas", elsewhere)
	}
	if len(listed)-shown > 0 || elsewhere > 0 {
		b.WriteString(" (call get_tables to see them)")
	}
	return b.String()
}
