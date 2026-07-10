import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import * as React from '@theia/core/shared/react'
import type { MissingRoCrateEntityName } from 'rockit-common/lib/common/ro-crate-entity-name'

const PREVIEW_LIMIT = 8

function humanizeEntityLabel(issue: MissingRoCrateEntityName): string {
    if (issue.entityId === 'ro-crate-metadata.json') {
        return 'RO-Crate metadata'
    }

    const typeName = issue.entityType?.split(/[\/#]/).pop() ?? ''
    if (typeName.toLowerCase() === 'datasetcontact') {
        return 'Point of contact'
    }
    if (!typeName) {
        return 'Entity'
    }

    const spaced = typeName
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .trim()
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

export class RoCrateMissingNamesDialog extends ReactDialog<boolean> {
    protected readonly canRepairAll: boolean

    constructor(protected readonly missingNames: MissingRoCrateEntityName[]) {
        super({ title: 'Missing entity names' })
        this.title.closable = false
        this.canRepairAll = missingNames.every(issue => issue.generatedName !== undefined)
        const generateButton = this.appendAcceptButton('Generate missing names')
        generateButton.disabled = !this.canRepairAll
        this.appendCloseButton('Close RO-Crate')
    }

    get value(): boolean {
        return true
    }

    protected render(): React.ReactNode {
        const hiddenCount = Math.max(0, this.missingNames.length - PREVIEW_LIMIT)
        const entityLabel = this.missingNames.length === 1 ? 'entity does' : 'entities do'
        const visibleEntities = this.missingNames.slice(0, PREVIEW_LIMIT)

        return (
            <div style={{ maxWidth: 560 }}>
                <p>
                    <strong>{this.missingNames.length} {entityLabel} not have the required <code>name</code> property.</strong>
                </p>
                {this.canRepairAll ? (
                    <p>
                        RocKIT can set the missing names from the entity identifiers. This
                        will update <code>ro-crate-metadata.json</code>.
                    </p>
                ) : (
                    <p>
                        At least one affected entity has no usable identifier, so RocKIT
                        cannot generate all missing names. The RO-Crate cannot be edited.
                    </p>
                )}
                <div style={{ fontWeight: 600, marginTop: 18 }}>
                    Entities changed:
                </div>
                <ul style={{ marginBottom: 8, marginTop: 8, maxHeight: 220, overflow: 'auto' }}>
                    {visibleEntities.map(issue => (
                        <li key={issue.graphIndex}>{humanizeEntityLabel(issue)}</li>
                    ))}
                    {hiddenCount > 0 && (
                        <li>And {hiddenCount} more…</li>
                    )}
                </ul>
                {this.canRepairAll && (
                    <p>
                        If you do not want RocKIT to make this change, close the RO-Crate.
                    </p>
                )}
            </div>
        )
    }
}
