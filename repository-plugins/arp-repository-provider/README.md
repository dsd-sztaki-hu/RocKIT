# RocKIT ARP repository provider (in progress)

This is an incremental extraction of the ARP repository provider. `ArpClient`
captures the current RO-Crate validation, fetch, and update HTTP requests in an
independently tested transport module. The extension currently registers only
the read-only `validate` operation, which checks ARP ZIP-upload support and the
configured API token. RocKIT still uses its existing ARP implementation for
export, import, update, sync, and link. Connections using the extension will
not offer those operations yet.

Run the focused tests with `npm test` in this directory.
