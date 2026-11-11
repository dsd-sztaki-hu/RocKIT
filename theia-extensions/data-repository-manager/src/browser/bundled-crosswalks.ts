// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { BundledCrosswalk } from 'crosswalk-manager/lib/browser/crosswalk-manager-types'
import dataverseCrosswalk = require('./crosswalks/arp-dataverse-crosswalk.json')
import zenodoCrosswalk = require('./crosswalks/arp-zenodo-crosswalk.json')
import schemaDataverseCrosswalk = require('./crosswalks/schema-org-dataverse-crosswalk.json')
import schemaZenodoCrosswalk = require('./crosswalks/schema-org-zenodo-crosswalk.json')

export const BUNDLED_REPOSITORY_CROSSWALKS: BundledCrosswalk[] = [
  { fileName: 'arp-dataverse-crosswalk.json', document: dataverseCrosswalk },
  { fileName: 'arp-zenodo-crosswalk.json', document: zenodoCrosswalk },
  { fileName: 'schema-org-dataverse-crosswalk.json', document: schemaDataverseCrosswalk },
  { fileName: 'schema-org-zenodo-crosswalk.json', document: schemaZenodoCrosswalk },
]
