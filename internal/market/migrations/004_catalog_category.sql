CREATE OR REPLACE FUNCTION market_plugin_category(manifest jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $category$
 SELECT CASE
 WHEN manifest #> '{contributes,dataSources,0}' IS NOT NULL THEN 'datasource'
 WHEN manifest #> '{contributes,aiProviders,0}' IS NOT NULL THEN 'ai-provider'
 WHEN manifest #> '{contributes,exporters,0}' IS NOT NULL THEN 'exporter'
 WHEN manifest #> '{contributes,panels,0}' IS NOT NULL AND manifest #> '{contributes,commands,0}' IS NOT NULL THEN 'ops'
 WHEN manifest #> '{contributes,panels,0}' IS NOT NULL THEN 'panel'
 WHEN manifest #> '{contributes,skills,0}' IS NOT NULL THEN 'skill'
 WHEN manifest #> '{contributes,commands,0}' IS NOT NULL THEN 'command'
 WHEN manifest -> 'window' IS NOT NULL AND manifest -> 'window' <> 'null'::jsonb THEN 'panel'
 ELSE 'other' END
$category$;
