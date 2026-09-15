// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { AppState } from './app-state';

/**
 * Asynchronously loads the initial RO-Crate and profile data.
 * In a real-world scenario, these might be fetched from a backend service
 * or a more sophisticated configuration system. For now, we'll simulate
 * loading from local JSON files.
 */
export async function loadInitialCrateAndProfile(): Promise<
  Pick<AppState, 'roCrate' | 'profile' | 'selectedEntityId'>
> {
  try {
    // Dynamically import the JSON files.
    // Webpack (used by Theia) will handle these imports and include them in the bundle.
    const [crateData, profileData] = await Promise.all([
      import('../../../data/crate.json'),
      import('../../../data/init_profile.json'),
    ]);

    return {
      roCrate: crateData.default,
      profile: profileData.default,
      selectedEntityId: undefined,
    };
  } catch (error) {
    console.error('Failed to load initial crate or profile data:', error);
    // Return undefined for roCrate and profile if loading fails,
    // allowing the app to start with default empty state.
    return {
      roCrate: undefined,
      profile: undefined,
      selectedEntityId: undefined,
    };
  }
}