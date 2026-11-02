// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { ElectronDiagnostics } from './electron-app'

const allowedRendererErrors = [
  // Existing entities-overview code still renders Ant Design's deprecated Button.Group.
  // Remove this allowance when those controls migrate to Space.Compact.
  /console: .* root ERROR Warning: \[antd: Button\.Group\] `Button\.Group` is deprecated\. Please use `Space\.Compact` instead\.$/,
  // The metadata profile table still uses Ant Design's deprecated filter callback.
  // Remove this allowance when it migrates to filterDropdownProps.onOpenChange.
  /console: .* root ERROR Warning: \[antd: Table\] `onFilterDropdownOpenChange` is deprecated\. Please use `filterDropdownProps\.onOpenChange` instead\.$/,
]

export const unexpectedMainProcessErrors = (diagnostics: ElectronDiagnostics): string[] =>
  diagnostics.mainProcessConsole.filter(
    (message) => message.startsWith('[error]') || message.startsWith('[assert]'),
  )

export const unexpectedRendererErrors = (diagnostics: ElectronDiagnostics): string[] =>
  diagnostics.rendererErrors.filter(
    (message) => !allowedRendererErrors.some((allowed) => allowed.test(message)),
  )
