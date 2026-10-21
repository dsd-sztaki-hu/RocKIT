// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const vscode = require('vscode')
const {
  activateDataverseProvider,
  deactivateDataverseProvider,
} = require('./src/dataverse-provider')

/** @param {import('vscode').ExtensionContext} context */
async function activate(context) {
  await activateDataverseProvider(vscode, context)
}

async function deactivate() {
  await deactivateDataverseProvider(vscode)
}

module.exports = { activate, deactivate }
