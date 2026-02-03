import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import { nls } from '@theia/core/lib/common/nls'
import { injectable } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'

@injectable()
export class RoCrateIdConversionDialog extends ReactDialog<boolean> {
  constructor() {
    super({
      title: nls.localizeByDefault('Convert RO-Crate metadata'),
    })
    this.appendAcceptButton(nls.localizeByDefault('Convert to workspace-relative IDs'))
    this.appendCloseButton(nls.localizeByDefault('Keep existing metadata'))
  }

  public get value(): boolean {
    return true
  }

  protected render(): React.ReactNode {
    return (
      <div>
        <p>
          The RO-Crate metadata uses entity identifiers like <code>name</code> instead of{' '}
          <code>file://./…</code> paths.
        </p>
        <p>
          Converting the metadata will rewrite the entities so their <code>@id</code>{' '}
          values match the current workspace layout.
        </p>
        <p>
          This keeps the file explorer and other tools synchronized. Would you like to
          convert now?
        </p>
      </div>
    )
  }
}
