import { describe, expect, it, beforeEach } from "vitest";

import {
  batchVerify,
  calculateVerificationSummary,
  filterByStatus,
  sortByReadiness,
  getBatchVerificationState,
  type VerificationCheckResult,
  type BatchVerificationProgress,
} from "@/lib/batch-verify";

function result(
  status: VerificationCheckResult["status"],
  username: string = status
): VerificationCheckResult {
  return {
    username,
    stellar_address: `G_${username}`,
    status,
    checks: { funded: true, trustline: true, reserve: true },
  };
}

describe("calculateVerificationSummary", () => {
  it("aggregates counts and percentages", () => {
    const summary = calculateVerificationSummary([
      result("ready"),
      result("ready"),
      result("low_reserve"),
      result("error"),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.ready).toBe(2);
    expect(summary.readyPercentage).toBe(50);
    expect(summary.succeededPercentage).toBe(75);
  });

  it("avoids divide-by-zero for empty input", () => {
    expect(calculateVerificationSummary([]).readyPercentage).toBe(0);
  });
});

describe("sortByReadiness / filterByStatus", () => {
  it("orders ready first and errors last", () => {
    const sorted = sortByReadiness([
      result("error"),
      result("ready"),
      result("not_ready"),
    ]);
    expect(sorted.map((r) => r.status)).toEqual([
      "ready",
      "not_ready",
      "error",
    ]);
  });

  it("filters by a single status", () => {
    const filtered = filterByStatus(
      [result("ready"), result("error")],
      "error"
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].status).toBe("error");
  });
});

describe("batchVerify", () => {
  it("runs all verifications and captures thrown errors", async () => {
    const results = await batchVerify(
      [
        { username: "a", stellar_address: "G_a" },
        { username: "b", stellar_address: "G_b" },
      ],
      async (address) => {
        if (address === "G_b") throw new Error("horizon down");
        return result("ready", "a");
      },
      { concurrency: 2 }
    );

    expect(results).toHaveLength(2);
    const b = results.find((r) => r.username === "b");
    expect(b?.status).toBe("error");
    expect(b?.error_message).toBe("horizon down");
  });

  describe("progress persistence across SSE disconnects", () => {
    it("initializes job state with jobId", async () => {
      const jobId = "test-job-1";
      const progressUpdates: BatchVerificationProgress[] = [];

      const results = await batchVerify(
        [
          { username: "user1", stellar_address: "G_user1" },
          { username: "user2", stellar_address: "G_user2" },
        ],
        async () => result("ready"),
        {
          jobId,
          onProgress: (progress) => progressUpdates.push(progress),
        }
      );

      expect(results).toHaveLength(2);
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[0].jobId).toBe(jobId);
      expect(progressUpdates[progressUpdates.length - 1].isComplete).toBe(true);
    });

    it("resumes job from existing state", async () => {
      const jobId = "test-job-2";

      // First batch - partial completion
      const firstBatch = await batchVerify(
        [
          { username: "user1", stellar_address: "G_user1" },
          { username: "user2", stellar_address: "G_user2" },
        ],
        async () => result("ready"),
        { jobId }
      );

      expect(firstBatch).toHaveLength(2);

      // Get current state
      const state = getBatchVerificationState(jobId);
      expect(state).not.toBeNull();
      expect(state!.completed).toBe(2);
      expect(state!.isComplete).toBe(true);

      // Resume with same jobId - should skip already processed
      const secondBatch = await batchVerify(
        [
          { username: "user1", stellar_address: "G_user1" }, // already processed
          { username: "user3", stellar_address: "G_user3" }, // new
        ],
        async () => result("ready", "user3"),
        { jobId }
      );

      // Should only process the new item
      const finalState = getBatchVerificationState(jobId);
      expect(finalState!.completed).toBe(3); // 2 from first + 1 from second
    });

    it("reports accurate progress during execution", async () => {
      const jobId = "test-job-3";
      const progressUpdates: BatchVerificationProgress[] = [];

      await batchVerify(
        [
          { username: "user1", stellar_address: "G_user1" },
          { username: "user2", stellar_address: "G_user2" },
          { username: "user3", stellar_address: "G_user3" },
        ],
        async () => result("ready"),
        {
          jobId,
          concurrency: 1, // Sequential for predictable progress
          onProgress: (progress) => progressUpdates.push(progress),
        }
      );

      expect(progressUpdates.length).toBe(3);
      expect(progressUpdates[0].completed).toBe(1);
      expect(progressUpdates[0].percentage).toBeGreaterThan(0);
      expect(progressUpdates[1].completed).toBe(2);
      expect(progressUpdates[2].completed).toBe(3);
      expect(progressUpdates[2].isComplete).toBe(true);
      expect(progressUpdates[2].percentage).toBe(100);
    });

    it("tracks succeeded and failed counts separately", async () => {
      const jobId = "test-job-4";
      let lastProgress: BatchVerificationProgress | null = null;

      await batchVerify(
        [
          { username: "user1", stellar_address: "G_user1" },
          { username: "user2", stellar_address: "G_user2" },
          { username: "user3", stellar_address: "G_user3" },
        ],
        async (address) => {
          if (address === "G_user2") throw new Error("failed");
          return result("ready");
        },
        {
          jobId,
          onProgress: (progress) => {
            lastProgress = progress;
          },
        }
      );

      expect(lastProgress).not.toBeNull();
      expect(lastProgress!.succeeded).toBe(2);
      expect(lastProgress!.failed).toBe(1);
      expect(lastProgress!.total).toBe(3);
    });

    it("returns null for non-existent job", () => {
      const state = getBatchVerificationState("non-existent-job");
      expect(state).toBeNull();
    });
  });
});
