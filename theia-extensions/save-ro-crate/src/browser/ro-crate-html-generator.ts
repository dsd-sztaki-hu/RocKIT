import { injectable } from '@theia/core/shared/inversify'
import { nls } from '@theia/core/lib/common'
import { RoCrateHtmlGenerator } from 'rockit-common/lib/browser'

type Entity = Record<string, any>

@injectable()
export class RoCrateHtmlGeneratorImpl implements RoCrateHtmlGenerator {
  public generate(crate: any): string {
    const entities: Entity[] = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
    const entityById = this.buildEntityIndex(entities)
    const inboundRefs = this.buildInboundReferenceIndex(entities, entityById)

    const mainEntity = entityById.get('./') ?? entityById.get('ro-crate-metadata.json')
    const localizedPreviewTitle = nls.localize(
      'rockit/roCratePreview/title',
      'RO-Crate Preview',
    )
    const previewTitle = this.escapeHtml(localizedPreviewTitle)
    const title = this.escapeHtml(String(mainEntity?.name ?? localizedPreviewTitle))
    const locale = nls.isSelectedLocale('hu') ? 'hu' : 'en'
    const downloadMetadata = this.escapeHtml(
      nls.localize(
        'rockit/roCratePreview/downloadMetadata',
        'Download metadata in JSON-LD format',
      ),
    )

    return `
<!DOCTYPE html>
<html lang="${locale}">
<head>
    <meta charset="utf-8">
    <title>${previewTitle}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; margin: 0; color: #24292f; line-height: 1.5; }
        .header { background: #f6f8fa; padding: 40px 20px; border-bottom: 1px solid #d0d7de; }
        .container { max-width: 1100px; margin: 0 auto; padding: 20px; }
        h1 { margin: 0 0 10px 0; font-size: 32px; font-weight: 600; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; table-layout: fixed; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #d0d7de; vertical-align: top; word-wrap: break-word; }
        th { width: 250px; color: #57606a; font-weight: 600; }
        .id-link { color: #0969da; text-decoration: none; }
        .id-link:hover { text-decoration: underline; }
        .entity-section { display: none; }
        .entity-section.active { display: block; }
        .breadcrumb { color: #0969da; font-size: 14px; font-weight: 600; margin-bottom: 8px; cursor: pointer; display: inline-block; }
        .breadcrumb:hover { text-decoration: underline; }
        ul { margin: 0; padding-left: 18px; }
        li { margin-bottom: 4px; }
        .reference-section { margin-top: 40px; border: 1px solid #d0d7de; border-radius: 6px; overflow: hidden; }
        .reference-header { background: #f6f8fa; padding: 12px; font-weight: 600; border-bottom: 1px solid #d0d7de; font-size: 14px; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <div class="container">
            <h1>${title}</h1>
            <a href="ro-crate-metadata.json" class="id-link">${downloadMetadata}</a>
        </div>
    </div>

    <div class="container">
        ${entities.map((entity) => this.renderEntity(entity, entityById, inboundRefs)).join('')}
    </div>

    <script>
        function navigate() {
            const hash = window.location.hash || '#./';
            const id = decodeURIComponent(hash.substring(1));

            document.querySelectorAll('.entity-section').forEach(function(section) {
                section.classList.remove('active');
            });

            const safeId = 'entity-' + btoa(id).replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
            const target = document.getElementById(safeId);
            if (target) {
                target.classList.add('active');
                window.scrollTo(0, 0);
            }
        }
        window.addEventListener('hashchange', navigate);
        window.addEventListener('load', navigate);
    </script>
</body>
</html>`
  }

  private buildEntityIndex(entities: Entity[]): Map<string, Entity> {
    const byId = new Map<string, Entity>()
    for (const entity of entities) {
      const id = typeof entity?.['@id'] === 'string' ? entity['@id'] : ''
      if (!id) {
        continue
      }
      byId.set(id, entity)
    }
    return byId
  }

  private buildInboundReferenceIndex(
    entities: Entity[],
    entityById: Map<string, Entity>,
  ): Map<string, Set<string>> {
    const inbound = new Map<string, Set<string>>()

    const addRef = (sourceId: string, targetId: string): void => {
      if (!targetId || sourceId === targetId || !entityById.has(targetId)) {
        return
      }
      let sources = inbound.get(targetId)
      if (!sources) {
        sources = new Set<string>()
        inbound.set(targetId, sources)
      }
      sources.add(sourceId)
    }

    const visit = (value: unknown, sourceId: string): void => {
      if (Array.isArray(value)) {
        for (const item of value) {
          visit(item, sourceId)
        }
        return
      }

      if (value && typeof value === 'object') {
        const objectValue = value as Record<string, unknown>
        const objectId = typeof objectValue['@id'] === 'string' ? objectValue['@id'] : ''
        if (objectId) {
          addRef(sourceId, objectId)
        }
        for (const nested of Object.values(objectValue)) {
          visit(nested, sourceId)
        }
        return
      }

      if (typeof value === 'string') {
        addRef(sourceId, value)
      }
    }

    for (const entity of entities) {
      const sourceId = typeof entity?.['@id'] === 'string' ? entity['@id'] : ''
      if (!sourceId) {
        continue
      }
      visit(entity, sourceId)
    }

    return inbound
  }

