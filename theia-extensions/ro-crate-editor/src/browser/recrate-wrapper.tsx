import { DescriboCrateBuilder } from '@arpproject/recrate'
import * as React from 'react'

export const DescriboCrateBuilderWrapper = ({
  crate,
  profile,
  entityId,
  onSaveCrate,
  onNavigation,
  onOpenSchemaManager,
}: {
  crate: Record<string, any> | undefined
  profile: Record<string, any> | undefined
  entityId: string | undefined
  onSaveCrate: (data: any) => void
  onNavigation: (entity: any) => void
  onOpenSchemaManager: (requested: boolean) => void
}) => {
  const [currentEntityId, setCurrentEntityId] = React.useState<string | undefined>(
    entityId,
  )
  const [loading, setLoading] = React.useState<boolean>(false)
  const lastNavTarget = React.useRef<string | undefined>(undefined)
  // const prevEntityIdRef = React.useRef<string | undefined>(undefined)
  const transitionTimeoutRef = React.useRef<any>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  /*React.useEffect(() => {
    if (prevEntityIdRef.current !== currentEntityId) {
      console.log('entityId transition', {
        prev: prevEntityIdRef.current,
        next: currentEntityId,
      })
      prevEntityIdRef.current = currentEntityId
    }
  }, [currentEntityId])*/

  /*React.useEffect(() => {
        if (loading) {
            if (entityId && entityId === lastNavTarget.current) {
                console.log("navigation settled", { expected: lastNavTarget.current, actual: entityId });
                setCurrentEntityId(entityId);
                setLoading(false);
                lastNavTarget.current = undefined;
                if (transitionTimeoutRef.current) {
                    clearTimeout(transitionTimeoutRef.current);
                    transitionTimeoutRef.current = null;
                }
            } else if (entityId && lastNavTarget.current && entityId !== lastNavTarget.current) {
                console.warn("mismatch during navigation", { expected: lastNavTarget.current, actual: entityId });
            }
        } else {
            if (entityId !== currentEntityId) {
                setCurrentEntityId(entityId);
            }
        }
    }, [entityId, loading]);*/

  /*React.useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current)
        transitionTimeoutRef.current = null
      }
      lastNavTarget.current = undefined
    }
  }, [])*/
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
      if (!nextId) return
      if (nextId === currentEntityId) return
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

  return (
    <div ref={containerRef}>
      {loading && (
        <div style={{ padding: '0.5rem', color: '#888' }}>Loading entity...</div>
      )}
      <DescriboCrateBuilder
        key={currentEntityId}
        crate={crate}
        profile={profile}
        onAddNewProfileRequest={handleAddNewProfileRequest}
        entityId={currentEntityId}
        onSaveCrate={onSaveCrate}
        onNavigation={handleNavigationWrapper}
        onWarning={(w: any) => console.log('warning', w)}
        onError={(e: any) => console.log('error', e)}
        enableReverseLinkBrowser={true}
        enableBrowseEntities={false}
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
