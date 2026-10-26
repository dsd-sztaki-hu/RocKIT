# RocKIT ARP repository provider

This is an incremental extraction of the ARP repository provider. `ArpClient`
captures the current RO-Crate and Dataverse-style dataset/file HTTP requests in
an independently tested transport module. The extension registers `validate`,
`metadataLanguages`, `create`, `update`, `import`, `sync`, `delete`, and `link`.

The provider also lists and searches its Dataverse collections and checks
dataset-creation permission. RocKIT renders those provider-neutral
destinations without knowing the ARP/Dataverse API endpoints.

`ArpCreateOperation` performs the remote creation sequence from a
RocKIT-prepared crate, dataset payload, and file-source manifest. It does not
interpret crosswalks or write local mappings and logs; RocKIT performs those
steps. The provider checkpoints the PID immediately after dataset creation and
each uploaded file afterward, allowing RocKIT to persist partial mappings and
file hashes without repeatedly rewriting the visible RO-Crate or HTML preview.

`ArpUpdateOperation` loads the remote crate through the provider, then applies a
RocKIT-prepared diff using plugin-owned add, replace, delete, and metadata API
requests. Each completed file mutation is checkpointed so interrupted updates
retain their mappings and hashes for recovery.

`ArpImportOperation` parses the selected dataset URL or PID, downloads the
authenticated ARP RO-Crate ZIP, and stages it in a unique import workspace.
RocKIT safely extracts that archive and writes the local mapping, hash, and
export-log state before opening the imported workspace.

`ArpSyncOperation` loads the remote crate and downloads every file in a
RocKIT-prepared synchronization plan. Each completed write is checkpointed so
RocKIT can persist hashes and mappings before merging the remote metadata.

`ArpLinkOperation` retrieves an existing remote ARP RO-Crate, previews title
differences, and creates the local entity mapping and export-log entry used by
subsequent update and synchronization operations.

Run the focused tests with `npm test` in this directory.
