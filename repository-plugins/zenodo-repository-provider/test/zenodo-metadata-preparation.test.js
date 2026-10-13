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
  PROMPT_REQUIRED_METADATA_COMMAND,
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
      commands: {
        async executeCommand(command, prompt) {
          prompts.push({ command, prompt })
          return {
            access_right: 'embargoed',
            license: 'custom-license',
            embargo_date: '2027-01-31',
          }
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
    assert.equal(prompts.length, 1)
    assert.equal(prompts[0].command, PROMPT_REQUIRED_METADATA_COMMAND)
    assert.equal(prompts[0].prompt.kind, 'zenodo-access-policy')
    assert.equal(prompts[0].prompt.defaults.access_right, 'open')
    assert.equal(prompts[0].prompt.defaults.license, 'cc-zero')
    assert.deepEqual(prompts[0].prompt.options, [
      { value: 'custom-license', label: 'Custom License (custom-license)' },
      { value: 'cc-zero', label: 'cc-zero' },
      { value: 'cc-by', label: 'cc-by' },
    ])
  })

  it('stops before repository creation when the user cancels', async () => {
    const preparation = new ZenodoMetadataPreparation({
      vscode: { commands: { executeCommand: async () => undefined } },
    })

    await assert.rejects(
      preparation.prepare(crate(), { listLicenses: async () => [] }),
      ZenodoMetadataPromptCancelledError,
    )
  })
})
