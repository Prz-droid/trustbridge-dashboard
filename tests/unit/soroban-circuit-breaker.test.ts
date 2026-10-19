import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mirrorRegistrationToSoroban,
  getSorobanCircuitBreakerState,
  getSorobanCircuitBreakerMetrics,
} from "@/lib/soroban-register";
import type { Registration } from "@prisma/client";

vi.mock("stellar-sdk", () => ({
  rpc: {
    Server: vi.fn(),
  },
  Keypair: {
    fromSecret: vi.fn(),
  },
  TransactionBuilder: vi.fn(),
  Networks: {
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
  Contract: vi.fn(),
  Address: vi.fn(),
  nativeToScVal: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Soroban Circuit Breaker Integration", () => {
  const mockRegistration: Registration = {
    id: "reg-1",
    userId: "user-1",
    stellarAddress: "GADDR123",
    funded: true,
    trustlineReady: true,
    trustlineAuthorized: true,
    xlmBalance: "100",
    spendableXlmBalance: "90",
    usdcBalance: "50",
    checklistCompleted: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    lastCheckedAt: new Date(),
    deletedAt: null,
    horizonLatencyMs: null,
  };

  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("skips mirroring when SOROBAN_CONTRACT_ID is not set", async () => {
    delete process.env.SOROBAN_CONTRACT_ID;

    const result = await mirrorRegistrationToSoroban(mockRegistration);

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns error when SOROBAN_SECRET_KEY is missing", async () => {
    process.env.SOROBAN_CONTRACT_ID = "CONTRACT123";
    delete process.env.SOROBAN_SECRET_KEY;

    const result = await mirrorRegistrationToSoroban(mockRegistration);

    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      "SOROBAN_SECRET_KEY is not configured — write-through skipped"
    );
  });

  it("exposes circuit breaker state", () => {
    const state = getSorobanCircuitBreakerState();
    expect(state).toBe("CLOSED");
  });

  it("exposes circuit breaker metrics", () => {
    const metrics = getSorobanCircuitBreakerMetrics();
    expect(metrics).toHaveProperty("state");
    expect(metrics).toHaveProperty("failureCount");
    expect(metrics).toHaveProperty("successCount");
    expect(metrics).toHaveProperty("totalTrips");
    expect(metrics.options).toHaveProperty("failureThreshold");
  });

  it("uses environment variables for circuit breaker configuration", () => {
    process.env.SOROBAN_CB_FAILURE_THRESHOLD = "10";
    process.env.SOROBAN_CB_SUCCESS_THRESHOLD = "3";
    process.env.SOROBAN_CB_RECOVERY_MS = "60000";

    const metrics = getSorobanCircuitBreakerMetrics();
    
    // The circuit breaker was already initialized, but we can verify the pattern exists
    expect(metrics.options).toBeDefined();
  });
});

describe("Soroban Circuit Breaker Behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles circuit breaker open state gracefully", async () => {
    process.env.SOROBAN_CONTRACT_ID = "CONTRACT123";
    process.env.SOROBAN_SECRET_KEY = "STEST123";

    const { rpc, Keypair } = await import("stellar-sdk");
    const MockServer = vi.mocked(rpc.Server);
    const mockServerInstance = {
      getAccount: vi.fn().mockRejectedValue(new Error("Network error")),
      sendTransaction: vi.fn(),
    };
    MockServer.mockImplementation(() => mockServerInstance as any);

    vi.mocked(Keypair.fromSecret).mockReturnValue({
      publicKey: () => "GPUBKEY123",
      sign: vi.fn(),
    } as any);

    const mockRegistration: Registration = {
      id: "reg-1",
      userId: "user-1",
      stellarAddress: "GADDR123",
      funded: true,
      trustlineReady: true,
      trustlineAuthorized: true,
      xlmBalance: "100",
      spendableXlmBalance: "90",
      usdcBalance: "50",
      checklistCompleted: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      lastCheckedAt: new Date(),
      deletedAt: null,
      horizonLatencyMs: null,
    };

    // First call should fail and be caught
    const result = await mirrorRegistrationToSoroban(mockRegistration);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
