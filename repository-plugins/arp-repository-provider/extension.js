// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const vscode = require('vscode')
const { activateArpProvider, deactivateArpProvider } = require('./src/arp-provider')

/** @param {import('vscode').ExtensionContext} context */
async function activate(context) {
  await activateArpProvider(vscode, context)
}

async function deactivate() {
  await deactivateArpProvider(vscode)
}

module.exports = { activate, deactivate }
