package market

import (
	"strings"

	"GoNavi-Wails/internal/marketfilter"

	"github.com/lib/pq"
)

func catalogStatement(q CatalogQuery, order string) (string, []any) {
	filters, _ := marketfilter.Normalize(q.Filters)
	statement := `SELECT ` + strings.Replace(catalogColumns, "v.manifest", "NULL::jsonb", 1) + ` FROM market_plugins p JOIN market_users u ON u.id=p.owner_id
 JOIN LATERAL (SELECT * FROM market_versions WHERE plugin_id=p.id AND state='published'
 AND ($3='' OR min_host_version='' OR market_semver_le(min_host_version,$3))
 AND ($4='' OR 'any'=ANY(platforms) OR $4=ANY(platforms))
 AND (cardinality($8::text[])=0 OR 'any'=ANY(platforms) OR platforms && $8::text[])
 ORDER BY updated_at DESC,id LIMIT 1) v ON true` + ratingJoin + `
 WHERE ($1='' OR strpos(lower(p.id || ' ' || v.name || ' ' || v.description),lower($1))>0)
 AND ($6='' OR market_plugin_category(v.manifest)=$6)
 AND (cardinality($7::text[])=0 OR market_plugin_category(v.manifest)=ANY($7::text[]))
 AND ($9='' OR ($9='official' AND u.official) OR ($9='community' AND NOT u.official))
 AND ($10='' OR strpos(lower(v.author || ' ' || p.publisher_id),lower($10))>0)
 ORDER BY u.official DESC,` + order + `,p.id LIMIT $2 OFFSET $5`
	return statement, []any{q.Query, q.Limit + 1, q.HostVersion, q.Platform, q.Offset, q.Category, pq.Array(filters.Categories), pq.Array(marketfilter.PlatformValues(filters)), filters.Official, filters.Author}
}
