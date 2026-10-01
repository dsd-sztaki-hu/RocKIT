// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { PreferenceContribution, PreferenceSchema } from '@theia/core'
import { nls } from '@theia/core/lib/common/nls'
import { interfaces } from '@theia/core/shared/inversify'

export const ROCKIT_SPLASH_SHOW_AT_STARTUP = 'rockit.splash.showAtStartup'
export const ROCKIT_HELP_ICONS_VISIBLE = 'rockit.helpIcons.visible'
export const ROCKIT_UPDATE_NOTIFY_AT_STARTUP = 'rockit.updates.notifyAtStartup'

export const RockitPreferenceSchema: PreferenceSchema = {
  properties: {
    [ROCKIT_SPLASH_SHOW_AT_STARTUP]: {
      type: 'boolean',
      default: true,
      description: nls.localizeByDefault(
        'Controls whether the RocKIT splash screen is shown at application startup.',
      ),
    },
    [ROCKIT_HELP_ICONS_VISIBLE]: {
      type: 'boolean',
      default: true,
      description: nls.localizeByDefault(
        'Controls whether RocKIT panel help icons are shown.',
      ),
    },
    [ROCKIT_UPDATE_NOTIFY_AT_STARTUP]: {
      type: 'boolean',
      default: true,
      description: nls.localize(
        'rockit/updates/notifyAtStartupDescription',
        'Controls whether RocKIT displays automatic update notifications at startup.',
      ),
    },
  },
}

export const RockitPreferenceContribution = Symbol('RockitPreferenceContribution')

export function bindRockitPreferences(bind: interfaces.Bind): void {
  bind(RockitPreferenceContribution).toConstantValue({
    schema: RockitPreferenceSchema,
  })
  bind(PreferenceContribution).toService(RockitPreferenceContribution)
}
