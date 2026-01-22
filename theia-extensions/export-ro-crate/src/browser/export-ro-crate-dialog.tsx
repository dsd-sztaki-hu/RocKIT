import { Message } from '@lumino/messaging'
import { AbstractDialog } from '@theia/core/lib/browser/dialogs'

export enum ExportRoCrateMode {
  Normal = 'normal',
  Clean = 'clean',
}

const MODE_DETAILS: Record<ExportRoCrateMode, { label: string; description: string }> = {
  [ExportRoCrateMode.Normal]: {
    label: 'Normal Export',
    description:
      'Exports the entire workspace as a ZIP, including all files and folders.',
  },
  [ExportRoCrateMode.Clean]: {
    label: 'Clean RO-Crate Export',
    description:
      'Exports only the RO-Crate structure, including files explicitly listed in ro-crate-metadata.json.',
  },
}

export class ExportRoCrateDialog extends AbstractDialog<ExportRoCrateMode> {
  protected readonly radios: Record<ExportRoCrateMode, HTMLInputElement> = {
    [ExportRoCrateMode.Normal]: document.createElement('input'),
    [ExportRoCrateMode.Clean]: document.createElement('input'),
  }

  constructor() {
    super({ title: 'Export RO-Crate' })

    this.appendCloseButton()
    this.appendAcceptButton('Export')

    const container = document.createElement('div')
    container.classList.add('export-ro-crate-dialog')
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.gap = '1rem'

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

    this.contentNode.appendChild(container)
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.radios[ExportRoCrateMode.Normal]?.focus()
  }

  get value(): ExportRoCrateMode {
    return this.radios[ExportRoCrateMode.Clean]?.checked
      ? ExportRoCrateMode.Clean
      : ExportRoCrateMode.Normal
  }
}
