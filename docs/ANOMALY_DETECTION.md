# Address Anomaly Detection

## Overview

The anomaly detection system identifies suspicious patterns in contributor registration behavior, including mass address changes, wallet reuse, and multi-account gaming. When anomalies are detected, maintainers receive real-time alerts via in-app notifications.

## Detection Types

### 1. Mass Address Changes

Detects sudden spikes in address updates across all contributors.

**Use Case**: Identifies coordinated fraud attempts where multiple actors simultaneously change their Stellar addresses.

**Thresholds:**
```bash
MASS_ADDRESS_CHANGE_THRESHOLD=5           # Number of changes (default: 5)
MASS_ADDRESS_CHANGE_WINDOW_MINUTES=60    # Time window in minutes (default: 60)
```

**Trigger**: When ≥5 address changes occur within 60 minutes.

**Alert**: 
- **Title**: "Mass Address Change Detected"
- **Body**: "X address changes detected in Y minutes (threshold: Z). This may indicate coordinated fraud activity."
- **Type**: `security_alert`
- **Audience**: All maintainers (broadcast)

### 2. Address Reuse

Detects the same Stellar address being registered by multiple users.

**Use Case**: Identifies account sharing, wallet reuse, or attempts to claim rewards multiple times with the same wallet.

**Thresholds:**
```bash
ADDRESS_REUSE_THRESHOLD=2                 # Min users per address (default: 2)
ADDRESS_REUSE_WINDOW_MINUTES=1440         # Time window in minutes (default: 24 hours)
```

**Trigger**: When ≥2 users register the same Stellar address within 24 hours.

**Alert**:
- **Title**: "Wallet Reuse Detected"
- **Body**: "X Stellar address(es) have been registered by multiple users. This may indicate account sharing or fraud."
- **Type**: `security_alert`
- **Audience**: All maintainers
- **Metadata**: List of affected addresses with usage counts

### 3. Multi-Account Pattern

Detects single users registering multiple addresses in a short time window.

**Use Case**: Identifies contributors attempting to game the system by creating multiple accounts.

**Thresholds:**
```bash
MULTI_ACCOUNT_THRESHOLD=3                 # Min addresses per user (default: 3)
MULTI_ACCOUNT_WINDOW_MINUTES=60          # Time window in minutes (default: 60)
```

**Trigger**: When a single user registers ≥3 addresses within 60 minutes.

**Alert**:
- **Title**: "Multi-Account Pattern Detected"
- **Body**: "X user(s) have registered multiple addresses in a short time window. Review for potential gaming."
- **Type**: `security_alert`
- **Audience**: All maintainers
- **Metadata**: List of affected users with address counts

## API

### Individual Detection Functions

```typescript
// Check for mass address changes
const status = await checkAddressChangeAnomaly(
  windowMinutes?: number,
  threshold?: number
): Promise<AnomalyStatus>

// Detect address reuse
const anomalies = await detectAddressReuseAnomaly(
  windowMinutes?: number,
  threshold?: number
): Promise<AddressReuseAnomaly[]>

// Detect multi-account patterns
const users = await detectMultiAccountAnomaly(
  windowMinutes?: number,
  threshold?: number
): Promise<Array<{ userId: string; addressCount: number }>>
```

### Comprehensive Detection

```typescript
// Run all detection types and create alerts
const result = await runAnomalyDetection(
  actorId?: string,
  actorLogin?: string | null
): Promise<{
  addressReuse: AddressReuseAnomaly[];
  multiAccount: Array<{ userId: string; addressCount: number }>;
}>
```

### Automatic Evaluation

The system automatically evaluates anomalies when address changes occur:

```typescript
// Triggered by address change events
await evaluateAndAuditAddressChangeAnomaly(
  actorId: string,
  actorLogin: string | null
)
```

## Data Structures

```typescript
interface AnomalyStatus {
  isAnomaly: boolean;
  count: number;
  threshold: number;
  windowMinutes: number;
}

interface AddressReuseAnomaly {
  stellarAddress: string;
  usageCount: number;
  userIds: string[];
}
```

## Integration Points

### 1. Registration API (`/api/register`)

Address anomaly evaluation is triggered automatically on address changes:

```typescript
if (isAddressChange) {
  // Record the change
  await recordAddressChange(userId, oldAddress, newAddress);
  
  // Check for anomalies (non-blocking)
  void evaluateAndAuditAddressChangeAnomaly(
    userId,
    githubUsername
  ).catch(err => console.error("Anomaly evaluation error:", err));
}
```

### 2. Scheduled Jobs

Run comprehensive anomaly detection periodically:

```typescript
// In a cron job or queue worker
export async function detectAnomaliesJob() {
  const results = await runAnomalyDetection("system", null);
  
  console.log(`Found ${results.addressReuse.length} address reuse anomalies`);
  console.log(`Found ${results.multiAccount.length} multi-account anomalies`);
  
  return results;
}
```

