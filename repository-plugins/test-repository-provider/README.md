# RocKIT test repository provider

This development-only VS Code extension verifies the first repository plugin
boundary: an installed extension can register a repository provider descriptor
and expose an operation through a command.

It deliberately performs no network or filesystem work. Its single `create`
operation returns a fixed draft result. The extension is not a Zenodo
implementation and must not be distributed as a production plugin.
