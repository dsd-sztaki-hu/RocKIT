// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { BackendRequestAllowedContribution } from '@theia/core/lib/node'
import { LocalizationContribution } from '@theia/core/lib/node/i18n/localization-contribution'
import { ContainerModule } from '@theia/core/shared/inversify'
import { RockitLocalizationContribution } from './rockit-localization-contribution'

export default new ContainerModule((bind) => {
  bind(RockitLocalizationContribution).toSelf().inSingletonScope()
  bind(LocalizationContribution).toService(RockitLocalizationContribution)

  // Theia 1.73+ blocks frontend requests proxied through the backend unless
  // their origin is explicitly contributed to the backend request allowlist.
  bind(BackendRequestAllowedContribution).toConstantValue({
    getAllowedUrlPatterns: () => ['https://api.github.com'],
  })
})
