# Remote RO-Crate Conversion

Provides a RocKIT command for converting remote ARP RO-Crate entity IDs back to
local workspace IDs.

The extension contributes **Convert Remote RO-Crate IDs to Local IDs** to the
Edit menu. It reads the open workspace's `ro-crate-metadata.json`, rewrites
eligible ARP repository file and dataset IDs to local paths, updates references,
and stores export mapping state in `.rockit`.

## Development

```bash
yarn build
```

## Authorship

This package is maintained by SZTAKI, Department of Distributed Systems
(<https://dsd.sztaki.hu>).

Individual contributors are listed in `package.json`.

## License

This package is licensed under the Apache License, Version 2.0. See
[LICENSE.md](../../LICENSE.md) for details.
