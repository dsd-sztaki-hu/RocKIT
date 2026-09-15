// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import {
  PreferenceContribution,
  PreferenceSchema,
} from '@theia/core'
import { interfaces } from '@theia/core/shared/inversify'

export const ROCKIT_REACT_GRAB_ENABLED = 'rockit.developer.reactGrab.enabled'

export const ReactGrabHelperConfigSchema: PreferenceSchema = {
  properties: {
    [ROCKIT_REACT_GRAB_ENABLED]: {
      type: 'boolean',
      default: false,
      description:
        'Enables React Grab while running a development build. Keep this disabled for normal text selection and clipboard use.',
    },
  },
}

export const ReactGrabHelperPreferenceContribution = Symbol(
  'ReactGrabHelperPreferenceContribution',
)

export function bindReactGrabHelperPreferences(bind: interfaces.Bind): void {
  bind(ReactGrabHelperPreferenceContribution).toConstantValue({
    schema: ReactGrabHelperConfigSchema,
  })
  bind(PreferenceContribution).toService(ReactGrabHelperPreferenceContribution)
}
