import { prisma } from "@/lib/prisma";
import { recordAuditLog } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";

export interface AnomalyStatus {
  isAnomaly: boolean;
  count: number;
  threshold: number;
  windowMinutes: number;
}

export interface AddressReuseAnomaly {
  stellarAddress: string;
  usageCount: number;
  userIds: string[];
}

/**
 * Evaluates whether a sudden mass address rotation anomaly has occurred
 * in the configured sliding time window.
 */
export async function checkAddressChangeAnomaly(
  windowMinutesOverride?: number,
  thresholdOverride?: number
): Promise<AnomalyStatus> {
  const windowMinutes =
    windowMinutesOverride ??
    Number(process.env.MASS_ADDRESS_CHANGE_WINDOW_MINUTES ?? 60);

  const threshold =
    thresholdOverride ??
    Number(process.env.MASS_ADDRESS_CHANGE_THRESHOLD ?? 5);

  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  try {
    const count = await prisma.addressHistoryRecord.count({
      where: {
        changeType: "address_change",
        recordedAt: { gte: windowStart },
      },
    });

    const isAnomaly = count >= threshold;
    return {
      isAnomaly,
      count,
      threshold,
      windowMinutes,
    };
  } catch (error) {
    console.error("Failed to check address change anomaly:", error);
    return {
      isAnomaly: false,
      count: 0,
      threshold,
      windowMinutes,
    };
  }
}

/**
 * Triggers anomaly evaluation when an address change occurs.
 * If the threshold is breached, an audit log event is recorded.
 * Fail open: non-blocking, returns anomaly status.
 */
export async function evaluateAndAuditAddressChangeAnomaly(
  actorId: string,
  actorLogin: string | null
): Promise<AnomalyStatus> {
  const status = await checkAddressChangeAnomaly();

  if (status.isAnomaly) {
    try {
      await recordAuditLog({
        action: "anomaly.mass_address_changes",
        actorId,
        actorLogin,
        metadata: {
          count: status.count,
          threshold: status.threshold,
          windowMinutes: status.windowMinutes,
          message: `High volume of address changes detected (${status.count} changes in ${status.windowMinutes} minutes).`,
        },
      });

      // Create maintainer notification for address change anomaly
      await createNotification({
        userId: null, // Broadcast to all maintainers
        type: "security_alert",
        title: "Mass Address Change Detected",
        body: `${status.count} address changes detected in ${status.windowMinutes} minutes (threshold: ${status.threshold}). This may indicate coordinated fraud activity.`,
        metadata: {
          count: status.count,
          threshold: status.threshold,
          windowMinutes: status.windowMinutes,
          triggeredBy: actorId,
        },
      });
    } catch (auditErr) {
      console.error("Failed to log address change anomaly audit event:", auditErr);
    }
  }

  return status;
}

/**
 * Detects wallet reuse patterns - same Stellar address claimed by multiple users.
 * Returns addresses that exceed the reuse threshold within the time window.
 */
export async function detectAddressReuseAnomaly(
  windowMinutesOverride?: number,
  thresholdOverride?: number
): Promise<AddressReuseAnomaly[]> {
  const windowMinutes =
    windowMinutesOverride ??
    Number(process.env.ADDRESS_REUSE_WINDOW_MINUTES ?? 1440); // 24 hours default

  const threshold =
    thresholdOverride ?? Number(process.env.ADDRESS_REUSE_THRESHOLD ?? 2);

  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  try {
    // Find addresses that have been registered by multiple users
    const reusedAddresses = await prisma.addressHistoryRecord.groupBy({
      by: ["stellarAddress"],
      where: {
        recordedAt: { gte: windowStart },
        changeType: "initial_registration",
      },
      having: {
        stellarAddress: {
          _count: {
            gte: threshold,
          },
        },
      },
      _count: {
        stellarAddress: true,
      },
    });

    // Get details for each reused address
    const anomalies: AddressReuseAnomaly[] = [];
    for (const reused of reusedAddresses) {
      const records = await prisma.addressHistoryRecord.findMany({
        where: {
          stellarAddress: reused.stellarAddress,
          recordedAt: { gte: windowStart },
          changeType: "initial_registration",
        },
        select: {
          userId: true,
        },
      });

      anomalies.push({
        stellarAddress: reused.stellarAddress,
        usageCount: reused._count.stellarAddress,
        userIds: records.map((r) => r.userId),
      });
    }

    return anomalies;
  } catch (error) {
    console.error("Failed to detect address reuse anomaly:", error);
    return [];
  }
}

