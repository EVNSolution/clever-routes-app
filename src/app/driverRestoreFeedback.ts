import { BoundedOperationTimeoutError } from '../domain/async/boundedAsyncOperation';
import type { DriverDiagnosticReasonCode, DriverDiagnosticStage } from '../domain/diagnostics/driverDiagnosticContract';
import { classifyDriverDiagnosticError } from '../domain/diagnostics/driverDiagnosticObservation';
import type { DriverDiagnosticReportStatus } from '../domain/diagnostics/driverDiagnosticOutbox';
import { DriverAuthRefreshPendingError } from '../domain/driverAuth/driverAuth';

export function getDriverReportFeedback(status: DriverDiagnosticReportStatus | null): string {
  if (status === null) return 'Reporting is unavailable right now. Try again, or contact your dispatcher if you cannot continue.';
  switch (status.state) {
    case 'SAVING': return 'Saving your report…';
    case 'QUEUED': return 'Report saved on this device. Sending will retry automatically.';
    case 'ACKNOWLEDGED': return 'Report received by the server. Keep this number for support. Contact your dispatcher if you cannot continue.';
    case 'FAILED': return status.failure === 'PERMANENT_REJECTION'
      ? 'The report was not accepted by the server. Contact your dispatcher if you cannot continue.'
      : status.failure === 'ACCOUNT_CHANGED'
        ? 'Your session changed. Report again from the current session.'
        : status.failure === 'LOCAL_RETENTION'
          ? 'The pending report is no longer stored on this device. Report again.'
          : 'Could not confirm that the report was saved on this device. Try reporting again.';
  }
}

export function getDriverRestoreFeedback(
  phase: 'LOAD' | 'REFRESH' | 'SAVE',
  error: unknown,
  stillPending = false,
): {
  blocker: { httpStatus?: number; reasonCode: DriverDiagnosticReasonCode; stage: DriverDiagnosticStage };
  message: string;
} {
  const pending = stillPending || error instanceof DriverAuthRefreshPendingError;
  const timeout = pending || error instanceof BoundedOperationTimeoutError;
  const blocker = phase === 'REFRESH'
    ? { ...classifyDriverDiagnosticError(error), ...(timeout ? { reasonCode: 'AUTH_REFRESH_TIMEOUT' as const } : {}), stage: 'AUTH' as const }
    : { reasonCode: timeout ? 'STORAGE_OPERATION_TIMEOUT' as const : phase === 'LOAD' ? 'STORAGE_READ_FAILED' as const : 'STORAGE_WRITE_FAILED' as const, stage: 'STORAGE' as const };
  const message = pending
    ? 'The device is still finishing a session operation. Wait a moment and try again. If this continues, report the issue and restart the app.'
    : phase === 'LOAD'
      ? 'Could not read your saved session. Try again, or report the issue if this continues.'
      : phase === 'SAVE'
        ? 'Could not save the session update. Try again, or report the issue if this continues.'
        : 'Could not verify your session. Check Wi-Fi or mobile data and try again. You can also report this issue.';
  return { blocker, message };
}
