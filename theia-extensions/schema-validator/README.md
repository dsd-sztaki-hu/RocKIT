# Schema Validator

Provides RocKIT validation services and the Validation Errors view for RO-Crate
metadata.

The extension contributes validation logic for RO-Crate entities and profile
rules, stores validation results in application state, and displays validation
errors in a Theia view. Selecting a validation error can open the related
RO-Crate entity in the editor.

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
