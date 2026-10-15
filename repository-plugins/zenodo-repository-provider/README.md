# RocKIT Zenodo repository provider

This directory is the reference implementation of a repository provider outside
the RocKIT application bundle.

The extension currently contains:

- `ZenodoClient`, the transport boundary that owns Zenodo URLs,
  authentication headers, timeouts, response parsing, and HTTP errors;
- the generated ARP/RO-Crate ↔ Zenodo metadata crosswalk and its framework-free
  runtime;
- a registered `create` operation that reads the active RO-Crate workspace,
  creates a Zenodo draft, uploads local `File` entities and metadata, and saves
  the resulting mapping in `.rockit`;
- native extension prompts for Zenodo access right, license, embargo date, and
  access conditions when the crosswalk cannot determine them unambiguously;
- a differential `update` operation for writable drafts that preserves Zenodo
  access policy and reconciles added, changed, unchanged, and removed files.
- a `sync` operation that downloads remote files safely, applies the reverse
  metadata crosswalk, and supports complete, remote-additions, and
  local-additions merge policies.
- an `import` operation that downloads a Zenodo upload into a new RO-Crate,
  restores flattened file paths when metadata is available, applies the reverse
  crosswalk, and persists the record link needed by later updates and syncs.
- a `delete` operation that removes a remote Zenodo draft while RocKIT retains
  responsibility for cleaning up its repository-independent local link state.
- a two-phase `link` operation that previews title mismatches, maps local
  RO-Crate files to an existing Zenodo deposition, and saves the link state used
  by update, sync, and delete.
- a provider-owned `validate` operation that verifies the configured Zenodo URL
  and token through the authenticated depositions API before RocKIT saves the
  connection.

The provider advertises `create`, `update`, `sync`, `import`, `delete`, `link`, and `validate`; unsupported
repository actions are not shown for connections using this provider. Required
descriptive metadata such as title, description, publication date, and creators
must still be present in the RO-Crate.

Run its focused tests with:

```sh
yarn --cwd repository-plugins/zenodo-repository-provider test
```

RocKIT currently has no user-facing extension installation flow. Reference
repository providers that should ship with the application are therefore listed
in the root `rockitBundledPlugins` configuration. `yarn download:plugins` builds
and stages those local VS Code plugins beside the plugins downloaded by Theia.
