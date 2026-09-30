# Metadata Profile Core

Provides Node-safe CEDAR metadata profile storage and conversion utilities for
RocKIT.

The package manages local profile storage, remote CEDAR provider configuration,
profile indexing, and CEDAR-to-RO-Crate profile conversion. It is shared by
RocKIT extensions and backend tooling that need metadata profile operations
outside browser-only Theia APIs.

## Development

```bash
yarn build
yarn test
```

## Authorship

This package is maintained by SZTAKI, Department of Distributed Systems
(<https://dsd.sztaki.hu>).

Individual contributors are listed in `package.json`.

## License

This package is licensed under the Apache License, Version 2.0. See
[LICENSE.md](../../LICENSE.md) for details.
