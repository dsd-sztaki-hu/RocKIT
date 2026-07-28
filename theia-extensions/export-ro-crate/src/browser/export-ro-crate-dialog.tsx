import { Message } from '@lumino/messaging'
import { AbstractDialog, DialogMode } from '@theia/core/lib/browser/dialogs'
import { nls } from '@theia/core/lib/common'

export enum ExportRoCrateMode {
  Normal = 'normal',
  Clean = 'clean',
}

export interface ExportRoCrateOptions {
  mode: ExportRoCrateMode
  includeReferencedLocalFiles: boolean
}

export interface ExportRoCrateDialogOptions {
  hasUnsavedChanges: () => Promise<boolean>
  saveChanges: () => Promise<void>
}

const MODE_DETAILS: Record<ExportRoCrateMode, { label: string; description: string }> = {
  [ExportRoCrateMode.Normal]: {
    label: nls.localize('rockit/exportRoCrate/normal', 'Normal Export'),
    description: nls.localize(
      'rockit/exportRoCrate/normalDescription',
      'Exports the entire workspace as a ZIP, including all files and folders.',
    ),
  },
  [ExportRoCrateMode.Clean]: {
    label: nls.localize(
      'rockit/exportRoCrate/clean',
      'Clean RO-Crate Export',
    ),
    description: nls.localize(
      'rockit/exportRoCrate/cleanDescription',
      'Exports only the RO-Crate structure, including files explicitly listed in ro-crate-metadata.json.',
    ),
  },
}

export class ExportRoCrateDialog extends AbstractDialog<ExportRoCrateOptions> {
  protected readonly radios: Record<ExportRoCrateMode, HTMLInputElement> = {
    [ExportRoCrateMode.Normal]: document.createElement('input'),
    [ExportRoCrateMode.Clean]: document.createElement('input'),
  }

  protected readonly includeReferencedLocalFiles = document.createElement('input')
  protected readonly unsavedChangesNode = document.createElement('div')
  protected readonly unsavedChangesTextNode = document.createElement('span')
  protected readonly saveChangesButton = document.createElement('button')
  protected saveError: string | undefined
  protected saveInProgress = false

