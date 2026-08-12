#!/usr/bin/env python3

from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class DownloadMirrorConfigTest(unittest.TestCase):
    def test_dmit_uses_local_caddy_without_replacing_other_hosts(self) -> None:
        snippet = (ROOT / "deploy/download-mirror/dmit-caddy-site.caddy").read_text(encoding="utf-8")
        installer = (ROOT / "deploy/download-mirror/install-edge.sh").read_text(encoding="utf-8")

        self.assertIn("download.syngnat.top", snippet)
        self.assertIn("root * /srv/gonavi-downloads", snippet)
        self.assertIn("file_server", snippet)
        self.assertNotIn("reverse_proxy", snippet)
        self.assertFalse((ROOT / "deploy/download-mirror/dmit-nginx.conf").exists())
        self.assertIn("DMIT must retain its existing Caddy listener", installer)
        self.assertIn("caddy validate", installer)
        self.assertIn("/usr/local/libexec/gonavi-edge-transaction", installer)
        self.assertIn("NOPASSWD: GONAVI_EDGE_CONTROL", installer)

    def test_publication_uses_per_node_budgets_and_observability_only_throughput(self) -> None:
        action = (ROOT / ".github/actions/publish-vps-mirror/action.yml").read_text(encoding="utf-8")
        publication = (ROOT / "tools/publish-edge-release.sh").read_text(encoding="utf-8")

        self.assertIn("dmit-max-bytes", action)
        self.assertIn("default: '9000000000'", action)
        self.assertIn("tencent-max-bytes", action)
        self.assertIn("default: '45000000000'", action)
        self.assertIn("PUB_THROUGHPUT_WARN_MBPS", publication)
        self.assertIn("::warning::Edge {node} throughput", publication)
        self.assertNotIn("PUB_MIN_THROUGHPUT_MBPS", publication)
        self.assertIn("--min-free-bytes", publication)

    def test_publication_commits_control_to_kv_without_object_storage(self) -> None:
        action = (ROOT / ".github/actions/publish-vps-mirror/action.yml").read_text(encoding="utf-8")
        publication = (ROOT / "tools/publish-edge-release.sh").read_text(encoding="utf-8")
        dispatcher = (ROOT / "deploy/download-dispatcher/src/core.ts").read_text(encoding="utf-8")
        stable_workflow = (ROOT / ".github/workflows/publish-release.yml").read_text(encoding="utf-8")
        dev_workflow = (ROOT / ".github/workflows/dev-build.yml").read_text(encoding="utf-8")

        combined = "\n".join((action, publication, dispatcher, stable_workflow, dev_workflow)).lower()
        self.assertNotIn("r2", combined)
        self.assertIn("PUB_ROUTING_STATE_KV_ID", publication)
        self.assertIn('encoded_key="${key//:/%3A}"', publication)
        self.assertIn('put_kv_control "control:history:', publication)
        self.assertIn('put_kv_control "control:${PUB_CHANNEL}"', publication)
        self.assertIn('env.ROUTING_STATE.get(`control:${channel}`', dispatcher)
        self.assertEqual(stable_workflow.count("group: gonavi-download-publication"), 1)
        self.assertEqual(dev_workflow.count("group: gonavi-download-publication"), 1)

    def test_dispatcher_cron_stays_within_free_kv_write_budget(self) -> None:
        config = json.loads((ROOT / "deploy/download-dispatcher/wrangler.jsonc").read_text(encoding="utf-8"))
        dispatcher = (ROOT / "deploy/download-dispatcher/src/core.ts").read_text(encoding="utf-8")

        self.assertEqual(
            config["routes"],
            [{"pattern": "download-dispatch.syngnat.top", "custom_domain": True}],
        )
        self.assertEqual(config["triggers"]["crons"], ["*/5 * * * *"])
        interval_minutes = 5
        channel_count = 2
        daily_routing_writes = 24 * 60 // interval_minutes * channel_count
        self.assertEqual(daily_routing_writes, 576)
        self.assertLess(daily_routing_writes, 1_000)
        self.assertIn("ROUTING_STATE_MAX_AGE_MS = 12 * 60 * 1000", dispatcher)
        self.assertIn("SUCCESS_THRESHOLD = 2", dispatcher)
        self.assertIn("FAILURE_THRESHOLD = 3", dispatcher)


if __name__ == "__main__":
    unittest.main()
