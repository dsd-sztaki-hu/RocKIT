// *****************************************************************************
// Copyright (C) 2025
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0
// *****************************************************************************

import { interfaces } from '@theia/core/shared/inversify'
import {
  createPreferenceProxy,
  PreferenceContribution,
  PreferenceProxy,
  PreferenceSchema,
  PreferenceService,
} from '@theia/core'
import { nls } from '@theia/core/lib/common/nls'

export const ROCrateExternalChangeAction = 'rockit.roCrate.externalChangeAction'
export type ROCrateExternalChangeActionValue = 'prompt' | 'auto' | 'off'

export const AppStateConfigSchema: PreferenceSchema = {
  properties: {
    [ROCrateExternalChangeAction]: {
      type: 'string',
      enum: ['prompt', 'auto', 'off'],
      default: 'prompt',
      description: nls.localize(
        'rockit/appState/preference/externalChangeDescription',
        'Controls how RocKIT reacts to external ro-crate-metadata.json changes: prompt, auto-reload, or off.',
      ),
    },
  },
}

export interface AppStateConfiguration {
  [ROCrateExternalChangeAction]: ROCrateExternalChangeActionValue
}

export const AppStatePreferenceContribution = Symbol(
  'AppStatePreferenceContribution',
)
export const AppStatePreferences = Symbol('AppStatePreferences')
export type AppStatePreferences = PreferenceProxy<AppStateConfiguration>

export function createAppStatePreferences(
  preferences: PreferenceService,
  schema: PreferenceSchema = AppStateConfigSchema,
): AppStatePreferences {
  return createPreferenceProxy(preferences, schema)
}

export function bindAppStatePreferences(bind: interfaces.Bind): void {
  bind(AppStatePreferences)
    .toDynamicValue((ctx) => {
      const preferences = ctx.container.get<PreferenceService>(PreferenceService)
      const contribution = ctx.container.get<PreferenceContribution>(
        AppStatePreferenceContribution,
      )
      return createAppStatePreferences(preferences, contribution.schema)
    })
    .inSingletonScope()
  bind(AppStatePreferenceContribution).toConstantValue({ schema: AppStateConfigSchema })
  bind(PreferenceContribution).toService(AppStatePreferenceContribution)
}
