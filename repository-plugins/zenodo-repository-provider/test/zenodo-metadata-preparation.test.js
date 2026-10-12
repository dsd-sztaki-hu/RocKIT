// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  ZenodoMetadataPreparation,
  ZenodoMetadataPromptCancelledError,
} = require('../src/zenodo-metadata-preparation')

function crate() {
  return {
    '@context': 'https://w3id.org/ro/crate/1.1/context',
    '@graph': [
      {
        '@id': './',
        '@type': 'Dataset',
        name: 'Metadata prompt test',
        description: 'Description',
        datePublished: '2026-10-12',
        author: { '@id': '#alice' },
      },
      { '@id': '#alice', '@type': 'author', authorName: 'Alice Example' },
    ],
  }
}

describe('Zenodo metadata preparation', () => {
  it('prompts for conditional access metadata and uses repository licenses', async () => {
    const prompts = []
    const vscode = {
      window: {
        async showQuickPick(items, options) {
          prompts.push(options.placeHolder)
          return options.placeHolder.includes('access right')
            ? items.find((item) => item.value === 'embargoed')
            : items.find((item) => item.value === 'custom-license')
        },
        async showInputBox(options) {
          prompts.push(options.prompt)
          return '2027-01-31'
        },
      },
    }
    const preparation = new ZenodoMetadataPreparation({ vscode })
    const client = {
      async listLicenses() {
        return {
          hits: {
            hits: [{ metadata: { id: 'custom-license', title: 'Custom License' } }],
          },
        }
      },
    }

    const metadata = await preparation.prepare(crate(), client)

    assert.equal(metadata.access_right, 'embargoed')
    assert.equal(metadata.license, 'custom-license')
    assert.equal(metadata.embargo_date, '2027-01-31')
    assert.deepEqual(prompts, [
      'Select the access right for this deposition',
      'Select the license that applies to all files',
      'Enter the embargo end date (YYYY-MM-DD)',
    ])
  })

  it('stops before repository creation when the user cancels', async () => {
    const preparation = new ZenodoMetadataPreparation({
      vscode: { window: { showQuickPick: async () => undefined } },
    })

    await assert.rejects(
      preparation.prepare(crate(), { listLicenses: async () => [] }),
      ZenodoMetadataPromptCancelledError,
    )
  })
})
