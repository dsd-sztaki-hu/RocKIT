// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { ContainerModule } from 'inversify'
import { CommandContribution, MenuContribution } from '@theia/core/lib/common'
import { WidgetFactory, FrontendApplicationContribution } from '@theia/core/lib/browser'
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar'

import {
  DataRepositoryManagerWidget,
  DATA_REPOSITORY_MANAGER_WIDGET_ID,
} from './data-repository-manager-widget'
import { DataRepositoryManagerContribution } from './data-repository-manager-contribution'
import { DataRepositoryStoreService } from './services/data-repository-store-service'
import { ArpRoCrateExportService } from './services/arp-ro-crate-export-service'
import { ArpRoCrateImportService } from './services/arp-ro-crate-import-service'
import { ArpRoCrateLinkService } from './services/arp-ro-crate-link-service'
import { NativeDataverseExportService } from './services/native-dataverse-export-service'
import { NativeDataverseImportService } from './services/native-dataverse-import-service'
import { FileHashStoreService } from './services/file-hash-store-service'
import { DataRepositoryExportDeleteService } from './services/data-repository-export-delete-service'
import { DataRepositoryExportRecordService } from './services/data-repository-export-record-service'
import { DataverseMetadataMappingService } from './services/dataverse-metadata-mapping-service'
import { RepositoryProviderRegistry } from './repository-provider-registry'
import { RepositoryProviderService } from './repository-provider-service'
import { RepositoryOperationProgressService } from './repository-operation-progress'
import { BundledCrosswalk } from 'crosswalk-manager/lib/browser/crosswalk-manager-types'
import { BUNDLED_REPOSITORY_CROSSWALKS } from './bundled-crosswalks'
import { RepositoryCrosswalkService } from './services/repository-crosswalk-service'

export default new ContainerModule((bind) => {
  for (const crosswalk of BUNDLED_REPOSITORY_CROSSWALKS) {
    bind<BundledCrosswalk>(BundledCrosswalk).toConstantValue(crosswalk)
  }

  // 1. Services
  bind(DataRepositoryStoreService).toSelf().inSingletonScope()
  bind(ArpRoCrateExportService).toSelf().inSingletonScope()
  bind(ArpRoCrateImportService).toSelf().inSingletonScope()
  bind(ArpRoCrateLinkService).toSelf().inSingletonScope()
  bind(NativeDataverseExportService).toSelf().inSingletonScope()
  bind(NativeDataverseImportService).toSelf().inSingletonScope()
  bind(FileHashStoreService).toSelf().inSingletonScope()
  bind(DataRepositoryExportDeleteService).toSelf().inSingletonScope()
  bind(DataRepositoryExportRecordService).toSelf().inSingletonScope()
  bind(DataverseMetadataMappingService).toSelf().inSingletonScope()
  bind(RepositoryProviderRegistry).toSelf().inSingletonScope()
  bind(RepositoryProviderService).toSelf().inSingletonScope()
  bind(RepositoryOperationProgressService).toSelf().inSingletonScope()
  bind(RepositoryCrosswalkService).toSelf().inSingletonScope()

  // 2. Widget
  bind(DataRepositoryManagerWidget).toSelf().inTransientScope()

  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: DATA_REPOSITORY_MANAGER_WIDGET_ID,
      createWidget: () => ctx.container.get(DataRepositoryManagerWidget),
    }))
    .inSingletonScope()

  // 3. Contributions
  bind(DataRepositoryManagerContribution).toSelf().inSingletonScope()
  bind(CommandContribution).toService(DataRepositoryManagerContribution)
  bind(MenuContribution).toService(DataRepositoryManagerContribution)
  bind(FrontendApplicationContribution).toService(DataRepositoryManagerContribution)
  bind(TabBarToolbarContribution).toService(DataRepositoryManagerContribution)
})
