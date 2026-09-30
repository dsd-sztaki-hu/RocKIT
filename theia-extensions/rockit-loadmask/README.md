# RocKIT Load Mask

Provides the global RocKIT load mask service and frontend overlay for
long-running operations.

The extension contributes a shared `LoadMaskService` that can show modal
progress, aggregate concurrent operations, expose cancellable work, and keep the
Theia shell marked busy while blocking user interaction.

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