/**
 * Detects multi-account patterns - single user registering multiple addresses.
 * Returns users who exceed the threshold within the time window.
 */
export async function detectMultiAccountAnomaly(
  windowMinutesOverride?: number,
  thresholdOverride?: number
): Promise<Array<{ userId: string; addressCount: number }>> {
  const windowMinutes =
    windowMinutesOverride ??
    Number(process.env.MULTI_ACCOUNT_WINDOW_MINUTES ?? 60); // 1 hour default

  const threshold =
    thresholdOverride ?? Number(process.env.MULTI_ACCOUNT_THRESHOLD ?? 3);

  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  try {
    const multiAccountUsers = await prisma.addressHistoryRecord.groupBy({
      by: ["userId"],
      where: {
        recordedAt: { gte: windowStart },
        changeType: {
          in: ["initial_registration", "address_change"],
        },
      },
      having: {
        userId: {
          _count: {
            gte: threshold,
          },
        },
      },
      _count: {
        userId: true,
      },
    });

    return multiAccountUsers.map((user) => ({
      userId: user.userId,
      addressCount: user._count.userId,
    }));
  } catch (error) {
    console.error("Failed to detect multi-account anomaly:", error);
    return [];
  }
}

/**
 * Comprehensive anomaly check that evaluates all patterns and creates
 * maintainer alerts for detected anomalies.
 */
export async function runAnomalyDetection(
  actorId?: string,
  actorLogin?: string | null
): Promise<{
  addressReuse: AddressReuseAnomaly[];
  multiAccount: Array<{ userId: string; addressCount: number }>;
}> {
  const [addressReuse, multiAccount] = await Promise.all([
    detectAddressReuseAnomaly(),
    detectMultiAccountAnomaly(),
  ]);

  // Create maintainer alerts for detected anomalies
  try {
    if (addressReuse.length > 0) {
      await createNotification({
        userId: null, // Broadcast to maintainers
        type: "security_alert",
        title: "Wallet Reuse Detected",
        body: `${addressReuse.length} Stellar address(es) have been registered by multiple users. This may indicate account sharing or fraud.`,
        metadata: {
          anomalyType: "address_reuse",
          affectedAddresses: addressReuse.length,
          addresses: addressReuse.map((a) => ({
            address: a.stellarAddress,
            count: a.usageCount,
          })),
        },
      });

      await recordAuditLog({
        action: "anomaly.address_reuse",
        actorId: actorId ?? "system",
        actorLogin: actorLogin ?? null,
        metadata: {
          affectedAddresses: addressReuse.length,
          details: addressReuse,
        },
      });
    }

    if (multiAccount.length > 0) {
      await createNotification({
        userId: null, // Broadcast to maintainers
        type: "security_alert",
        title: "Multi-Account Pattern Detected",
        body: `${multiAccount.length} user(s) have registered multiple addresses in a short time window. Review for potential gaming.`,
        metadata: {
          anomalyType: "multi_account",
          affectedUsers: multiAccount.length,
          users: multiAccount,
        },
      });

      await recordAuditLog({
        action: "anomaly.multi_account",
        actorId: actorId ?? "system",
        actorLogin: actorLogin ?? null,
        metadata: {
          affectedUsers: multiAccount.length,
          details: multiAccount,
        },
      });
    }
  } catch (error) {
    console.error("Failed to create anomaly alerts:", error);
  }

  return { addressReuse, multiAccount };
}
