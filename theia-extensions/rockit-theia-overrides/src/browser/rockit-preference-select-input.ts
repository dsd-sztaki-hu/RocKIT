// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { PreferenceUtils, nls } from '@theia/core'
import { escapeInvisibleChars } from '@theia/core/lib/common/strings'
import { SelectOption } from '@theia/core/lib/browser/widgets/select-component'
import {
  PreferenceSelectInputRenderer,
} from '@theia/preferences/lib/browser/views/components/preference-select-input'
import {
  PreferenceLeafNodeRendererContribution,
  PreferenceNodeRendererContribution,
} from '@theia/preferences/lib/browser/views/components/preference-node-renderer-creator'
import { PreferenceNodeRenderer } from '@theia/preferences/lib/browser/views/components/preference-node-renderer'
import { Preference } from '@theia/preferences/lib/browser/util/preference-types'
import { injectable, interfaces } from '@theia/core/shared/inversify'

/** Adds display labels for technical enum values without changing saved values. */
@injectable()
export class RockitPreferenceSelectInputRenderer extends PreferenceSelectInputRenderer {
  protected override updateSelectOptions(): void {
    const options: SelectOption[] = []
    const values = this.enumValues
    const preferenceData = this.preferenceNode.preference.data

    for (let index = 0; index < values.length; index++) {
      const value = values[index]
      const stringValue = `${value}`
      const originalLabel = preferenceData.enumItemLabels?.[index] ?? stringValue
      let enumDescription = preferenceData.enumDescriptions?.[index]
      let markdown = false
      const markdownDescription = preferenceData.markdownEnumDescriptions?.[index]
      if (markdownDescription) {
        enumDescription = this.markdownRenderer.renderInline(markdownDescription)
        markdown = true
      }

      options.push({
        label: escapeInvisibleChars(nls.localize(
          `rockit/settings/value/${stringValue}`,
          originalLabel,
        )),
        value: stringValue,
        detail: PreferenceUtils.deepEqual(preferenceData.default, value)
          ? nls.localize('rockit/settings/value/default', 'default')
          : undefined,
        description: enumDescription,
        markdown,
      })
    }

    this.selectOptions = options
  }
}

@injectable()
export class RockitPreferenceSelectInputRendererContribution
  extends PreferenceLeafNodeRendererContribution
  implements PreferenceNodeRendererContribution
{
  readonly id = 'rockit-preference-select-input-renderer'

  canHandleLeafNode(node: Preference.LeafNode): number {
    return node.preference.data.enum ? 4 : 0
  }

  createLeafNodeRenderer(container: interfaces.Container): PreferenceNodeRenderer {
    return container.get(RockitPreferenceSelectInputRenderer)
  }
}
