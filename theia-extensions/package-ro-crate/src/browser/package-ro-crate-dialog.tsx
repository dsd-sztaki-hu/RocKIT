import { Message } from '@lumino/messaging'
import { AbstractDialog, DialogMode } from '@theia/core/lib/browser/dialogs'
import { nls } from '@theia/core/lib/common'

export enum PackageRoCrateMode {
  Normal = 'normal',
  Clean = 'clean',
}

export interface PackageRoCrateOptions {
  mode: PackageRoCrateMode
  includeReferencedLocalFiles: boolean
}

export interface PackageRoCrateDialogOptions {
  hasUnsavedChanges: () => Promise<boolean>
  saveChanges: () => Promise<void>
}

const MODE_DETAILS: Record<PackageRoCrateMode, { label: string; description: string }> = {
  [PackageRoCrateMode.Normal]: {
    label: nls.localize('rockit/packageRoCrate/normal', 'Normal Package'),
    description: nls.localize(
      'rockit/packageRoCrate/normalDescription',
      'Packages the entire workspace as a ZIP, including all files and folders.',
    ),
  },
  [PackageRoCrateMode.Clean]: {
    label: nls.localize(
      'rockit/packageRoCrate/clean',
      'Clean RO-Crate Package',
    ),
    description: nls.localize(
      'rockit/packageRoCrate/cleanDescription',
      'Packages only the RO-Crate structure, including files explicitly listed in ro-crate-metadata.json.',
    ),
  },
}

export class PackageRoCrateDialog extends AbstractDialog<PackageRoCrateOptions> {
  protected readonly radios: Record<PackageRoCrateMode, HTMLInputElement> = {
    [PackageRoCrateMode.Normal]: document.createElement('input'),
    [PackageRoCrateMode.Clean]: document.createElement('input'),
  }

  protected readonly includeReferencedLocalFiles = document.createElement('input')
  protected readonly unsavedChangesNode = document.createElement('div')
  protected readonly unsavedChangesTextNode = document.createElement('span')
  protected readonly saveChangesButton = document.createElement('button')
  protected saveError: string | undefined
  protected saveInProgress = false

  constructor(protected readonly options: PackageRoCrateDialogOptions) {
    super({
      title: nls.localize('rockit/packageRoCrate/title', 'Package RO-Crate'),
    })

    this.appendCloseButton(nls.localize('rockit/common/cancel', 'Cancel'))
    this.appendAcceptButton(nls.localize('rockit/packageRoCrate/package', 'Package'))

    const container = document.createElement('div')
    container.classList.add('package-ro-crate-dialog')
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.gap = '1rem'

    this.unsavedChangesNode.classList.add('package-unsaved-changes')
    this.unsavedChangesNode.style.display = 'none'

    this.unsavedChangesTextNode.textContent = nls.localize(
      'rockit/packageRoCrate/unsavedChanges',
      'RO-Crate metadata has unsaved changes. Save before packaging.',
    )
    this.unsavedChangesTextNode.classList.add('package-unsaved-changes-message')

    this.saveChangesButton.type = 'button'
    this.saveChangesButton.classList.add(
      'theia-button',
      'secondary',
      'package-unsaved-changes-save',
    )
    this.saveChangesButton.textContent = nls.localize(
      'rockit/packageRoCrate/save',
      'Save',
    )
    this.saveChangesButton.addEventListener('click', () => {
      void this.saveAndRefresh()
    })

    this.unsavedChangesNode.appendChild(this.unsavedChangesTextNode)
    this.unsavedChangesNode.appendChild(this.saveChangesButton)
    container.appendChild(this.unsavedChangesNode)

    for (const mode of [PackageRoCrateMode.Normal, PackageRoCrateMode.Clean]) {
      const details = MODE_DETAILS[mode]

      const section = document.createElement('div')
      section.classList.add('package-mode-section')
      section.style.border = '1px solid var(--theia-border-color)'
      section.style.borderRadius = '4px'
      section.style.padding = '0.75rem'
      section.style.backgroundColor = 'var(--theia-input-background)'

      // Make the entire section clickable by using one label that wraps everything.
      const label = document.createElement('label')
      label.classList.add('package-mode-label')
      label.style.display = 'block'
      label.style.cursor = 'pointer'

      const header = document.createElement('div')
      header.style.display = 'flex'
      header.style.alignItems = 'center'
      header.style.gap = '0.4rem'

      const radio = this.radios[mode]
      radio.type = 'radio'
      radio.name = 'package-mode'
      radio.value = mode
      radio.checked = mode === PackageRoCrateMode.Normal

      const title = document.createElement('span')
      title.textContent = details.label
      title.classList.add('package-mode-title')
      title.style.fontWeight = '600'

      const description = document.createElement('p')
      description.textContent = details.description
      description.classList.add('package-mode-description')
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
    includeSection.classList.add('package-include-referenced-local-files')
    includeSection.style.display = 'flex'
    includeSection.style.alignItems = 'flex-start'
    includeSection.style.gap = '0.5rem'
    includeSection.style.cursor = 'pointer'
    includeSection.style.userSelect = 'none'

    this.includeReferencedLocalFiles.type = 'checkbox'
    this.includeReferencedLocalFiles.checked = false

    const includeText = document.createElement('span')
    includeText.textContent = nls.localize(
      'rockit/packageRoCrate/includeExternalFiles',
      'Include referenced local files that are outside the RO-Crate folder',
    )

    includeSection.appendChild(this.includeReferencedLocalFiles)
    includeSection.appendChild(includeText)
    container.appendChild(includeSection)

    this.contentNode.appendChild(container)
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.radios[PackageRoCrateMode.Normal]?.focus()
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
      'rockit/packageRoCrate/saving',
      'Saving...',
    )

    try {
      await this.options.saveChanges()
    } catch (error) {
      console.error('Failed to save RO-Crate before packaging', error)
      this.saveError = nls.localize(
        'rockit/packageRoCrate/saveFailed',
        'Save failed: {0}',
        String(error),
      )
    } finally {
      this.saveInProgress = false
      this.saveChangesButton.disabled = false
      this.saveChangesButton.textContent = nls.localize(
        'rockit/packageRoCrate/save',
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
        'rockit/packageRoCrate/unsavedChanges',
        'RO-Crate metadata has unsaved changes. Save before packaging.',
      )

    if (this.acceptButton) {
      this.acceptButton.disabled = hasUnsavedChanges
    }
    this.update()
  }

  protected override async isValid(
    _value: PackageRoCrateOptions,
    _mode: DialogMode,
  ): Promise<string> {
    if (await this.options.hasUnsavedChanges()) {
      return nls.localize(
        'rockit/packageRoCrate/saveBeforePackaging',
        'Save RO-Crate metadata before packaging.',
      )
    }
    return ''
  }

  get value(): PackageRoCrateOptions {
    const mode = this.radios[PackageRoCrateMode.Clean]?.checked
      ? PackageRoCrateMode.Clean
      : PackageRoCrateMode.Normal
    return {
      mode,
      includeReferencedLocalFiles: this.includeReferencedLocalFiles.checked,
    }
  }
}
