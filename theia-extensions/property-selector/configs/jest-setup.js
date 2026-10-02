// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// Mock DragEvent as '@lumino/dragdrop' already requires it at require time
global.DragEvent = class DragEvent { };
