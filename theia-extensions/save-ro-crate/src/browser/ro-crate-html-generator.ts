import { injectable } from '@theia/core/shared/inversify'

import { RoCrateHtmlGenerator } from 'aroma2-common/lib/browser';

@injectable()
export class RoCrateHtmlGeneratorImpl implements RoCrateHtmlGenerator {
  public generate(crate: any): string {
    const entities = crate['@graph'] || []
    const mainEntity = entities.find(
      (e: any) => e['@id'] === './' || e['@id'] === 'ro-crate-metadata.json',
    )

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>RO-Crate Preview</title>
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
            <h1>${mainEntity?.name || 'RO-Crate Preview'}</h1>
            <a href="ro-crate-metadata.json" class="id-link">💾 Download metadata in JSON-LD format</a>
        </div>
    </div>

    <div class="container">
        ${entities.map((entity: any) => this.renderEntity(entity, entities)).join('')}
    </div>

    <script>
        function navigate() {
            const hash = window.location.hash || '#./';
            const id = decodeURIComponent(hash.substring(1));
            
            document.querySelectorAll('.entity-section').forEach(s => s.classList.remove('active'));
            
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

  private renderEntity(entity: any, allEntities: any[]): string {
    const id = entity['@id']
    const safeId =
      'entity-' + btoa(id).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    const keys = Object.keys(entity).filter((k) => k !== '@id')

    return `
        <div class="entity-section" id="${safeId}">
            <div class="breadcrumb" onclick="window.location.hash='#./'">← Back to Home</div>
            <h2>${entity.name || id}</h2>
            <table>
                <tr>
                    <th>@id</th>
                    <td><a class="id-link" href="${id}" target="_blank">${id}</a></td>
                </tr>
                ${keys
                  .map(
                    (key) => `
                    <tr>
                        <th>${key}</th>
                        <td>${this.renderValue(entity[key], allEntities)}</td>
                    </tr>
                `,
                  )
                  .join('')}
            </table>
            ${this.renderReferences(id, allEntities)}
        </div>`
  }

  private renderValue(value: any, allEntities: any[]): string {
    if (Array.isArray(value)) {
      return `<ul>${value.map((v) => `<li>${this.renderValue(v, allEntities)}</li>`).join('')}</ul>`
    }

    if (value && typeof value === 'object' && value['@id']) {
      return this.createResolvableLink(value['@id'], allEntities)
    }

    if (typeof value === 'string' && /^https?:\/\//.test(value)) {
      return this.createResolvableLink(value, allEntities)
    }

    return value
  }

  private createResolvableLink(id: string, allEntities: any[]): string {
    const targetEntity = allEntities.find((e) => e['@id'] === id)
    const displayName = targetEntity?.name || id

    const isExternal = /^https?:\/\//.test(id)

    if (isExternal) {
      if (targetEntity) {
        return `<a class="id-link" href="#${id}">${displayName}</a>`
      } else {
        return `<a class="id-link" href="${id}" target="_blank" rel="noopener">${displayName}</a>`
      }
    }

    return `<a class="id-link" href="#${id}">${displayName}</a>`
  }

  private renderReferences(currentId: string, allEntities: any[]): string {
    const refs = allEntities.filter(
      (e) => JSON.stringify(e).includes(`"@id":"${currentId}"`) && e['@id'] !== currentId,
    )

    if (refs.length === 0) return ''

    return `
        <div class="reference-section">
            <div class="reference-header">Items that reference this one</div>
            <table>
                ${refs
                  .map(
                    (r) => `
                    <tr>
                        <th>${r['@type'] || 'Entity'}</th>
                        <td><a class="id-link" href="#${r['@id']}">${r.name || r['@id']}</a></td>
                    </tr>
                `,
                  )
                  .join('')}
            </table>
        </div>`
  }
}
