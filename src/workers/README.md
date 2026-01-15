# Web Workers

This directory will contain Web Workers for background processing.

## Planned Workers (Step 2+)

### `dicomParser.worker.ts`
- Parse DICOM P10 files off the main thread
- Extract metadata and pixel data
- Send parsed results back to main thread

### `indexer.worker.ts`
- Index studies/series/instances from parsed DICOM
- Build in-memory search index
- Handle bulk file processing

### `thumbnail.worker.ts`
- Generate thumbnails from DICOM pixel data
- Resize and compress for study browser

## Usage Pattern

```typescript
// Future usage example
const worker = new Worker(new URL('./dicomParser.worker.ts', import.meta.url), {
  type: 'module'
});

worker.postMessage({ type: 'PARSE', file: dicomFile });
worker.onmessage = (e) => {
  const { type, data } = e.data;
  // Handle parsed result
};
```

## Design Principles

1. **Non-blocking**: All heavy work off main thread
2. **Transferable**: Use ArrayBuffer transfer for zero-copy
3. **Cancelable**: Support aborting long operations
4. **Progress**: Report progress for large files
