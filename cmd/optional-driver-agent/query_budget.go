package main

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"time"

	"GoNavi-Wails/internal/db"
	sshbridge "GoNavi-Wails/internal/ssh"
)

func fail(response agentResponse, errorText string) agentResponse {
	response.Success = false
	response.Error = strings.TrimSpace(errorText)
	return response
}

func failWithSSHHostKeyTrust(response agentResponse, err error) agentResponse {
	response = fail(response, err.Error())
	if status, ok := sshbridge.HostKeyTrustStatusFromError(err); ok {
		response.SSHHostKeyTrust = &status
	}
	return response
}

func normalizeAgentResponseData(value interface{}) interface{} {
	if value == nil {
		return nil
	}

	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Pointer, reflect.Interface:
		if reflected.IsNil() {
			return nil
		}
		return normalizeAgentResponseData(reflected.Elem().Interface())
	case reflect.Map:
		if reflected.IsNil() {
			return nil
		}
		out := make(map[string]interface{}, reflected.Len())
		iter := reflected.MapRange()
		for iter.Next() {
			out[fmt.Sprint(iter.Key().Interface())] = normalizeAgentResponseData(iter.Value().Interface())
		}
		return out
	case reflect.Slice:
		if reflected.IsNil() {
			return nil
		}
		if reflected.Type().Elem().Kind() == reflect.Uint8 {
			return value
		}
		size := reflected.Len()
		items := make([]interface{}, size)
		for index := 0; index < size; index++ {
			items[index] = normalizeAgentResponseData(reflected.Index(index).Interface())
		}
		return items
	case reflect.Array:
		size := reflected.Len()
		items := make([]interface{}, size)
		for index := 0; index < size; index++ {
			items[index] = normalizeAgentResponseData(reflected.Index(index).Interface())
		}
		return items
	default:
		return value
	}
}

func agentQueryRequestContext(timeoutMs int64, options *db.RowBudgetOptions) (context.Context, context.CancelFunc, *db.RowBudget) {
	ctx := context.Background()
	cancel := func() {}
	if timeoutMs > 0 {
		ctx, cancel = context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	}
	var budget *db.RowBudget
	if options != nil {
		budget = db.NewRowBudgetWithOptions(*options)
		ctx = db.ContextWithRowBudget(ctx, budget)
	}
	return ctx, cancel, budget
}

func applyAgentBudgetResponse(response *agentResponse, budget *db.RowBudget) {
	if response == nil || budget == nil {
		return
	}
	response.Truncated = budget.Truncated()
	response.BudgetExhausted = budget.Exhausted()
}
