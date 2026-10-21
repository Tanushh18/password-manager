# Google Takeout archive ingestion

## Scope and current status

Stashr's current Google Photos Picker flow is not a Takeout archive importer. A safe importer needs to accept ZIP parts, validate the ZIP central directory and every path, pair media with JSON sidecars, preserve album folders and capture timestamps, upload files to the connected Google Drive account, verify uploaded bytes/checksums, deduplicate, and report resumable job status.

## Required implementation contract

- Authenticated upload only; never expose Google tokens to the browser.
- Stream large uploads and media; do not buffer an entire Takeout ZIP or media file in memory.
- Reject path traversal, encrypted/multi-disk archives, malformed ZIP records, ZIP bombs, oversized entries and unsupported ZIP64 unless explicitly implemented.
- Pair common sidecar patterns: `photo.jpg.json`, `photo.json`, and `photo.jpg.supplemental-metadata.json`.
- Preserve folder paths under `Google Photos/Takeout/<album path>` and prefer `photoTakenTime.timestamp` over archive or upload time.
- Use an idempotency key based on checksum plus source path; retry transient Drive failures with backoff.
- Verify each Drive upload by size and checksum when available before indexing it.
- Treat Google Takeout exports as user-initiated; recurring automation can only process archives that are placed into an authorized intake location. It cannot trigger a full export of the user's Photos library on its own.

## Verification requirements

Run `npm test` in `server/` and `npm test` plus `npm run build` in `client/`. Test valid archives, malformed archives, path traversal, JSON timestamp parsing, duplicate media, retry after Drive errors, and large-file memory behaviour. Verify the live deployment separately; a Git push alone does not prove deployment succeeded.

## Not implemented by this document

This document is a specification only. It does not add an upload endpoint, ZIP extraction worker, Drive uploader, UI or scheduled intake watcher. Do not represent Takeout ingestion as available until those components are implemented and tested.