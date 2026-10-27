-- Owner-initiated plugin deletion must remove published versions too. The purge
-- flag is set with SET LOCAL inside the delete transaction only, so release
-- immutability stays in force for every other DELETE and all UPDATE paths.
CREATE OR REPLACE FUNCTION market_protect_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF current_setting('gonavi.market.purge', true) = 'on' THEN RETURN OLD; END IF;
  IF OLD.state IN ('published','yanked') THEN RAISE EXCEPTION 'released versions cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.state IN ('published','yanked') AND
  (ROW(NEW.plugin_id,NEW.version,NEW.name,NEW.description,NEW.author,NEW.min_host_version,NEW.platforms,NEW.manifest,NEW.sha256,NEW.size_bytes)
   IS DISTINCT FROM ROW(OLD.plugin_id,OLD.version,OLD.name,OLD.description,OLD.author,OLD.min_host_version,OLD.platforms,OLD.manifest,OLD.sha256,OLD.size_bytes)
   OR (NEW.state <> OLD.state AND NOT (OLD.state='published' AND NEW.state='yanked'))) THEN
  RAISE EXCEPTION 'released versions are immutable';
 END IF;
 RETURN NEW;
END $$;
