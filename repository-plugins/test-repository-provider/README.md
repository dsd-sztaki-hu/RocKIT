# RocKIT test repository provider

This development-only VS Code extension verifies the first repository plugin
boundary: an installed extension can register a repository provider descriptor
and expose an operation through a command.

It deliberately performs no network or filesystem work. Its single `create`
operation returns a fixed draft result. The extension is not a Zenodo
implementation and must not be distributed as a production plugin.

Use these commands from RocKIT's Command Palette when testing the boundary:

- `RocKIT: Verify Test Repository Provider` checks registration.
- `RocKIT: Test Repository Create Round-Trip` asks RocKIT to resolve and invoke
  the extension's fake `create` implementation.
