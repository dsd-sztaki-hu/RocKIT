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
  the resulting mapping in `.rockit`.

Only `create` is advertised to RocKIT at this stage, so unsupported repository
actions are not shown for connections using this provider. The crate must
already contain all metadata required by Zenodo; metadata-completion UI remains
a later step.

Run its focused tests with:

```sh
yarn --cwd repository-plugins/zenodo-repository-provider test
```
