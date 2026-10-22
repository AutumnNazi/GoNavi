package db

import (
	"encoding/json"
	"math/big"
	"strconv"
)

func normalizePluginDatabaseValue(value any) any {
	switch typed := value.(type) {
	case json.Number:
		return pluginDatabaseNumberForClient(typed)
	case map[string]interface{}:
		for key, item := range typed {
			typed[key] = normalizePluginDatabaseValue(item)
		}
	case []interface{}:
		for index, item := range typed {
			typed[index] = normalizePluginDatabaseValue(item)
		}
	}
	return value
}

func pluginDatabaseNumberForClient(number json.Number) any {
	text := string(number)
	value, err := number.Float64()
	if err != nil {
		return text
	}
	// Avoid expensive rational exponents after a finite JSON decimal underflows.
	if value == 0 && text != "0" && text != "-0" {
		return text
	}
	exact, ok := new(big.Rat).SetString(text)
	if !ok {
		return text
	}
	limit := new(big.Rat).SetInt64(jsMaxSafeInteger)
	magnitude := new(big.Rat).Abs(exact)
	if magnitude.Cmp(limit) > 0 {
		return text
	}
	roundTrip, ok := new(big.Rat).SetString(strconv.FormatFloat(value, 'g', -1, 64))
	if !ok || exact.Cmp(roundTrip) != 0 {
		return text
	}
	// Retain the established driver policy for ordinary safe integers/decimals.
	return normalizeQueryValue(number)
}
