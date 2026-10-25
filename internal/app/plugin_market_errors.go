package app

import (
	"GoNavi-Wails/internal/pluginmarket"
	"context"
	"errors"
)

func marketFailureCode(err error) string {
	switch {
	case errors.Is(err, pluginmarket.ErrUnauthenticated):
		return "authentication_required"
	case errors.Is(err, pluginmarket.ErrInvalidRequest), errors.Is(err, pluginmarket.ErrInvalidURL):
		return "invalid_request"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, pluginmarket.ErrSourceChanged):
		return "source_changed"
	case errors.Is(err, pluginmarket.ErrInvalidResponse):
		return "invalid_response"
	case errors.Is(err, pluginmarket.ErrResponseTooLarge):
		return "response_too_large"
	case errors.Is(err, pluginmarket.ErrRedirect):
		return "redirect_rejected"
	}
	var api *pluginmarket.APIError
	if errors.As(err, &api) {
		switch api.Code {
		case "artifact_invalid", "forbidden", "conflict", "auth_unavailable", "rate_limited", "server_busy", "not_found", "authentication_required":
			return api.Code
		}
	}
	return "market_unavailable"
}
