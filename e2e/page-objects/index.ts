// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Page } from '@playwright/test'
import { RocKitAiReview } from './ai-review'
import { RocKitApplicationShell } from './application-shell'
import { RocKitFileExplorer } from './file-explorer'
import { RocKitGlobalEntityLibrary } from './global-entity-library'
import { RocKitMetadataProfiles } from './metadata-profiles'
import { RocKitMetadataRecovery } from './metadata-recovery'
import { RocKitMultiEdit } from './multi-edit'
import { RocKitPackageRoCrate } from './package-ro-crate'
import { RocKitPropertyChooser } from './property-chooser'
import { RocKitRoCrateEditor } from './ro-crate-editor'
import { RocKitSchemaManager } from './schema-manager'
import { RocKitStructurePanel } from './structure-panel'
import { RocKitValidation } from './validation'

export class RocKitPageObjects {
  readonly aiReview: RocKitAiReview
  readonly editor: RocKitRoCrateEditor
  readonly fileExplorer: RocKitFileExplorer
  readonly globalEntities: RocKitGlobalEntityLibrary
  readonly metadataRecovery: RocKitMetadataRecovery
  readonly multiEdit: RocKitMultiEdit
  readonly packageRoCrate: RocKitPackageRoCrate
  readonly propertyChooser: RocKitPropertyChooser
  readonly profiles: RocKitMetadataProfiles
  readonly schemas: RocKitSchemaManager
  readonly shell: RocKitApplicationShell
  readonly structure: RocKitStructurePanel
  readonly validation: RocKitValidation

  constructor(page: Page, workspacePath: string) {
    this.shell = new RocKitApplicationShell(page, workspacePath)
    this.fileExplorer = new RocKitFileExplorer(this.shell)
    this.globalEntities = new RocKitGlobalEntityLibrary(page, this.shell)
    this.metadataRecovery = new RocKitMetadataRecovery(page)
    this.multiEdit = new RocKitMultiEdit(page)
    this.packageRoCrate = new RocKitPackageRoCrate(this.shell)
    this.editor = new RocKitRoCrateEditor(page)
    this.aiReview = new RocKitAiReview(this.editor)
    this.propertyChooser = new RocKitPropertyChooser(page, this.editor)
    this.profiles = new RocKitMetadataProfiles(page)
    this.schemas = new RocKitSchemaManager(page, this.editor)
    this.structure = new RocKitStructurePanel(page)
    this.validation = new RocKitValidation(page)
  }
}

export * from './ai-review'
export * from './application-shell'
export * from './file-explorer'
export * from './global-entity-library'
export * from './metadata-profiles'
export * from './metadata-recovery'
export * from './multi-edit'
export * from './package-ro-crate'
export * from './property-chooser'
export * from './ro-crate-editor'
export * from './schema-manager'
export * from './structure-panel'
export * from './validation'
