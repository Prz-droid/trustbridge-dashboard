# Batch Verification Progress Persistence

## Overview

The batch verification system now supports progress persistence across Server-Sent Events (SSE) disconnects, enabling reliable large-scale Wave rechecks without losing progress.

## Features

### Progress Tracking

- **Job IDs**: Each batch verification job is assigned a unique identifier
- **State Persistence**: Progress is maintained in-memory for the lifetime of the server process
- **Resumability**: Jobs can resume from where they left off after SSE disconnects
- **Real-time Updates**: Progress callbacks provide live status updates

### API

#### `batchVerify(verifications, verifyFn, options)`

**Options:**
```typescript
interface BatchVerificationOptions {
  concurrency?: number;        // Max concurrent requests (default: 5)
  timeout?: number;             // Timeout per verification in ms (default: 10000)
  skipVerified?: boolean;       // Skip already verified accounts
  minXlmReserve?: number;       // Minimum XLM reserve requirement
  jobId?: string;               // Job ID for progress tracking
  onProgress?: (progress: BatchVerificationProgress) => void;
}
```

**Progress Object:**
```typescript
interface BatchVerificationProgress {
  jobId: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  percentage: number;
  startedAt: Date;
  lastUpdatedAt: Date;
  isComplete: boolean;
}
```

#### `getBatchVerificationState(jobId)`

Retrieves the current state of a batch verification job.

**Returns:**
```typescript
interface BatchVerificationState {
  jobId: string;
  total: number;
  completed: number;
  results: VerificationCheckResult[];
  startedAt: Date;
  lastUpdatedAt: Date;
  isComplete: boolean;
} | null
```

## Usage Example

```typescript
import { batchVerify, getBatchVerificationState } from '@/lib/batch-verify';

// Start a batch verification with progress tracking
const jobId = `batch-${Date.now()}`;
const results = await batchVerify(
  contributors.map(c => ({
    username: c.githubUsername,
    stellar_address: c.stellarAddress,
  })),
  async (address) => await checkStellarAddress(address),
  {
    jobId,
    concurrency: 10,
    onProgress: (progress) => {
      console.log(`Progress: ${progress.percentage}%`);
      console.log(`Completed: ${progress.completed}/${progress.total}`);
      console.log(`Succeeded: ${progress.succeeded}, Failed: ${progress.failed}`);
    },
  }
);

// Later, check job status after SSE reconnect
const state = getBatchVerificationState(jobId);
if (state && !state.isComplete) {
  // Resume from where we left off
  const remaining = contributors.filter(
    c => !state.results.find(r => r.stellar_address === c.stellarAddress)
  );
  // Continue with remaining...
}
```

## Implementation Details

### State Storage

- Jobs are stored in an in-memory `Map<string, BatchVerificationState>`
- Completed jobs are automatically cleaned up after 5 minutes
- State persists across SSE disconnects but not server restarts

### Resumption Logic

When a job with an existing `jobId` is started:
1. The system checks for existing state
2. Previously processed addresses are filtered out
3. Only remaining addresses are verified
4. Results are appended to the existing state

### Error Handling

- Individual verification failures are captured as error results
- The batch continues processing remaining items
- Progress tracking includes separate counts for succeeded and failed verifications

## Best Practices

1. **Generate Unique Job IDs**: Use timestamp or UUID-based IDs
2. **Handle Progress Callbacks**: Update UI in real-time for better UX
3. **Check State on Reconnect**: Resume jobs after SSE disconnects
4. **Set Appropriate Concurrency**: Balance speed vs. server load (5-10 recommended)
5. **Implement Timeouts**: Prevent hanging on stuck verifications

## Limitations

- State is process-local (lost on server restart)
- No cross-process synchronization (use single instance or external state store)
- Maximum retention of 5 minutes for completed jobs
- No persistence to database (by design for performance)

## Environment Variables

None required. All configuration is done via the options parameter.

## Related

- [LOGGING_AND_PAGINATION.md](./LOGGING_AND_PAGINATION.md)
- [PERFORMANCE_TESTING.md](./PERFORMANCE_TESTING.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
