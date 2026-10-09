import { digest } from '@openslate/core';
import type { Attempt } from './engine.js';

/** Local output-processing observation only. It never grants a retry or changes attempt state. */
export interface AttemptIngestionIssue {
  id: string; version: 1; projectId: string; attemptId: string;
  nodeId: string; candidateId: string | null; requestDigest: string;
  source: 'local_ingestion'; code: string; message: string;
  active: boolean; observedAt: string; resolvedAt: string | null;
}
export const INGESTION_ISSUE_MESSAGE = 'The returned output is saved, but local processing needs attention. Continue the existing job after correcting the local issue.';
export function sanitizedIngestionIssueCode(code: string): string {
  return /^(?:AUDIO|MEDIA|OUTPUT)_[A-Z0-9_]{1,72}$/.test(code) ? code : 'OUTPUT_INGESTION_FAILED';
}
export function reportableIngestionIssue(code: string): boolean {
  return !['MEDIA_BUSY', 'OUTPUT_STORE_BUSY', 'RESTORED_AUTHORITY_REQUIRES_NEW', 'INSTALLATION_QUARANTINED', 'SCOPE_DENIED', 'ACTOR_DENIED',
    'EPOCH_REVOKED', 'EXECUTION_PAUSED', 'EXECUTION_HELD'].includes(code) && !/(?:_CANCELLED|_LEASE_LOST)$/.test(code);
}
/** Exact request identity prevents an unrelated/stale observation from becoming this job's display state. */
export function activeAttemptIngestionIssue(reader: { get<T>(kind: string, id: string): T | undefined }, attempt: Attempt): AttemptIngestionIssue | null {
  if (attempt.phase !== 'ingesting') return null;
  const issue = reader.get<AttemptIngestionIssue>('attempt_ingestion_issue', attempt.id);
  if (!issue || issue.version !== 1 || issue.id !== attempt.id || issue.attemptId !== attempt.id || issue.projectId !== attempt.projectId
    || issue.nodeId !== attempt.nodeId || issue.candidateId !== attempt.candidateId || issue.requestDigest !== digest(attempt.request)
    || issue.source !== 'local_ingestion' || issue.active !== true || typeof issue.code !== 'string' || !reportableIngestionIssue(issue.code)
    || sanitizedIngestionIssueCode(issue.code) !== issue.code || issue.message !== INGESTION_ISSUE_MESSAGE
    || typeof issue.observedAt !== 'string' || !Number.isFinite(Date.parse(issue.observedAt)) || issue.resolvedAt !== null) return null;
  return issue;
}
