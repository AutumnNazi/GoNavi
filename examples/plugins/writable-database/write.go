package main

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

var fixtureUpdate = regexp.MustCompile(`(?i)^UPDATE (?:PEOPLE|"PEOPLE") SET NAME = '([^']{1,64})' WHERE ID = ([1-9][0-9]{0,2})$`)

func (f *fixture) begin(ctx context.Context, r plugin.DataSourceRequest) (string, error) {
	if err := f.check(ctx, r); err != nil {
		return "", err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextTx++
	id := "fixture-tx-" + strconv.Itoa(f.nextTx)
	f.tx[id] = &fixtureTransaction{session: r.SessionID, backup: cloneRows(f.rows)}
	return id, nil
}

func (f *fixture) exec(ctx context.Context, r plugin.DataSourceRequest) (plugin.DataSourceExecResult, error) {
	if err := f.check(ctx, r); err != nil {
		return plugin.DataSourceExecResult{}, err
	}
	query := strings.Join(strings.Fields(strings.TrimSuffix(strings.TrimSpace(r.Query), ";")), " ")
	match := fixtureUpdate.FindStringSubmatch(query)
	if match == nil {
		return plugin.DataSourceExecResult{}, errors.New("statement is outside the documented fixture UPDATE subset")
	}
	id, err := strconv.Atoi(match[2])
	if err != nil {
		return plugin.DataSourceExecResult{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.tx[r.TransactionID]; !ok {
		return plugin.DataSourceExecResult{}, errors.New("fixture transaction is not active")
	}
	for _, row := range f.rows {
		if row["id"] == id {
			row["name"] = match[1]
			return plugin.DataSourceExecResult{RowsAffected: 1}, nil
		}
	}
	return plugin.DataSourceExecResult{RowsAffected: 0}, nil
}

func (f *fixture) commit(ctx context.Context, r plugin.DataSourceRequest) error {
	if err := f.check(ctx, r); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.tx[r.TransactionID]; !ok {
		return errors.New("fixture transaction is not active")
	}
	delete(f.tx, r.TransactionID)
	return nil
}

func (f *fixture) rollback(ctx context.Context, r plugin.DataSourceRequest) error {
	if err := f.check(ctx, r); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	tx, ok := f.tx[r.TransactionID]
	if !ok {
		return errors.New("fixture transaction is not active")
	}
	f.rows = cloneRows(tx.backup)
	delete(f.tx, r.TransactionID)
	return nil
}
