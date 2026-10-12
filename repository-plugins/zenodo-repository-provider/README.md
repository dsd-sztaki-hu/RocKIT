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
  access conditions when the crosswalk cannot determine them unambiguously.

Only `create` is advertised to RocKIT at this stage, so unsupported repository
actions are not shown for connections using this provider. Required descriptive
metadata such as title, description, publication date, and creators must still
be present in the RO-Crate.

Run its focused tests with:

```sh
yarn --cwd repository-plugins/zenodo-repository-provider test
```
