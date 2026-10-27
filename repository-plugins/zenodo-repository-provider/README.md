# RocKIT Zenodo repository provider

This directory is the reference implementation of a repository provider outside
the RocKIT application bundle.

The extension currently contains:

- `ZenodoClient`, the transport boundary that contains the required Zenodo API endpoint URLs,
  authentication headers, timeouts, response parsing, and HTTP errors;
- operations that accept repository-ready metadata from RocKIT and return
  downloaded repository metadata for RocKIT to interpret afterward;
- a registered `create` operation that reads the active RO-Crate workspace,
  creates a Zenodo draft, uploads local `File` entities and metadata, and saves
  the resulting mapping in `.rockit`;
- a differential `update` operation for writable drafts that preserves Zenodo
  access policy and reconciles added, changed, unchanged, and removed files.
- a `sync` operation that downloads remote files safely and returns the local
  and remote RO-Crates plus Zenodo metadata for RocKIT to map and merge;
- an `import` operation that downloads a Zenodo upload into a new RO-Crate,
  restores flattened file paths when metadata is available, returns the
  downloaded metadata, and persists the record link needed by later updates and syncs;
- a `delete` operation that removes a remote Zenodo draft while RocKIT retains
  responsibility for cleaning up its repository-independent local link state.
- a two-phase `link` operation that previews title mismatches, maps local
  RO-Crate files to an existing Zenodo deposition, and saves the link state used
  by update, sync, and delete.
- a provider-owned `validate` operation that verifies the configured Zenodo URL
  and token through the authenticated depositions API before RocKIT saves the
  connection.
- provider-owned stored-target discovery and interrupted-export status handling,
  so RocKIT no longer calls its built-in Zenodo service when reconstructing or
  declining recovery for a plugin export.

The provider advertises its repository operations and local target-management commands; unsupported
repository actions are not shown for connections using this provider. Required
descriptive metadata such as title, description, publication date, and creators
must still be present in the RO-Crate. The extension packages neither a
crosswalk nor a crosswalk interpreter. When a connection has a crosswalk,
RocKIT applies it before invoking the plugin and after the plugin returns.
Without a crosswalk, RocKIT passes the root dataset's properties through on
export/update and preserves the returned RO-Crate on import/sync. Such properties
must already be suitable for Zenodo's API; otherwise Zenodo may reject them.

Run its focused tests with:

```sh
yarn --cwd repository-plugins/zenodo-repository-provider test
```

Repository providers that ship with RocKIT are listed in the root
`rockitBundledPlugins` configuration. `yarn download:plugins` stages them as
built-in extensions. Run `yarn package:repository-plugins` at the repository
root to additionally create distributable packages in
`dist/repository-plugins`.
