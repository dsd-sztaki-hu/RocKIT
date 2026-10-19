# RocKIT ARP repository provider (in progress)

This is the first extraction step for the ARP repository provider. `ArpClient`
captures the current RO-Crate validation, fetch, and update HTTP requests in an
independently tested transport module. It is not registered or staged as a VS
Code extension yet, and RocKIT still uses its existing ARP implementation.

Run the focused tests with `npm test` in this directory.