  private renderEntity(
    entity: Entity,
    entityById: Map<string, Entity>,
    inboundRefs: Map<string, Set<string>>,
  ): string {
    const id = typeof entity?.['@id'] === 'string' ? entity['@id'] : ''
    const safeId = `entity-${this.toHashSafeId(id)}`
    const title = this.escapeHtml(String(entity?.name ?? id))
    const keys = Object.keys(entity).filter((k) => k !== '@id')

    return `
        <div class="entity-section" id="${safeId}">
            <div class="breadcrumb" onclick="window.location.hash='#./'">${this.escapeHtml(
              nls.localize('rockit/roCratePreview/backToHome', '<- Back to Home'),
            )}</div>
            <h2>${title}</h2>
            <table>
                <tr>
                    <th>@id</th>
                    <td>${this.renderIdCell(id, entityById)}</td>
                </tr>
                ${keys
                  .map(
                    (key) => `
                    <tr>
                        <th>${this.escapeHtml(key)}</th>
                        <td>${this.renderValue(entity[key], entityById)}</td>
                    </tr>
                `,
                  )
                  .join('')}
            </table>
            ${this.renderReferences(id, inboundRefs, entityById)}
        </div>`
  }

  private renderIdCell(id: string, entityById: Map<string, Entity>): string {
    if (!id) {
      return ''
    }
    if (/^https?:\/\//.test(id)) {
      return this.createResolvableLink(id, entityById)
    }
    const escaped = this.escapeHtml(id)
    return `<a class="id-link" href="${escaped}" target="_blank" rel="noopener">${escaped}</a>`
  }

  private renderValue(value: unknown, entityById: Map<string, Entity>): string {
    if (Array.isArray(value)) {
      return `<ul>${value.map((item) => `<li>${this.renderValue(item, entityById)}</li>`).join('')}</ul>`
    }

    if (value && typeof value === 'object') {
      const objectValue = value as Record<string, unknown>
      const objectId = typeof objectValue['@id'] === 'string' ? objectValue['@id'] : ''
      if (objectId) {
        return this.createResolvableLink(objectId, entityById)
      }
      return this.escapeHtml(JSON.stringify(objectValue))
    }

    if (typeof value === 'string') {
      if (/^https?:\/\//.test(value) || entityById.has(value)) {
        return this.createResolvableLink(value, entityById)
      }
      return this.escapeHtml(value)
    }

    if (value === undefined || value === null) {
      return ''
    }

    return this.escapeHtml(String(value))
  }

  private createResolvableLink(id: string, entityById: Map<string, Entity>): string {
    const targetEntity = entityById.get(id)
    const displayName = this.escapeHtml(String(targetEntity?.name ?? id))
    const encodedId = encodeURIComponent(id)

    if (/^https?:\/\//.test(id) && !targetEntity) {
      const escapedUrl = this.escapeHtml(id)
      return `<a class="id-link" href="${escapedUrl}" target="_blank" rel="noopener">${displayName}</a>`
    }

    return `<a class="id-link" href="#${encodedId}">${displayName}</a>`
  }

  private renderReferences(
    currentId: string,
    inboundRefs: Map<string, Set<string>>,
    entityById: Map<string, Entity>,
  ): string {
    const sourceIds = inboundRefs.get(currentId)
    if (!sourceIds || sourceIds.size === 0) {
      return ''
    }

    const rows: string[] = []
    for (const sourceId of sourceIds) {
      const sourceEntity = entityById.get(sourceId)
      if (!sourceEntity) {
        continue
      }
      const type = this.escapeHtml(String(sourceEntity['@type'] ?? 'Entity'))
      const label = this.escapeHtml(String(sourceEntity.name ?? sourceId))
      rows.push(`
                    <tr>
                        <th>${type}</th>
                        <td><a class="id-link" href="#${encodeURIComponent(sourceId)}">${label}</a></td>
                    </tr>
                `)
    }

    if (rows.length === 0) {
      return ''
    }

    return `
        <div class="reference-section">
            <div class="reference-header">${this.escapeHtml(
              nls.localize(
                'rockit/roCratePreview/referencingItems',
                'Items that reference this one',
              ),
            )}</div>
            <table>
                ${rows.join('')}
            </table>
        </div>`
  }

  private toHashSafeId(id: string): string {
    return btoa(id).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
