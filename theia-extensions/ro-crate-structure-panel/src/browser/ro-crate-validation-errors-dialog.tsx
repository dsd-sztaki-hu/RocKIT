// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import { nls } from '@theia/core/lib/common/nls'
import * as React from 'react'
import {
  localizeRoCrateEntityType,
  localizeValidationErrorMessage,
} from 'rockit-common/lib/browser'

type ValidationError = {
  entityId?: string
  entityType?: string
  fieldName?: string
  fieldLabel?: string
  error?: string
  error_hu?: string
}

const DIALOG_ERROR_ROW_HEIGHT = 50
const DIALOG_ERROR_ROW_GAP = 8
const DIALOG_ERROR_OVERSCAN = 8

const getErrorKey = (error: ValidationError, index: number): string => [
  error.entityType ?? '',
  error.entityId ?? '',
  error.fieldName ?? '',
  error.fieldLabel ?? '',
  error.error ?? '',
  error.error_hu ?? '',
  index,
].join(':')

const ValidationErrorDialogList = ({
  errors,
  onSelect,
}: {
  errors: ValidationError[]
  onSelect: (error: ValidationError) => void
}) => {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [viewportHeight, setViewportHeight] = React.useState(360)

  React.useLayoutEffect(() => {
    const node = viewportRef.current
    if (!node) {
      return
    }

    const updateHeight = () => {
      setViewportHeight(node.clientHeight || 360)
    }
    updateHeight()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeight)
      return () => window.removeEventListener('resize', updateHeight)
    }

    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const totalHeight = errors.length * DIALOG_ERROR_ROW_HEIGHT
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / DIALOG_ERROR_ROW_HEIGHT) - DIALOG_ERROR_OVERSCAN,
  )
  const visibleCount =
    Math.ceil(viewportHeight / DIALOG_ERROR_ROW_HEIGHT) + DIALOG_ERROR_OVERSCAN * 2
  const endIndex = Math.min(errors.length, startIndex + visibleCount)
  const visibleErrors = errors.slice(startIndex, endIndex)

  return (
    <div
      ref={viewportRef}
      className="ro-crate-validation-dialog-list"
      onScroll={(event: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(event.currentTarget.scrollTop)
      }}
    >
      <div
        className="ro-crate-validation-dialog-spacer"
        style={{ height: totalHeight }}
      >
        {visibleErrors.map((error, visibleIndex) => {
          const index = startIndex + visibleIndex
          const entityType = error.entityType
            ? localizeRoCrateEntityType(error.entityType)
            : nls.localize('rockit/structurePanel/unknown', 'Unknown')
          const entityId = error.entityId ?? nls.localize(
            'rockit/structurePanel/unknown',
            'Unknown',
          )
          const field = error.fieldLabel ?? error.fieldName ?? nls.localize(
            'rockit/structurePanel/unknownField',
            'Unknown field',
          )
          const message = localizeValidationErrorMessage(error) ?? nls.localize(
            'rockit/structurePanel/unknownError',
            'Unknown error',
          )
          const canOpen = Boolean(error.entityId)
          return (
            <button
              key={getErrorKey(error, index)}
              className="ro-crate-validation-dialog-item"
              type="button"
              style={{
                height: DIALOG_ERROR_ROW_HEIGHT - DIALOG_ERROR_ROW_GAP,
                transform: `translateY(${index * DIALOG_ERROR_ROW_HEIGHT}px)`,
              }}
              onClick={() => onSelect(error)}
              disabled={!canOpen}
            >
              <span className="ro-crate-validation-dialog-item-heading">
                <span className="ro-crate-validation-dialog-item-type">
                  {entityType}
                </span>
                <span className="ro-crate-validation-dialog-item-id">{entityId}</span>
              </span>
              <span className="ro-crate-validation-dialog-item-field" title={field}>{field}</span>
              <span className="ro-crate-validation-dialog-item-message" title={message}>
                {message}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export class RoCrateValidationErrorsDialog extends ReactDialog<string> {
  constructor(
    private readonly errors: ValidationError[],
    private readonly onSelectEntity: (entityId: string) => void,
    private readonly onOpenSchemaValidator: () => void,
  ) {
    super({
      title: nls.localize(
        'rockit/structurePanel/errorsTitle',
        'Errors in RO-Crate',
      ),
    })
    this.appendCloseButton(nls.localize('rockit/structurePanel/close', 'Close'))
  }

  protected render(): React.ReactNode {
    return (
      <div className="ro-crate-validation-dialog-body">
        <div className="ro-crate-validation-dialog-info">
          <div className="ro-crate-validation-dialog-info-text">
            {nls.localize(
              'rockit/structurePanel/errorsDescription',
              'Open the docked validation error list for easier review and more details.',
            )}
          </div>
          <button
            className="ro-crate-validation-dialog-info-button"
            type="button"
            onClick={() => {
              this.onOpenSchemaValidator()
              this.close()
            }}
          >
            {nls.localize(
              'rockit/structurePanel/openSchemaValidator',
              'Open Validation Errors',
            )}
          </button>
        </div>
        {this.errors.length === 0 ? (
          <p className="ro-crate-validation-dialog-empty">
            {nls.localize(
              'rockit/structurePanel/noValidationErrors',
              'No validation errors.',
            )}
          </p>
        ) : (
          <ValidationErrorDialogList
            errors={this.errors}
            onSelect={(error) => {
              if (error.entityId) {
                this.onSelectEntity(error.entityId)
                this.close()
              }
            }}
          />
        )}
      </div>
    )
  }

  get value(): string {
    return ''
  }
}
