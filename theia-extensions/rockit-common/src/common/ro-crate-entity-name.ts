export interface MissingRoCrateEntityName {
    graphIndex: number
    entityId?: string
    entityType?: string
    generatedName?: string
}

export function isMissingRoCrateEntityName(value: unknown): boolean {
    if (!value) {
        return true
    }
    if (typeof value === 'string') {
        return value.trim().length === 0
    }
    if (Array.isArray(value)) {
        return value.map(entry => String(entry ?? '')).join(' ').trim().length === 0
    }
    return false
}

export function generatedRoCrateEntityName(entityId: unknown): string | undefined {
    if (typeof entityId !== 'string' || entityId.trim().length === 0) {
        return undefined
    }
    const generatedName = entityId.replace(/^#/, '')
    return generatedName.trim().length > 0 ? generatedName : undefined
}

export function findMissingRoCrateEntityNames(
    crate: Record<string, any> | undefined,
): MissingRoCrateEntityName[] {
    const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
    const missing: MissingRoCrateEntityName[] = []

    graph.forEach((entity: unknown, graphIndex: number) => {
        if (!entity || typeof entity !== 'object') {
            return
        }
        const record = entity as Record<string, unknown>
        if (!isMissingRoCrateEntityName(record.name)) {
            return
        }
        const entityId =
            typeof record['@id'] === 'string' && record['@id'].trim().length > 0
                ? record['@id']
                : undefined
        const rawType = Array.isArray(record['@type'])
            ? record['@type'][0]
            : record['@type']
        missing.push({
            graphIndex,
            entityId,
            entityType: typeof rawType === 'string' ? rawType : undefined,
            generatedName: generatedRoCrateEntityName(entityId),
        })
    })

    return missing
}

export function repairMissingRoCrateEntityNames(
    crate: Record<string, any>,
    missing: MissingRoCrateEntityName[] = findMissingRoCrateEntityNames(crate),
): Record<string, any> {
    if (missing.length === 0) {
        return crate
    }

    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    const repairByIndex = new Map(
        missing
            .filter(issue => issue.generatedName !== undefined)
            .map(issue => [issue.graphIndex, issue.generatedName as string]),
    )

    return {
        ...crate,
        '@graph': graph.map((entity: unknown, graphIndex: number) => {
            const generatedName = repairByIndex.get(graphIndex)
            if (
                generatedName === undefined ||
                !entity ||
                typeof entity !== 'object'
            ) {
                return entity
            }
            return {
                ...(entity as Record<string, unknown>),
                name: generatedName,
            }
        }),
    }
}