### 3. Maintainer Dashboard

Display anomaly alerts in the notifications feed:

```typescript
// Maintainers see security alerts in their notification panel
const notifications = await getNotificationsForUser(
  userId,
  isMaintainer: true,
  { unreadOnly: true }
);

const securityAlerts = notifications.filter(
  n => n.type === 'security_alert'
);
```

## Audit Trail

All detected anomalies are logged to the audit table:

```typescript
// Audit log actions
- "anomaly.mass_address_changes"
- "anomaly.address_reuse"
- "anomaly.multi_account"
```

**Metadata includes:**
- Threshold values used
- Count of affected entities
- Detailed list of affected users/addresses
- Timestamp of detection

## Maintainer Workflow

### 1. Receive Alert

Maintainers receive in-app notifications for detected anomalies.

### 2. Review Details

Click notification to view:
- Type of anomaly
- Affected users/addresses
- Count and threshold that triggered the alert
- Timestamp

### 3. Investigate

Use the provided information to:
- Review user profiles
- Check transaction history
- Examine address history records
- Correlate with other audit logs

### 4. Take Action

Based on investigation:
- **Ban users**: Use the ban service for confirmed fraud
- **Flag registrations**: Mark for manual review
- **Adjust thresholds**: If getting too many false positives
- **Contact users**: Request clarification for legitimate cases

## Testing

### Unit Tests

Located in `src/lib/address-anomaly.test.ts`:

```typescript
// Test threshold detection
it("returns isAnomaly: true when count reaches threshold")

// Test notification creation
it("creates maintainer notification when anomaly detected")

// Test address reuse detection
it("detects addresses registered by multiple users")

// Test multi-account detection
it("detects users with multiple address registrations")

// Test comprehensive detection
it("runs all detection types and creates alerts")
```

### Manual Testing

**Test Mass Address Changes:**
```bash
# Change 5+ addresses within 60 minutes
# Should trigger mass change alert
```

**Test Address Reuse:**
```bash
# Register same address with 2+ different user accounts
# Should trigger reuse alert
```

**Test Multi-Account:**
```bash
# Register 3+ addresses with same user in 60 minutes
# Should trigger multi-account alert
```

## Threshold Tuning

### Recommended Starting Values

```bash
# Mass changes - alert on coordinated activity
MASS_ADDRESS_CHANGE_THRESHOLD=5
MASS_ADDRESS_CHANGE_WINDOW_MINUTES=60

# Address reuse - strict enforcement
ADDRESS_REUSE_THRESHOLD=2
ADDRESS_REUSE_WINDOW_MINUTES=1440

# Multi-account - allow some flexibility
MULTI_ACCOUNT_THRESHOLD=3
MULTI_ACCOUNT_WINDOW_MINUTES=60
```

### Tuning Guidelines

1. **Start conservative**: Low thresholds catch more anomalies but may have false positives
2. **Monitor alert volume**: If too many alerts, increase thresholds
3. **Track false positives**: Adjust based on investigation outcomes
4. **Consider Wave timing**: Tighten thresholds before payouts
5. **Document changes**: Log threshold adjustments in audit trail

## Error Handling

All anomaly detection is **fail-open**:

- Database errors return empty results
- Notification failures don't block operations
- Audit log failures are logged but don't throw
- Individual detection failures don't stop comprehensive scan

This ensures anomaly detection never blocks legitimate user operations.

## Performance Considerations

### Database Queries

- Uses efficient groupBy aggregations
- Indexes on `recordedAt` and `changeType` columns recommended
- Time window queries use range filters for performance

### Non-Blocking

- Anomaly evaluation is fire-and-forget
- Never blocks registration API responses
- Runs asynchronously with proper error handling

### Caching

- No caching implemented (real-time detection)
- Consider caching for scheduled bulk scans
- Alert deduplication prevents notification spam

## Monitoring

### Grafana Dashboards

Track anomaly detection metrics:

```json
{
  "anomaly_detections_total": counter,
  "anomaly_alerts_sent": counter,
  "address_reuse_incidents": gauge,
  "multi_account_incidents": gauge,
  "mass_change_incidents": gauge
}
```

### Sentry Integration

Errors in anomaly detection are captured but don't block operations:

```typescript
try {
  await createNotification({ ... });
} catch (error) {
  console.error("Failed to create anomaly alerts:", error);
  // Logged to Sentry if configured
}
```

## Related

- [BAN_SERVICE.md](./BAN_SERVICE.md) - For taking action on confirmed fraud
- [LOGGING_AND_PAGINATION.md](./LOGGING_AND_PAGINATION.md) - Audit trail access
- [docs/MAINTAINER_WORKFLOW.md](./MAINTAINER_WORKFLOW.md) - Investigation procedures
