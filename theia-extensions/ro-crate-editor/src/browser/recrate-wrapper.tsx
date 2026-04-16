import { DescriboCrateBuilder } from '@arpproject/recrate'
import * as React from 'react'

import '../../src/browser/style/recrate-scoped.css'
import '../../src/browser/style/recrate-dark-overrides.css'

export const DescriboCrateBuilderWrapper = ({
                                                crate,
                                                profile,
                                                entityId,
                                                profileKey,
                                                onSaveCrate,
                                                onNavigation,
                                                onOpenSchemaManager,
                                                onRemoveProfile,
                                            }: {
    crate: Record<string, any> | undefined
    profile: Record<string, any> | undefined
    entityId: string | undefined
    profileKey: number
    onSaveCrate: (data: any) => void
    onNavigation: (entity: any) => void
    onOpenSchemaManager: (requested: boolean) => void
    onRemoveProfile: (tabData: any) => void
}) => {
    const [currentEntityId, setCurrentEntityId] = React.useState<string | undefined>(
        entityId,
    )
    const [loading, setLoading] = React.useState<boolean>(false)
    const lastNavTarget = React.useRef<string | undefined>(undefined)
    const transitionTimeoutRef = React.useRef<any>(null)
    const containerRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        if (loading) {
            if (entityId && entityId === lastNavTarget.current) {
                setCurrentEntityId(entityId)
                setLoading(false)
                lastNavTarget.current = undefined
                if (transitionTimeoutRef.current) {
                    clearTimeout(transitionTimeoutRef.current)
                    transitionTimeoutRef.current = null
                }
            }
        } else if (entityId !== currentEntityId) {
            setCurrentEntityId(entityId)
        }
    }, [entityId, loading, currentEntityId])

    React.useEffect(() => {
        requestAnimationFrame(() => {
            containerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
            containerRef.current
                ?.closest('.rocrate-editor')
                ?.scrollTo({ top: 0, behavior: 'auto' })
            window.scrollTo({ top: 0, behavior: 'auto' })
        })
    }, [currentEntityId])

    const handleNavigationWrapper = React.useCallback(
        (entity: any) => {
            const nextId = entity && entity['@id']
            console.log('navigation', { entity })
            if (!nextId || nextId === currentEntityId) {
                return
            }
            lastNavTarget.current = nextId
            setLoading(true)
            setCurrentEntityId(nextId)
            if (transitionTimeoutRef.current) {
                clearTimeout(transitionTimeoutRef.current)
                transitionTimeoutRef.current = null
            }
            transitionTimeoutRef.current = setTimeout(() => {
                if (lastNavTarget.current) {
                    console.warn('navigation timeout', {
                        expected: lastNavTarget.current,
                        actual: entityId,
                    })
                    setLoading(false)
                    lastNavTarget.current = undefined
                }
            }, 5000)
            onNavigation(entity)
        },
        [currentEntityId, onNavigation, entityId],
    )

    const handleAddNewProfileRequest = React.useCallback(
        (requested: boolean) => {
            if (requested) {
                onOpenSchemaManager(requested)
            }
        },
        [onOpenSchemaManager],
    )

    console.log('DescriboCrateBuilderWrapper', { crate, profile, entityId })
    return (
        <div ref={containerRef} className="recrate-scope">
            {loading && (
                <div style={{ padding: '0.5rem', color: '#888' }}>Loading entity...</div>
            )}
            <DescriboCrateBuilder
                crate={crate}
                profile={profile}
                onAddNewProfileRequest={handleAddNewProfileRequest}
                onRemoveProfile={onRemoveProfile}
                entityId={currentEntityId}
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
                readonly={loading ? true : false}
                tabLocation={'left'}
                showControls={true}
                resetTabOnEntityChange={false}
                resetTabOnProfileChange={false}
            />
        </div>
    )
}