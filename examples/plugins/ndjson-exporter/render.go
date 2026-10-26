package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

var errRenderLimit = errors.New("export document limit exceeded")

func renderNDJSON(ctx context.Context, snapshot plugin.ExporterSnapshot) (string, error) {
	var output bytes.Buffer
	for _, row := range snapshot.Rows {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		output.WriteByte('{')
		for column, cell := range row {
			if err := ctx.Err(); err != nil {
				return "", err
			}
			if column > 0 {
				output.WriteByte(',')
			}
			name, err := json.Marshal(snapshot.Columns[column])
			if err != nil {
				return "", errRenderLimit
			}
			output.Write(name)
			output.WriteByte(':')
			if err = appendCell(&output, cell); err != nil {
				return "", err
			}
			if output.Len() > plugin.ExporterMaxEnvelopeBytes {
				return "", errRenderLimit
			}
		}
		output.WriteString("}\n")
		if output.Len() > plugin.ExporterMaxEnvelopeBytes {
			return "", errRenderLimit
		}
	}
	return output.String(), nil
}

func appendCell(output *bytes.Buffer, cell plugin.ExporterCell) error {
	kind, err := json.Marshal(cell.Kind)
	if err != nil {
		return errRenderLimit
	}
	output.WriteString(`{"kind":`)
	output.Write(kind)
	switch cell.Kind {
	case plugin.ExporterMissing, plugin.ExporterNull:
		if cell.Value != nil {
			return errRenderLimit
		}
	case plugin.ExporterNumber, plugin.ExporterBoolean, plugin.ExporterJSON:
		if cell.Value == nil {
			return errRenderLimit
		}
		// The SDK already validated these lexemes without float conversion. Copy them verbatim.
		output.WriteString(`,"value":`)
		output.WriteString(*cell.Value)
	case plugin.ExporterString, plugin.ExporterBinary:
		if cell.Value == nil {
			return errRenderLimit
		}
		encoded, err := json.Marshal(*cell.Value)
		if err != nil {
			return errRenderLimit
		}
		output.WriteString(`,"value":`)
		output.Write(encoded)
	default:
		return errRenderLimit
	}
	output.WriteByte('}')
	return nil
}
