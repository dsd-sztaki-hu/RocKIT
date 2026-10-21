# RocKIT Dataverse repository provider

This extension is the native Dataverse repository provider for RocKIT. The
initial extraction registers Dataverse as an extension-backed repository type
and implements authenticated, read-only connection validation.

Repository operations are advertised only after they have been migrated into
the extension. This prevents RocKIT from displaying actions that still lack a
provider implementation.

`DataverseClient` is the transport boundary containing the Dataverse API
endpoint calls required by the provider.

Run the focused tests with `npm test` in this directory.
