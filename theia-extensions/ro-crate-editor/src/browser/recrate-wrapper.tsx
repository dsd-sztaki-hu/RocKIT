import { DescriboCrateBuilder } from '@arpproject/recrate'
import * as React from 'react'
import 'allotment/dist/style.css'

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
  const containerRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    requestAnimationFrame(() => {
      containerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
      containerRef.current
        ?.closest('.rocrate-editor')
        ?.scrollTo({ top: 0, behavior: 'auto' })
      window.scrollTo({ top: 0, behavior: 'auto' })
    })
  }, [entityId])

  const handleNavigationWrapper = React.useCallback(
    (entity: any) => {
      const nextId = entity?.['@id']
      if (!nextId || nextId === entityId) {
        return
      }
      onNavigation(entity)
    },
    [onNavigation, entityId],
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
    <div ref={containerRef}>
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
