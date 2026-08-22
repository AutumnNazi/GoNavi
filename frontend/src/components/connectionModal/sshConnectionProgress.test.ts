import { describe, expect, it } from "vitest";

import {
  applySSHConnectionProgressEvent,
  createSSHConnectionProgress,
  finishSSHConnectionProgress,
} from "./sshConnectionProgress";

describe("SSH connection progress", () => {
  it("turns backend stages into an ordered, successful tunnel timeline", () => {
    let progress = createSSHConnectionProgress({
      runId: "ssh-run-1",
      host: "bastion.example.com",
      port: 22,
    });

    for (const event of [
      { runId: "ssh-run-1", stage: "tcp_connected", status: "success" },
      { runId: "ssh-run-1", stage: "host_key_verifying", status: "running" },
      { runId: "ssh-run-1", stage: "host_key_verified", status: "success" },
      { runId: "ssh-run-1", stage: "authenticating", status: "running" },
      { runId: "ssh-run-1", stage: "authenticated", status: "success" },
      { runId: "ssh-run-1", stage: "tunnel_ready", status: "success" },
    ]) {
      progress = applySSHConnectionProgressEvent(progress, event);
    }
    progress = finishSSHConnectionProgress(progress, { success: true });

    expect(progress.status).toBe("success");
    expect(progress.steps.map((step) => [step.id, step.status])).toEqual([
      ["transport", "success"],
      ["host-key", "success"],
      ["authentication", "success"],
      ["tunnel", "success"],
      ["database", "success"],
    ]);
    expect(progress.logs).toContainEqual(
      expect.objectContaining({ stage: "host_key_verified", status: "success" }),
    );
  });

  it("ignores another connection's events and preserves a useful failure stage", () => {
    const initial = createSSHConnectionProgress({
      runId: "ssh-run-1",
      host: "bastion.example.com",
      port: 22,
    });
    const ignored = applySSHConnectionProgressEvent(initial, {
      runId: "ssh-run-2",
      stage: "tcp_connected",
      status: "success",
    });
    const failed = finishSSHConnectionProgress(ignored, {
      success: false,
      reason: "host key verification failed",
    });

    expect(ignored).toBe(initial);
    expect(failed.status).toBe("error");
    expect(failed.steps.find((step) => step.id === "host-key")?.status).toBe("error");
    expect(failed.steps.find((step) => step.id === "transport")?.status).toBe("running");
    expect(failed.logs[failed.logs.length - 1]).toEqual(
      expect.objectContaining({ stage: "failed", status: "error" }),
    );
  });
});
