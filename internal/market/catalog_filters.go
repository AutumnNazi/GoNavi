package market

import (
	"net/url"

	"GoNavi-Wails/internal/marketfilter"
)

func parseExtraCatalogFilters(values url.Values, q *CatalogQuery) error {
	if version := values.Get("filtersVersion"); version != "" && version != "1" {
		return ErrInvalid
	}
	filters, err := marketfilter.Normalize(marketfilter.Filters{Categories: values["categories"], Platforms: values["platforms"], Official: values.Get("official"), Author: values.Get("author")})
	if err != nil {
		return ErrInvalid
	}
	q.Filters = filters
	return validateExtraCatalogFilters(*q)
}
func validateExtraCatalogFilters(q CatalogQuery) error {
	if _, err := marketfilter.Normalize(q.Filters); err != nil {
		return ErrInvalid
	}
	if q.Category != "" && len(q.Filters.Categories) > 0 || q.Platform != "" && len(q.Filters.Platforms) > 0 {
		return ErrInvalid
	}
	return nil
}
