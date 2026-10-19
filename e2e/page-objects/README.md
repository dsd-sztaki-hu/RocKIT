<!--
******************************************************************************************
Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).

SPDX-License-Identifier: Apache-2.0
******************************************************************************************
-->

# E2E page objects

Keep small RocKIT-specific page objects here. Page objects should expose user
actions and visible outcomes for the application shell, file explorer,
RO-Crate editor, profiles, and validation UI.

Prefer accessible roles, labels, visible text, and stable test IDs. Do not
encode layout details or arbitrary delays into page objects.

`RocKitPageObjects` composes the AI-review controls, application shell, file
explorer, Structure panel, RO-Crate editor, schema-property chooser, schema
manager, Global Entity Library, metadata-profile selector, and validation view
objects.
Electron tests receive it through the shared `rockit` fixture. Entity mutations
belong to the editor object, property discovery to the property-chooser object,
schema registration and removal to the schema-manager object, approval
decisions to the AI-review object, global-record management to the Global
Entity Library object, and opening and observing entities in the tree to the
Structure object. Native-folder data-source registration and explorer state
belong to the file-explorer object.
