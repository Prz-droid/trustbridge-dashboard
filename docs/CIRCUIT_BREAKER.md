# Circuit Breaker Integration

## Overview

Circuit breakers protect the TrustBridge dashboard from cascading failures when external services (Horizon, Soroban RPC) become unavailable. When a service fails repeatedly, the circuit breaker "opens" and fails fast for a recovery period, preventing resource exhaustion.

## Architecture

### Horizon Circuit Breaker

Located in `src/lib/horizon.ts`, wraps all Horizon API calls.

**States:**
- **CLOSED**: Normal operation, calls go through
- **OPEN**: Service unavailable, fails fast without calling Horizon
- **HALF_OPEN**: Testing recovery, allows limited requests

### Soroban Circuit Breaker

Located in `src/lib/soroban-register.ts`, wraps Soroban RPC calls for contract mirroring.

## Configuration

### Environment Variables

**Horizon:**
```bash
HORIZON_CB_FAILURE_THRESHOLD=5      # Failures before opening (default: 5)
HORIZON_CB_SUCCESS_THRESHOLD=2      # Successes to close from half-open (default: 2)
HORIZON_CB_RECOVERY_MS=30000        # Recovery timeout in ms (default: 30000)
```

**Soroban:**
```bash
SOROBAN_CB_FAILURE_THRESHOLD=5      # Failures before opening (default: 5)
SOROBAN_CB_SUCCESS_THRESHOLD=2      # Successes to close from half-open (default: 2)
SOROBAN_CB_RECOVERY_MS=30000        # Recovery timeout in ms (default: 30000)
```

## Behavior

### Opening the Circuit

When the failure threshold is reached (default: 5 consecutive failures):
1. Circuit transitions to OPEN state
2. Trip event is recorded with timestamp and failure count
3. Subsequent calls fail immediately with `CircuitBreakerOpenError`
4. No actual service calls are made

### Recovery Process

After the recovery timeout (default: 30 seconds):
1. Circuit transitions to HALF_OPEN state
2. Limited requests are allowed through to test service health
3. If success threshold is met (default: 2 successes), circuit closes
4. If any request fails, circuit reopens immediately

### Metrics

Both circuit breakers expose real-time metrics:

```typescript
interface CircuitBreakerMetrics {
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  totalTrips: number;
  recentTrips: CircuitBreakerTripEvent[];
  options: CircuitBreakerOptions;
  processLocal: boolean;
}
```

**Access metrics:**
```typescript
import { 
  getHorizonCircuitBreakerMetrics,
  getSorobanCircuitBreakerMetrics 
} from '@/lib/horizon';

const horizonMetrics = getHorizonCircuitBreakerMetrics();
const sorobanMetrics = getSorobanCircuitBreakerMetrics();
```

## UI Integration

### Degraded State Messaging

When a circuit breaker opens, the UI should display clear degraded state messages:

**Horizon Circuit Open:**
```
"Stellar network checks are temporarily unavailable. 
Your registration has been saved and will be verified shortly."
```

**Soroban Circuit Open:**
```
"Smart contract sync is temporarily unavailable. 
Your registration is saved in the database."
```

### Status Indicators

Consider adding status indicators to the dashboard:

```typescript
const horizonStatus = getHorizonCircuitBreakerState();
// Returns: "CLOSED" | "OPEN" | "HALF_OPEN"

<StatusBadge status={horizonStatus} />
```

## Error Handling

### Client-Side

The `check-api-client.ts` already handles circuit breaker errors:

```typescript
type CheckOutcome =
  | { kind: "ok"; result: HorizonCheckResult }
  | { kind: "circuit_open"; errors: string[] }
  | { kind: "rate_limited"; retryAfterSeconds: number | null }
  | { kind: "timeout" }
  | { kind: "error"; status: number; errors: string[] };
```

When `kind === "circuit_open"`, the UI should:
1. Display a degraded state message
2. Disable retry buttons temporarily
3. Show estimated recovery time
4. Offer alternative actions (e.g., "We'll notify you when ready")

### Server-Side

Circuit breaker errors are caught and converted to user-friendly responses:

```typescript
try {
  const result = await checkStellarAddress(address);
  return jsonCheckResult(result);
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    return jsonCheckError([
      "Horizon is temporarily unavailable. Please try again later."
    ], 503);
  }
  // Handle other errors...
}
```

## Monitoring

### Trip History

Each circuit breaker maintains a rolling history of the last 20 trips:

```typescript
const metrics = getHorizonCircuitBreakerMetrics();
console.log(`Total trips: ${metrics.totalTrips}`);
metrics.recentTrips.forEach(trip => {
  console.log(`Tripped at: ${new Date(trip.trippedAt)}`);
  console.log(`Failure count: ${trip.failureCountAtTrip}`);
  console.log(`Recovered at: ${trip.recoveredAt ? new Date(trip.recoveredAt) : 'Still open'}`);
});
```

### Grafana Integration

Expose circuit breaker metrics via the metrics API for monitoring:

```typescript
// In /api/metrics
export async function GET() {
  const horizon = getHorizonCircuitBreakerMetrics();
  const soroban = getSorobanCircuitBreakerMetrics();
  
  return {
    circuitBreakers: {
      horizon: {
        state: horizon.state,
        totalTrips: horizon.totalTrips,
        failureCount: horizon.failureCount,
      },
      soroban: {
        state: soroban.state,
        totalTrips: soroban.totalTrips,
        failureCount: soroban.failureCount,
      },
    },
  };
}
```

## Testing

### Unit Tests

Circuit breaker behavior is extensively tested in:
- `tests/unit/circuit-breaker.test.ts`
- `tests/unit/soroban-circuit-breaker.test.ts`

### Integration Testing

To test circuit breaker behavior:

1. **Force Horizon failures:**
   ```bash
   # Point to invalid Horizon URL
   NEXT_PUBLIC_HORIZON_URL=http://invalid.horizon.url npm run dev
   ```

2. **Observe circuit opening:**
   - Make 5+ failed check requests
   - Circuit should open
   - Subsequent requests should fail fast

3. **Test recovery:**
   - Wait 30 seconds (or configured timeout)
   - Restore valid Horizon URL
   - Make 2+ successful requests
   - Circuit should close

## Best Practices

1. **Set appropriate thresholds**: Balance between sensitivity and stability
2. **Monitor trip frequency**: High trip counts indicate upstream issues
3. **Implement retry logic**: With exponential backoff on the client
4. **Clear user communication**: Explain degraded states transparently
5. **Log circuit events**: For debugging and capacity planning

## Limitations

- Circuit breakers are process-local (no cross-instance coordination)
- State is lost on server restart
- No automatic alerting (implement via monitoring)
- Recovery timeout is fixed (no adaptive backoff)

## Related

- [PERFORMANCE_TESTING.md](./PERFORMANCE_TESTING.md)
- [SENTRY.md](./SENTRY.md)
- [LOGGING_AND_PAGINATION.md](./LOGGING_AND_PAGINATION.md)
