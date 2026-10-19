import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkAddressChangeAnomaly,
  evaluateAndAuditAddressChangeAnomaly,
  detectAddressReuseAnomaly,
  detectMultiAccountAnomaly,
  runAnomalyDetection,
} from "./address-anomaly";
import { prisma } from "@/lib/prisma";
import { recordAuditLog } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    addressHistoryRecord: {
      count: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  recordAuditLog: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}));

describe("Address Change Anomaly Detector", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns isAnomaly: false when count is below threshold", async () => {
    process.env.MASS_ADDRESS_CHANGE_THRESHOLD = "5";
    process.env.MASS_ADDRESS_CHANGE_WINDOW_MINUTES = "60";

    vi.mocked(prisma.addressHistoryRecord.count).mockResolvedValue(2);

    const status = await checkAddressChangeAnomaly();
    expect(status.isAnomaly).toBe(false);
    expect(status.count).toBe(2);
    expect(status.threshold).toBe(5);
    expect(status.windowMinutes).toBe(60);
  });

  it("returns isAnomaly: true when count reaches or exceeds threshold", async () => {
    process.env.MASS_ADDRESS_CHANGE_THRESHOLD = "5";
    process.env.MASS_ADDRESS_CHANGE_WINDOW_MINUTES = "60";

    vi.mocked(prisma.addressHistoryRecord.count).mockResolvedValue(7);

    const status = await checkAddressChangeAnomaly();
    expect(status.isAnomaly).toBe(true);
    expect(status.count).toBe(7);
  });

  it("evaluates and logs audit event when threshold is breached", async () => {
    process.env.MASS_ADDRESS_CHANGE_THRESHOLD = "3";
    vi.mocked(prisma.addressHistoryRecord.count).mockResolvedValue(4);

    const status = await evaluateAndAuditAddressChangeAnomaly("user-1", "admin1");

    expect(status.isAnomaly).toBe(true);
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "anomaly.mass_address_changes",
        actorId: "user-1",
        actorLogin: "admin1",
      })
    );
  });

  it("creates maintainer notification when anomaly detected", async () => {
    process.env.MASS_ADDRESS_CHANGE_THRESHOLD = "3";
    vi.mocked(prisma.addressHistoryRecord.count).mockResolvedValue(5);

    await evaluateAndAuditAddressChangeAnomaly("user-1", "admin1");

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        type: "security_alert",
        title: "Mass Address Change Detected",
      })
    );
  });
});

describe("Address Reuse Anomaly Detector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects addresses registered by multiple users", async () => {
    const mockGroupBy = [
      {
        stellarAddress: "GADDR1",
        _count: { stellarAddress: 3 },
      },
      {
        stellarAddress: "GADDR2",
        _count: { stellarAddress: 2 },
      },
    ];

    vi.mocked(prisma.addressHistoryRecord.groupBy).mockResolvedValue(
      mockGroupBy as any
    );

    vi.mocked(prisma.addressHistoryRecord.findMany)
      .mockResolvedValueOnce([
        { userId: "user1" },
        { userId: "user2" },
        { userId: "user3" },
      ] as any)
      .mockResolvedValueOnce([{ userId: "user4" }, { userId: "user5" }] as any);

    const anomalies = await detectAddressReuseAnomaly();

    expect(anomalies).toHaveLength(2);
    expect(anomalies[0].stellarAddress).toBe("GADDR1");
    expect(anomalies[0].usageCount).toBe(3);
    expect(anomalies[0].userIds).toEqual(["user1", "user2", "user3"]);
  });

  it("uses configured thresholds", async () => {
    vi.mocked(prisma.addressHistoryRecord.groupBy).mockResolvedValue([]);

    await detectAddressReuseAnomaly(120, 5);

    expect(prisma.addressHistoryRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        having: {
          stellarAddress: {
            _count: {
              gte: 5,
            },
          },
        },
      })
    );
  });

  it("returns empty array on database error", async () => {
    vi.mocked(prisma.addressHistoryRecord.groupBy).mockRejectedValue(
      new Error("DB error")
    );

    const anomalies = await detectAddressReuseAnomaly();
    expect(anomalies).toEqual([]);
  });
});

describe("Multi-Account Anomaly Detector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects users with multiple address registrations", async () => {
    const mockGroupBy = [
      {
        userId: "user1",
        _count: { userId: 4 },
      },
      {
        userId: "user2",
        _count: { userId: 3 },
      },
    ];

    vi.mocked(prisma.addressHistoryRecord.groupBy).mockResolvedValue(
      mockGroupBy as any
    );

    const anomalies = await detectMultiAccountAnomaly();

    expect(anomalies).toHaveLength(2);
    expect(anomalies[0].userId).toBe("user1");
    expect(anomalies[0].addressCount).toBe(4);
  });

  it("uses environment variable thresholds", async () => {
    process.env.MULTI_ACCOUNT_THRESHOLD = "5";
    process.env.MULTI_ACCOUNT_WINDOW_MINUTES = "120";

    vi.mocked(prisma.addressHistoryRecord.groupBy).mockResolvedValue([]);

    await detectMultiAccountAnomaly();

    expect(prisma.addressHistoryRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        having: {
          userId: {
            _count: {
              gte: 5,
            },
          },
        },
      })
    );
  });
});

describe("Comprehensive Anomaly Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs all detection types and creates alerts", async () => {
    // Mock address reuse
    vi.mocked(prisma.addressHistoryRecord.groupBy)
      .mockResolvedValueOnce([
        {
          stellarAddress: "GADDR1",
          _count: { stellarAddress: 2 },
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          userId: "user1",
          _count: { userId: 3 },
        },
      ] as any);

    vi.mocked(prisma.addressHistoryRecord.findMany).mockResolvedValue([
      { userId: "user1" },
      { userId: "user2" },
    ] as any);

    const result = await runAnomalyDetection("system", null);

    expect(result.addressReuse).toHaveLength(1);
    expect(result.multiAccount).toHaveLength(1);

    // Should create notifications for both
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(recordAuditLog).toHaveBeenCalledTimes(2);

    // Verify notification for address reuse
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Wallet Reuse Detected",
        type: "security_alert",
      })
    );

    // Verify notification for multi-account
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Multi-Account Pattern Detected",
        type: "security_alert",
      })
    );
  });

  it("handles errors gracefully and continues", async () => {
    vi.mocked(prisma.addressHistoryRecord.groupBy).mockResolvedValue([
      {
        stellarAddress: "GADDR1",
        _count: { stellarAddress: 2 },
      },
    ] as any);

    vi.mocked(prisma.addressHistoryRecord.findMany).mockResolvedValue([
      { userId: "user1" },
      { userId: "user2" },
    ] as any);

    vi.mocked(createNotification).mockRejectedValueOnce(
      new Error("Notification failed")
    );

    // Should not throw
    const result = await runAnomalyDetection();

    expect(result.addressReuse).toHaveLength(1);
  });
});
