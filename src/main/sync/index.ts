/**
 * Sync engine with pluggable backends.
 * Supports SFTP, FTP, S3, and local filesystem sync.
 */

export { syncEngine } from './engine';
export { SFTPSyncBackend } from './backends/sftp';
export { FTPSyncBackend } from './backends/ftp';
export { S3SyncBackend } from './backends/s3';
export { FilesystemSyncBackend } from './backends/filesystem';
export type { SyncBackend, SyncStatus, BackendConfig, FileMetadata, SyncBackendType } from './types';
