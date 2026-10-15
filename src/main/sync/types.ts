/**
 * Sync engine types — re-exports shared interface and adds engine-specific types.
 */

// Re-export the canonical SyncBackend and related types from shared
export type {
  SyncBackend,
  BackendConfig,
  FileMetadata,
  SyncBackendType,
  SyncConnectOptions,
} from '@shared/types';

export interface SyncStatus {
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  direction: 'push' | 'pull' | 'idle';
}
