CREATE TABLE market_users (
 id text PRIMARY KEY, login text NOT NULL DEFAULT '',
 role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','publisher','admin')),
 publisher_id text NOT NULL DEFAULT '', official boolean NOT NULL DEFAULT false,
 CHECK (NOT official OR (publisher_id<>'' AND role IN ('publisher','admin'))),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX market_publisher_unique ON market_users(publisher_id) WHERE publisher_id <> '';
CREATE TABLE market_plugins (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES market_users(id),
 publisher_id text NOT NULL, download_count bigint NOT NULL DEFAULT 0 CHECK (download_count >= 0)
);
CREATE TABLE market_versions (
 id text PRIMARY KEY, plugin_id text NOT NULL REFERENCES market_plugins(id), version text NOT NULL,
 state text NOT NULL CHECK (state IN ('draft','submitted','validating','pending_review','published','rejected','yanked')),
 name text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', author text NOT NULL DEFAULT '',
 min_host_version text NOT NULL DEFAULT '', platforms text[] NOT NULL DEFAULT '{}',
 manifest jsonb, sha256 text NOT NULL DEFAULT '' CHECK (sha256='' OR sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes BETWEEN 0 AND 67108864),
 CHECK (state NOT IN ('pending_review','published','yanked') OR (manifest IS NOT NULL AND sha256<>'' AND size_bytes>0 AND cardinality(platforms)>0)),
 reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (plugin_id,version)
);
CREATE INDEX market_public_versions ON market_versions(plugin_id,updated_at DESC) WHERE state='published';
CREATE INDEX market_public_artifacts ON market_versions(sha256) WHERE state='published';
CREATE TABLE market_ratings (
 user_id text NOT NULL REFERENCES market_users(id), plugin_id text NOT NULL REFERENCES market_plugins(id),
 stars integer NOT NULL CHECK (stars BETWEEN 1 AND 5), body text NOT NULL CHECK (octet_length(body)<=4000),
 version text NOT NULL, hidden boolean NOT NULL DEFAULT false, deleted boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id,plugin_id)
);
CREATE INDEX market_visible_ratings ON market_ratings(plugin_id) WHERE NOT hidden AND NOT deleted;
CREATE TABLE market_audit (
 id bigserial PRIMARY KEY, actor_id text NOT NULL, action text NOT NULL, subject text NOT NULL,
 reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE market_reports (
 id bigserial PRIMARY KEY, actor_id text NOT NULL REFERENCES market_users(id),
 plugin_id text NOT NULL REFERENCES market_plugins(id), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE market_sessions (
 token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES market_users(id), expires_at timestamptz NOT NULL
);
CREATE INDEX market_sessions_expiry ON market_sessions(expires_at);
CREATE TABLE market_devices (
 code_hash text PRIMARY KEY, user_code_hash text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','authorized','denied','consumed')),
 account_id text REFERENCES market_users(id), expires_at timestamptz NOT NULL, next_poll_at timestamptz NOT NULL
);
CREATE INDEX market_devices_expiry ON market_devices(expires_at);
CREATE TABLE market_auth_flows (
 hash text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('oauth','consent')),
 verifier text NOT NULL DEFAULT '', user_code text NOT NULL, account_id text NOT NULL DEFAULT '', expires_at timestamptz NOT NULL
);
CREATE INDEX market_flows_expiry ON market_auth_flows(expires_at);

CREATE FUNCTION market_protect_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
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
CREATE TRIGGER market_release_immutable BEFORE UPDATE OR DELETE ON market_versions FOR EACH ROW EXECUTE FUNCTION market_protect_release();

CREATE FUNCTION market_semver_le(left_version text, right_version text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
 l text := split_part(ltrim(left_version,'v'),'+',1);
 r text := split_part(ltrim(right_version,'v'),'+',1);
 lc numeric[]; rc numeric[]; lp text[]; rp text[]; i integer;
BEGIN
 IF left_version='' OR right_version='' THEN RETURN true; END IF;
 lc := string_to_array(split_part(l,'-',1),'.')::numeric[];
 rc := string_to_array(split_part(r,'-',1),'.')::numeric[];
 IF lc <> rc THEN RETURN lc < rc; END IF;
 IF position('-' IN l)=0 THEN RETURN position('-' IN r)=0; END IF;
 IF position('-' IN r)=0 THEN RETURN true; END IF;
 lp := string_to_array(substring(l FROM position('-' IN l)+1),'.');
 rp := string_to_array(substring(r FROM position('-' IN r)+1),'.');
 FOR i IN 1..least(cardinality(lp),cardinality(rp)) LOOP
  IF lp[i]=rp[i] THEN CONTINUE; END IF;
  IF lp[i] ~ '^[0-9]+$' AND rp[i] ~ '^[0-9]+$' THEN RETURN lp[i]::numeric < rp[i]::numeric; END IF;
  IF lp[i] ~ '^[0-9]+$' THEN RETURN true; END IF;
  IF rp[i] ~ '^[0-9]+$' THEN RETURN false; END IF;
  RETURN lp[i] COLLATE "C" < rp[i] COLLATE "C";
 END LOOP;
 RETURN cardinality(lp) <= cardinality(rp);
END $$;
