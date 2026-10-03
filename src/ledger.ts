import { nodeFs, type Fs } from "./io.ts";
import {
  appendRecord as appendRecordWith,
  readLedger as readLedgerWith,
  type LedgerRecord,
  type ReadResult,
} from "./ledger-core.ts";

export {
  classifyRecords,
  describeDegraded,
  type Degraded,
  type LedgerRecord,
  type ObservedCall,
  type ReadResult,
} from "./ledger-core.ts";

export function readLedger(path: string, fs: Fs = nodeFs): ReadResult {
  return readLedgerWith(path, fs);
}

export function appendRecord(path: string, record: LedgerRecord, fs: Fs = nodeFs): void {
  appendRecordWith(path, record, fs);
}