  constructor(protected readonly options: ExportRoCrateDialogOptions) {
    super({
      title: nls.localize('rockit/exportRoCrate/title', 'Export RO-Crate'),
    })

    this.appendCloseButton(nls.localize('rockit/common/cancel', 'Cancel'))
    this.appendAcceptButton(nls.localize('rockit/exportRoCrate/export', 'Export'))

    const container = document.createElement('div')
    container.classList.add('export-ro-crate-dialog')
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.gap = '1rem'

    this.unsavedChangesNode.classList.add('export-unsaved-changes')
    this.unsavedChangesNode.style.display = 'none'

    this.unsavedChangesTextNode.textContent = nls.localize(
      'rockit/exportRoCrate/unsavedChanges',
      'RO-Crate metadata has unsaved changes. Save before exporting.',
    )
    this.unsavedChangesTextNode.classList.add('export-unsaved-changes-message')

    this.saveChangesButton.type = 'button'
    this.saveChangesButton.classList.add(
      'theia-button',
      'secondary',
      'export-unsaved-changes-save',
    )
    this.saveChangesButton.textContent = nls.localize(
      'rockit/exportRoCrate/save',
      'Save',
    )
    this.saveChangesButton.addEventListener('click', () => {
      void this.saveAndRefresh()
    })

    this.unsavedChangesNode.appendChild(this.unsavedChangesTextNode)
    this.unsavedChangesNode.appendChild(this.saveChangesButton)
    container.appendChild(this.unsavedChangesNode)

    for (const mode of [ExportRoCrateMode.Normal, ExportRoCrateMode.Clean]) {
      const details = MODE_DETAILS[mode]

      const section = document.createElement('div')
      section.classList.add('export-mode-section')
      section.style.border = '1px solid var(--theia-border-color)'
      section.style.borderRadius = '4px'
      section.style.padding = '0.75rem'
      section.style.backgroundColor = 'var(--theia-input-background)'

      // Make the entire section clickable by using one label that wraps everything.
      const label = document.createElement('label')
      label.classList.add('export-mode-label')
      label.style.display = 'block'
      label.style.cursor = 'pointer'

      const header = document.createElement('div')
      header.style.display = 'flex'
      header.style.alignItems = 'center'
      header.style.gap = '0.4rem'

      const radio = this.radios[mode]
      radio.type = 'radio'
      radio.name = 'export-mode'
      radio.value = mode
      radio.checked = mode === ExportRoCrateMode.Normal

      const title = document.createElement('span')
      title.textContent = details.label
      title.classList.add('export-mode-title')
      title.style.fontWeight = '600'

      const description = document.createElement('p')
      description.textContent = details.description
      description.classList.add('export-mode-description')
      description.style.margin = '0'
      description.style.marginLeft = '1.9rem'
      description.style.color = 'var(--theia-text-muted)'

      header.appendChild(radio)
      header.appendChild(title)

      label.appendChild(header)
      label.appendChild(description)

      section.appendChild(label)
      container.appendChild(section)
    }

    const includeSection = document.createElement('label')
    includeSection.classList.add('export-include-referenced-local-files')
    includeSection.style.display = 'flex'
    includeSection.style.alignItems = 'flex-start'
    includeSection.style.gap = '0.5rem'
    includeSection.style.cursor = 'pointer'
    includeSection.style.userSelect = 'none'

    this.includeReferencedLocalFiles.type = 'checkbox'
    this.includeReferencedLocalFiles.checked = false

    const includeText = document.createElement('span')
    includeText.textContent = nls.localize(
      'rockit/exportRoCrate/includeExternalFiles',
      'Include referenced local files that are outside the RO-Crate folder',
    )

    includeSection.appendChild(this.includeReferencedLocalFiles)
    includeSection.appendChild(includeText)
    container.appendChild(includeSection)

    this.contentNode.appendChild(container)
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.radios[ExportRoCrateMode.Normal]?.focus()
    void this.refreshUnsavedChangesState()
  }

  protected async saveAndRefresh(): Promise<void> {
    if (this.saveInProgress) {
      return
    }
    this.saveInProgress = true
    this.saveError = undefined
    this.saveChangesButton.disabled = true
    this.saveChangesButton.textContent = nls.localize(
      'rockit/exportRoCrate/saving',
      'Saving...',
    )

    try {
      await this.options.saveChanges()
    } catch (error) {
      console.error('Failed to save RO-Crate before export', error)
      this.saveError = nls.localize(
        'rockit/exportRoCrate/saveFailed',
        'Save failed: {0}',
        String(error),
      )
    } finally {
      this.saveInProgress = false
      this.saveChangesButton.disabled = false
      this.saveChangesButton.textContent = nls.localize(
        'rockit/exportRoCrate/save',
        'Save',
      )
      await this.refreshUnsavedChangesState()
    }
  }

  protected async refreshUnsavedChangesState(): Promise<void> {
    const hasUnsavedChanges = await this.options.hasUnsavedChanges()
    this.unsavedChangesNode.style.display = hasUnsavedChanges ? 'flex' : 'none'
    this.unsavedChangesTextNode.textContent =
      this.saveError ??
      nls.localize(
        'rockit/exportRoCrate/unsavedChanges',
        'RO-Crate metadata has unsaved changes. Save before exporting.',
      )

    if (this.acceptButton) {
      this.acceptButton.disabled = hasUnsavedChanges
    }
    this.update()
  }

  protected override async isValid(
    _value: ExportRoCrateOptions,
    _mode: DialogMode,
  ): Promise<string> {
    if (await this.options.hasUnsavedChanges()) {
      return nls.localize(
        'rockit/exportRoCrate/saveBeforeExport',
        'Save RO-Crate metadata before exporting.',
      )
    }
    return ''
  }

  get value(): ExportRoCrateOptions {
    const mode = this.radios[ExportRoCrateMode.Clean]?.checked
      ? ExportRoCrateMode.Clean
      : ExportRoCrateMode.Normal
    return {
      mode,
      includeReferencedLocalFiles: this.includeReferencedLocalFiles.checked,
    }
  }
}
