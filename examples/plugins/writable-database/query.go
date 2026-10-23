package main

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

var fixtureSelect = regexp.MustCompile(`(?i)^SELECT (\*|ID, ?NAME|COUNT\(\*\) AS COUNT) FROM (?:PEOPLE|"PEOPLE")(?: LIMIT ([0-9]{1,5})(?: OFFSET ([0-9]{1,5}))?)?$`)
var fixtureSleep = regexp.MustCompile(`(?i)^SELECT SLEEP_MS\(([0-9]{1,5})\)$`)

func (f *fixture) query(ctx context.Context, r plugin.DataSourceRequest) (plugin.DataSourceQueryResult, error) {
	if err := f.check(ctx, r); err != nil {
		return plugin.DataSourceQueryResult{}, err
	}
	query := strings.Join(strings.Fields(strings.TrimSuffix(strings.TrimSpace(r.Query), ";")), " ")
	if strings.EqualFold(query, "SELECT 1") || strings.EqualFold(query, "SELECT 1 AS value") {
		return plugin.DataSourceQueryResult{Rows: []map[string]any{{"value": 1}}, Fields: []string{"value"}}, nil
	}
	if match := fixtureSleep.FindStringSubmatch(query); match != nil {
		return fixtureWait(ctx, match[1])
	}
	match := fixtureSelect.FindStringSubmatch(query)
	if match == nil {
		return plugin.DataSourceQueryResult{}, errors.New("query is outside the documented fixture SELECT subset")
	}
	if strings.EqualFold(match[1], "COUNT(*) AS COUNT") {
		if match[2] != "" {
			return plugin.DataSourceQueryResult{}, errors.New("count pagination is outside the fixture subset")
		}
		f.mu.Lock()
		count := len(f.rows)
		f.mu.Unlock()
		return plugin.DataSourceQueryResult{Rows: []map[string]any{{"count": count}}, Fields: []string{"count"}}, nil
	}
	limit, offset := 3, 0
	if match[2] != "" {
		parsed, err := strconv.Atoi(match[2])
		if err != nil {
			return plugin.DataSourceQueryResult{}, err
		}
		limit = parsed
	}
	if match[3] != "" {
		parsed, err := strconv.Atoi(match[3])
		if err != nil {
			return plugin.DataSourceQueryResult{}, err
		}
		offset = parsed
	}
	f.mu.Lock()
	rows := cloneRows(f.rows)
	f.mu.Unlock()
	if offset > len(rows) {
		offset = len(rows)
	}
	end := offset + limit
	if end > len(rows) {
		end = len(rows)
	}
	rows = rows[offset:end]
	fields := []string{"id", "name", "score"}
	if match[1] != "*" {
		fields = []string{"id", "name"}
		for _, row := range rows {
			delete(row, "score")
		}
	}
	return plugin.DataSourceQueryResult{Rows: rows, Fields: fields}, nil
}

func fixtureWait(ctx context.Context, raw string) (plugin.DataSourceQueryResult, error) {
	delay, err := strconv.Atoi(raw)
	if err != nil || delay > 5000 {
		return plugin.DataSourceQueryResult{}, errors.New("fixture delay must be at most 5000 milliseconds")
	}
	timer := time.NewTimer(time.Duration(delay) * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return plugin.DataSourceQueryResult{}, ctx.Err()
	case <-timer.C:
	}
	return plugin.DataSourceQueryResult{Rows: []map[string]any{{"slept_ms": delay}}, Fields: []string{"slept_ms"}}, nil
}
