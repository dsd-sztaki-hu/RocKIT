# RocKIT Dataverse repository provider

This extension is the native Dataverse repository provider for RocKIT. The
extension registers Dataverse as an extension-backed repository type and
implements authenticated connection validation and dataset creation/export.

Repository operations are advertised only after they have been migrated into
the extension. This prevents RocKIT from displaying actions that still lack a
provider implementation.

`DataverseClient` is the transport boundary containing the Dataverse API
endpoint calls required by the provider.

`DataverseCreateOperation` receives a RocKIT-prepared Dataverse metadata
payload and file manifest, creates the remote draft, uploads its files, and
uploads rewritten RO-Crate metadata. It checkpoints the dataset and every
uploaded file so RocKIT can maintain recoverable local mappings and hashes.

Run the focused tests with `npm test` in this directory.
