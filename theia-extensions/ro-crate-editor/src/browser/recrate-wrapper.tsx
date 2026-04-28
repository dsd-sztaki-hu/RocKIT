import { DescriboCrateBuilder } from '@arpproject/recrate'
import * as React from 'react'

import '../../src/browser/style/recrate-scoped.css'
import '../../src/browser/style/recrate-dark-overrides.css'

type EntityOverviewDropPayload = {
    entityIds?: string[]
    entityNames?: string[]
    entityTypes?: string[][]
    source?: 'entities-overview'
}

type SingleEntityDropPayload = {
    entityId: string
    entityName?: string
    entityTypes?: string[]
    source?: 'entities-overview'
}

const ENTITIES_OVERVIEW_DND_MIME = 'application/x-aroma-entity-drag'

export const DescriboCrateBuilderWrapper = ({
                                                crate,
                                                profile,
                                                entityId,
                                                instanceId,
                                                onSaveCrate,
                                                onNavigation,
                                                onOpenSchemaManager,
                                                onRemoveProfile,
                                                onDropEntityToHasPart,
                                            }: {
    crate: Record<string, any> | undefined
    profile: Record<string, any> | undefined
    entityId: string | undefined
    profileKey: number
    instanceId: string
    onSaveCrate: (data: any) => void
    onNavigation: (entity: any) => void
    onOpenSchemaManager: (requested: boolean) => void
    onRemoveProfile: (tabData: any) => void
    onDropEntityToHasPart: (payload: SingleEntityDropPayload, destinationEntityId: string) => Promise<void>
}) => {
    const [currentEntityId, setCurrentEntityId] = React.useState<string | undefined>(entityId)
    const [loading, setLoading] = React.useState<boolean>(false)
    const lastNavTarget = React.useRef<string | undefined>(undefined)
    const transitionTimeoutRef = React.useRef<any>(null)
    const containerRef = React.useRef<HTMLDivElement>(null)
    const [dropState, setDropState] = React.useState<'idle' | 'valid' | 'invalid'>('idle')
    const [dropMessage, setDropMessage] = React.useState<string>('')

    const getEntityById = React.useCallback((id: string) => {
        const graph = Array.isArray(crate?.['@graph']) ? (crate['@graph'] as Record<string, any>[]) : []
        return graph.find((entry) => String(entry?.['@id']) === id)
    }, [crate])

    const getEntityTypeNames = React.useCallback((entity: Record<string, any> | undefined): string[] => {
        const raw = entity?.['@type']
        const list = Array.isArray(raw) ? raw : [raw]
        return list
            .map((value) => String(value ?? '').trim())
            .filter(Boolean)
            .map((value) => {
                const tail = value.split(/[\/#]/).pop() || value
                return tail.toLowerCase()
            })
    }, [])

    const parsePayload = React.useCallback((event: DragEvent): EntityOverviewDropPayload | undefined => {
        const raw =
            event.dataTransfer?.getData(ENTITIES_OVERVIEW_DND_MIME) ||
            event.dataTransfer?.getData('text/plain')

        if (raw) {
            try {
                const parsed = JSON.parse(raw) as EntityOverviewDropPayload
                if (parsed?.source === 'entities-overview') {
                    return parsed
                }
            } catch (error) {
                console.warn('[DND][Recrate] parsePayload JSON parse failed', error)
            }
        }

        const globalPayload = (globalThis as any).__aromaEntityDragPayload as
            | EntityOverviewDropPayload
            | undefined

        if (globalPayload?.source === 'entities-overview') {
            return globalPayload
        }

        return undefined
    }, [])

    React.useEffect(() => {
        if (loading) {
            if (entityId) {
                setLoading(false)
            }
        }
    }, [entityId, loading, currentEntityId])

    React.useEffect(() => {
        requestAnimationFrame(() => {
            containerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
            containerRef.current?.closest('.rocrate-editor')?.scrollTo({ top: 0, behavior: 'auto' })
            window.scrollTo({ top: 0, behavior: 'auto' })
        })
    }, [currentEntityId])

    React.useEffect(() => {
        const node = containerRef.current
        if (!node) return

        const clearState = () => {
            setDropState('idle')
            setDropMessage('')
        }

        const onDragOver = (event: DragEvent) => {
            // 🔑 ALWAYS allow drop
            event.preventDefault()

            const payload = parsePayload(event)

            const targetEntity = currentEntityId ? getEntityById(currentEntityId) : undefined
            const targetTypes = getEntityTypeNames(targetEntity)
            const targetValid = targetTypes.includes('dataset')

            if (!payload?.entityIds || payload.entityIds.length === 0) {
                setDropState('invalid')
                setDropMessage('Invalid drag payload')
                return
            }

            if (targetValid) {
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = 'copy'
                }
                setDropState('valid')
                setDropMessage('Drop to add this entity to hasPart')
            } else {
                setDropState('invalid')
                setDropMessage('Drop disabled: destination must be Dataset')
            }
        }

        const onDragLeave = (event: DragEvent) => {
            const next = event.relatedTarget as Node | null
            if (next && node.contains(next)) return
            clearState()
        }

        const onDrop = async (event: DragEvent) => {
            event.preventDefault()

            const payload = parsePayload(event)
            if (!payload?.entityIds || payload.entityIds.length === 0) {
                setDropState('invalid')
                setDropMessage('Drop payload was not available. Please drag again.')
                return
            }

            const destinationEntityId = currentEntityId
            if (!destinationEntityId) {
                setDropState('invalid')
                setDropMessage('No active destination entity')
                return
            }

            const targetEntity = getEntityById(destinationEntityId)
            const targetTypes = getEntityTypeNames(targetEntity)
            const targetValid = targetTypes.includes('dataset')

            if (!targetValid) {
                setDropState('invalid')
                setDropMessage('Drop disabled: destination must be Dataset')
                return
            }

            try {
                if (!payload.entityIds || !payload.entityNames || !payload.entityTypes) {
                    setDropState('invalid')
                    setDropMessage('Drop payload was not available. Please drag again.')
                    return
                }
                
                for (let i = 0; i < payload.entityIds.length; i++) {
                    await onDropEntityToHasPart(
                        {
                            entityId: payload.entityIds[i],
                            entityName: payload.entityNames?.[i],
                            entityTypes: payload.entityTypes?.[i] ?? [],
                            source: 'entities-overview',
                        },
                        destinationEntityId,
                    )
                }
                setDropState('idle')
                setDropMessage('')
            } catch (error: any) {
                setDropState('invalid')
                setDropMessage(error?.message || 'Failed to add dropped entity to hasPart')
            }
        }

        node.addEventListener('dragover', onDragOver)
        node.addEventListener('dragleave', onDragLeave)
        node.addEventListener('drop', onDrop)
        node.addEventListener('dragend', clearState)

        return () => {
            node.removeEventListener('dragover', onDragOver)
            node.removeEventListener('dragleave', onDragLeave)
            node.removeEventListener('drop', onDrop)
            node.removeEventListener('dragend', clearState)
        }
    }, [
        currentEntityId,
        getEntityById,
        getEntityTypeNames,
        onDropEntityToHasPart,
        parsePayload,
    ])

    const handleNavigationWrapper = React.useCallback(
        (entity: any) => {
            const nextId = entity && entity['@id']
            if (!nextId || nextId === currentEntityId) return

            lastNavTarget.current = nextId
            setLoading(true)
            setCurrentEntityId(nextId)

            if (transitionTimeoutRef.current) {
                clearTimeout(transitionTimeoutRef.current)
            }

            transitionTimeoutRef.current = setTimeout(() => {
                if (lastNavTarget.current) {
                    setLoading(false)
                    lastNavTarget.current = undefined
                }
            }, 5000)

            onNavigation(entity)
        },
        [currentEntityId, onNavigation],
    )

    const handleAddNewProfileRequest = React.useCallback(
        (requested: boolean) => {
            if (requested) {
                onOpenSchemaManager(requested)
            }
        },
        [onOpenSchemaManager],
    )

    return (
        <div
            ref={containerRef}
            className={`recrate-scope recrate-drop-zone${dropState === 'valid' ? ' is-valid' : ''}${dropState === 'invalid' ? ' is-invalid' : ''
                }`}
        >
            {dropState !== 'idle' && (
                <div className={`recrate-drop-indicator ${dropState === 'valid' ? 'is-valid' : 'is-invalid'}`}>
                    {dropMessage}
                </div>
            )}

            {loading && <div style={{ padding: '0.5rem', color: '#888' }}>Loading entity...</div>}

            <DescriboCrateBuilder
                crate={crate}
                profile={profile}
                stateScopeKey={`theia:${instanceId}`}
                onAddNewProfileRequest={handleAddNewProfileRequest}
                onRemoveProfile={onRemoveProfile}
                entityId={entityId}
                onSaveCrate={onSaveCrate}
                onNavigation={handleNavigationWrapper}
                onWarning={(w: any) => console.log('warning', w)}
                onError={(e: any) => console.log('error', e)}
                enableReverseLinkBrowser={true}
                enableBrowseEntities={false}
                enableContextEditor={false}
                enableCratePreview={false}
                enableUrlMarkup={false}
                language={'en'}
                readonly={loading}
                tabLocation={'left'}
                showControls={true}
                resetTabOnEntityChange={false}
                resetTabOnProfileChange={false}
            />
        </div>
    )
}