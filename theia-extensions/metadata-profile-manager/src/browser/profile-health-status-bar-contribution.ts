// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar/status-bar';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { inject, injectable } from 'inversify';

import { MetadataProfileManagerCommands } from './metadata-profile-manager-contribution';
import { ProfileManagerService } from './services/metadata-profile-manager-service';
import type { ProfileHealthIssue, ProfileHealthStatus } from './types';

const PROFILE_HEALTH_STATUS_BAR_ID = 'metadata-profile-manager.profile-health';

@injectable()
export class ProfileHealthStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) protected readonly statusBar!: StatusBar;
  @inject(AppStateService) protected readonly appStateService!: AppStateService;
  @inject(ProfileManagerService) protected readonly profileManagerService!: ProfileManagerService;

  protected readonly toDispose = new DisposableCollection();
  protected updateTimer: number | undefined;
  protected updateGeneration = 0;

  async onStart(): Promise<void> {
    await this.appStateService.ready;

    this.toDispose.push(this.appStateService.onDidChangeSelector(state => state.roCrate)(() => this.scheduleUpdate()));
    this.toDispose.push(this.profileManagerService.onDidChangeProfiles(() => this.scheduleUpdate()));

    this.scheduleUpdate();
  }

  protected scheduleUpdate(): void {
    if (this.updateTimer !== undefined) {
      window.clearTimeout(this.updateTimer);
    }
    this.updateTimer = window.setTimeout(() => {
      this.updateTimer = undefined;
      this.updateStatusBar();
    }, 100);
  }

  protected async updateStatusBar(): Promise<void> {
    const generation = ++this.updateGeneration;
    const crate = this.appStateService.roCrate;

    if (!crate) {
      await this.statusBar.removeElement(PROFILE_HEALTH_STATUS_BAR_ID);
      return;
    }

    try {
      const health = await this.profileManagerService.getProfileHealthForCrate(crate);
      if (generation !== this.updateGeneration) {
        return;
      }

      if (health.issues.length === 0) {
        await this.statusBar.removeElement(PROFILE_HEALTH_STATUS_BAR_ID);
        return;
      }

      await this.statusBar.setElement(PROFILE_HEALTH_STATUS_BAR_ID, {
        text: `$(error) ${nls.localize(
          'rockit/profileManager/profileIssue',
          'RO-Crate profile issue: {0}',
          this.describeIssueCounts(health),
        )}`,
        alignment: StatusBarAlignment.LEFT,
        priority: 1000,
        className: 'metadata-profile-health-status',
        color: 'var(--theia-statusBarItem-errorForeground)',
        backgroundColor: 'var(--theia-statusBarItem-errorBackground)',
        tooltip: this.createTooltip(health),
        command: MetadataProfileManagerCommands.OPEN.id,
        accessibilityInformation: {
          label: nls.localize(
            'rockit/profileManager/profileIssueAccessible',
            'RO-Crate profile issue: {0}. Click to open Metadata Profile Manager.',
            this.describeIssueCounts(health),
          ),
          role: 'button'
        }
      });
    } catch (error) {
      if (generation !== this.updateGeneration) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      await this.statusBar.setElement(PROFILE_HEALTH_STATUS_BAR_ID, {
        text: `$(error) ${nls.localize(
          'rockit/profileManager/profileUnavailable',
          'RO-Crate profile status unavailable',
        )}`,
        alignment: StatusBarAlignment.LEFT,
        priority: 1000,
        className: 'metadata-profile-health-status',
        color: 'var(--theia-statusBarItem-errorForeground)',
        backgroundColor: 'var(--theia-statusBarItem-errorBackground)',
        tooltip: nls.localize(
          'rockit/profileManager/profileCheckFailed',
          'Unable to check referenced metadata profiles.\n\n{0}',
          message,
        ),
        command: MetadataProfileManagerCommands.OPEN.id,
        accessibilityInformation: {
          label: nls.localize(
            'rockit/profileManager/profileUnavailableAccessible',
            'RO-Crate profile status unavailable. Click to open Metadata Profile Manager.',
          ),
          role: 'button'
        }
      });
    }
  }

  protected describeIssueCounts(health: ProfileHealthStatus): string {
    const failedCount = health.issues.filter(issue => issue.status === 'failed').length;
    const missingCount = health.issues.filter(issue => issue.status === 'missing').length;
    const parts: string[] = [];

    if (failedCount > 0) {
      parts.push(nls.localize('rockit/profileManager/failedCount', '{0} failed', failedCount));
    }
    if (missingCount > 0) {
      parts.push(nls.localize('rockit/profileManager/missingCount', '{0} missing', missingCount));
    }

    return parts.join(', ');
  }

  protected createTooltip(health: ProfileHealthStatus): string {
    const details = health.issues
      .slice(0, 5)
      .map(issue => this.describeIssue(issue))
      .join('\n');
    const remaining = health.issues.length > 5
      ? `\n${nls.localize(
          'rockit/profileManager/andMore',
          '...and {0} more.',
          health.issues.length - 5,
        )}`
      : '';

    return [
      nls.localize(
        'rockit/profileManager/editingMayBeIncomplete',
        'Editing may be incomplete because referenced metadata profiles are unavailable.',
      ),
      '',
      details + remaining,
      '',
      nls.localize(
        'rockit/profileManager/clickToOpen',
        'Click to open Metadata Profile Manager.',
      )
    ].join('\n');
  }

  protected describeIssue(issue: ProfileHealthIssue): string {
    const label = issue.profileName || issue.conformsTo;
    const message = issue.message ? `: ${issue.message}` : '';
    const status = issue.status === 'failed'
      ? nls.localize('rockit/profileManager/failedUpper', 'FAILED')
      : nls.localize('rockit/profileManager/missingUpper', 'MISSING');
    return `${status} ${label}${message}`;
  }
}
