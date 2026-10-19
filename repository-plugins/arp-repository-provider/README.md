# RocKIT ARP repository provider (in progress)

This is an incremental extraction of the ARP repository provider. `ArpClient`
captures the current RO-Crate and Dataverse-style dataset/file HTTP requests in
an independently tested transport module. The extension registers `validate`,
`metadataLanguages`, and `create`. RocKIT still uses its existing ARP
implementation for import, update, sync, and link, so those operations are not
advertised for extension-backed connections yet.

`ArpCreateOperation` performs the remote creation sequence from a
RocKIT-prepared crate, dataset payload, and file-source manifest. It does not
interpret crosswalks or write local mappings and logs; RocKIT performs those
steps. The provider checkpoints the PID immediately after dataset creation and
each uploaded file afterward, allowing RocKIT to persist partial mappings and
file hashes without repeatedly rewriting the visible RO-Crate or HTML preview.

Run the focused tests with `npm test` in this directory.
