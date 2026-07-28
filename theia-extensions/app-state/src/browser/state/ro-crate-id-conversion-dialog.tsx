import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import { nls } from '@theia/core/lib/common/nls'
import { injectable } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'

@injectable()
export class RoCrateIdConversionDialog extends ReactDialog<boolean> {
  constructor() {
    super({
      title: nls.localize(
        'rockit/appState/idConversion/title',
        'Convert RO-Crate metadata',
      ),
    })
    this.appendAcceptButton(nls.localize(
      'rockit/appState/idConversion/convert',
      'Convert to workspace-relative IDs',
    ))
    this.appendCloseButton(nls.localize(
      'rockit/appState/idConversion/keep',
      'Keep existing metadata',
    ))
  }

  public get value(): boolean {
    return true
  }

  protected render(): React.ReactNode {
    return (
      <div>
        <p>
          {nls.localize(
            'rockit/appState/idConversion/identifierExplanation',
            'The RO-Crate metadata uses entity identifiers like {0} instead of {1} paths.',
            'name',
            'file://./…',
          )}
        </p>
        <p>
          {nls.localize(
            'rockit/appState/idConversion/rewriteExplanation',
            'Converting the metadata will rewrite the entities so their {0} values match the current workspace layout.',
            '@id',
          )}
        </p>
        <p>
          {nls.localize(
            'rockit/appState/idConversion/mappingExplanation',
            'ARP file identifiers will be stored in the workspace export mapping so future updates can target the original remote dataset.',
          )}
        </p>
        <p>
          {nls.localize(
            'rockit/appState/idConversion/question',
            'This keeps the file explorer and other tools synchronized. Would you like to convert now?',
          )}
        </p>
      </div>
    )
  }
}
