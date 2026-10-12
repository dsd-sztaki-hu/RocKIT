# RocKIT Zenodo repository provider

This directory is the reference implementation of a repository provider outside
the RocKIT application bundle.

The first extraction step contains only `ZenodoClient`, the transport boundary
that owns Zenodo URLs, authentication headers, timeouts, response parsing, and
HTTP errors. Workspace access, dialogs, crosswalk processing, and repository
operation registration will move here in later steps.

Run its focused tests with:

```sh
yarn --cwd repository-plugins/zenodo-repository-provider test
```
