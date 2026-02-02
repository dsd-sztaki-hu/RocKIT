// *****************************************************************************
// Copyright (C) 2018 TypeFox and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Minimatch } from 'minimatch';
import { MaybePromise } from '@theia/core/lib/common/types';
import { Event, Emitter } from '@theia/core/lib/common/event';
import { FileSystemPreferences, FileSystemConfiguration } from '@theia/filesystem/lib/common/filesystem-preferences';
import { FileNavigatorPreferences, FileNavigatorConfiguration } from '../common/navigator-preferences';
import { PreferenceChangeEvent } from '@theia/core';
import { DirNode, FileStatNode } from '@theia/filesystem/lib/browser';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';

/**
 * Filter for omitting elements from the navigator. For more details on the exclusion patterns,
 * one should check either the manual with `man 5 gitignore` or just [here](https://git-scm.com/docs/gitignore).
 */
@injectable()
export class FileNavigatorFilter {
    protected readonly emitter: Emitter<void> = new Emitter<void>();

    protected filterPredicate: FileNavigatorFilter.Predicate;
    protected showHiddenFiles: boolean;
    protected nameFilter = '';
    protected normalizedNameFilter = '';
    protected roCrateFilter: FileNavigatorFilter.RoCrateFilter = 'all';
    protected roCrateEntityNames = new Set<string>();

    @inject(FileSystemPreferences)
    protected readonly filesPreferences: FileSystemPreferences;
    @inject(AppStateService)
    protected readonly appStateService: AppStateService;

    constructor(
        @inject(FileNavigatorPreferences) protected readonly preferences: FileNavigatorPreferences
    ) { }

    @postConstruct()
    protected init(): void {
        this.doInit();
    }

    protected async doInit(): Promise<void> {
        this.filterPredicate = this.createFilterPredicate(this.filesPreferences['files.exclude']);
        this.filesPreferences.onPreferenceChanged(event => this.onFilesPreferenceChanged(event));
        this.preferences.onPreferenceChanged(event => this.onPreferenceChanged(event));
        this.updateRoCrateEntityNames(this.appStateService.roCrate);
        this.appStateService.onDidChangeSelector(state => state.roCrate)(crate => {
            this.updateRoCrateEntityNames(crate);
            this.fireFilterChanged();
        });
    }

    async filter<T extends { id: string }>(items: MaybePromise<T[]>): Promise<T[]> {
        return (await items).filter(item => this.filterItem(item));
    }

    get onFilterChanged(): Event<void> {
        return this.emitter.event;
    }

    protected filterItem(item: { id: string }): boolean {
        if (!this.filterPredicate.filter(item)) {
            return false;
        }
        if (DirNode.is(item)) {
            return true;
        }
        if (!FileStatNode.is(item)) {
            return true;
        }
        if (!this.matchesNameFilter(item)) {
            return false;
        }
        if (!this.matchesRoCrateFilter(item)) {
            return false;
        }
        return true;
    }

    protected fireFilterChanged(): void {
        this.emitter.fire(undefined);
    }

    protected onFilesPreferenceChanged(event: PreferenceChangeEvent<FileSystemConfiguration>): void {
        const { preferenceName, newValue } = event;
        if (preferenceName === 'files.exclude') {
            this.filterPredicate = this.createFilterPredicate(newValue as FileNavigatorFilter.Exclusions | undefined || {});
            this.fireFilterChanged();
        }
    }

    protected onPreferenceChanged(event: PreferenceChangeEvent<FileNavigatorConfiguration>): void {
    }

    protected createFilterPredicate(exclusions: FileNavigatorFilter.Exclusions): FileNavigatorFilter.Predicate {
        return new FileNavigatorFilterPredicate(this.interceptExclusions(exclusions));
    }

    toggleHiddenFiles(): void {
        this.showHiddenFiles = !this.showHiddenFiles;
        const filesExcludes = this.filesPreferences['files.exclude'];

        this.filterPredicate = this.createFilterPredicate(filesExcludes || {});
        this.fireFilterChanged();
    }

    setFilters(nameFilter: string, roCrateFilter: FileNavigatorFilter.RoCrateFilter): void {
        const normalizedNameFilter = nameFilter.trim().toLowerCase();
        if (this.nameFilter === nameFilter && this.roCrateFilter === roCrateFilter) {
            return;
        }
        this.nameFilter = nameFilter;
        this.normalizedNameFilter = normalizedNameFilter;
        this.roCrateFilter = roCrateFilter;
        this.fireFilterChanged();
    }

    clearFilters(): void {
        this.setFilters('', 'all');
    }

    hasRoCrateData(): boolean {
        return this.roCrateEntityNames.size > 0;
    }

    hasRoCrateDescription(fileName: string): boolean {
        if (!this.hasRoCrateData()) {
            return false;
        }
        const normalized = fileName.trim().toLowerCase();
        return Boolean(normalized) && this.roCrateEntityNames.has(normalized);
    }

    protected interceptExclusions(exclusions: FileNavigatorFilter.Exclusions): FileNavigatorFilter.Exclusions {
        return {
            ...exclusions,
            '**/.*': this.showHiddenFiles
        };
    }

    protected matchesNameFilter(node: FileStatNode): boolean {
        if (!this.normalizedNameFilter) {
            return true;
        }
        return node.fileStat.name.toLowerCase().includes(this.normalizedNameFilter);
    }

    protected matchesRoCrateFilter(node: FileStatNode): boolean {
        if (this.roCrateFilter === 'all') {
            return true;
        }
        if (!this.hasRoCrateData()) {
            return true;
        }
        const hasDescription = this.hasRoCrateDescription(node.fileStat.name);
        if (this.roCrateFilter === 'with-description') {
            return hasDescription;
        }
        return !hasDescription;
    }

    protected updateRoCrateEntityNames(crate: Record<string, any> | undefined): void {
        const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : [];
        const names = new Set<string>();
        for (const entry of graph) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const candidate =
                typeof entry.name === 'string'
                    ? entry.name
                    : typeof entry.title === 'string'
                        ? entry.title
                        : typeof entry['@id'] === 'string'
                            ? entry['@id']
                            : undefined;
            if (!candidate) {
                continue;
            }
            const normalized = candidate.trim().toLowerCase();
            if (normalized) {
                names.add(normalized);
            }
        }
        this.roCrateEntityNames = names;
    }

}

export namespace FileNavigatorFilter {

    /**
     * File navigator filter predicate.
     */
    export interface Predicate {

        /**
         * Returns `true` if the item should filtered our from the navigator. Otherwise, `true`.
         *
         * @param item the identifier of a tree node.
         */
        filter(item: { id: string }): boolean;

    }

    export namespace Predicate {

        /**
         * Wraps a bunch of predicates and returns with a new one that evaluates to `true` if
         * each of the wrapped predicates evaluates to `true`. Otherwise, `false`.
         */
        export function and(...predicates: Predicate[]): Predicate {
            return {
                filter: id => predicates.every(predicate => predicate.filter(id))
            };
        }

    }

    /**
     * Type for the exclusion patterns. The property keys are the patterns, values are whether the exclusion is enabled or not.
     */
    export interface Exclusions {
        [key: string]: boolean;
    }

    export type RoCrateFilter = 'all' | 'with-description' | 'without-description';

}

/**
 * Concrete filter navigator filter predicate that is decoupled from the preferences.
 */
export class FileNavigatorFilterPredicate implements FileNavigatorFilter.Predicate {

    private readonly delegate: FileNavigatorFilter.Predicate;

    constructor(exclusions: FileNavigatorFilter.Exclusions) {
        const patterns = Object.keys(exclusions).map(pattern => ({ pattern, enabled: exclusions[pattern] })).filter(object => object.enabled).map(object => object.pattern);
        this.delegate = FileNavigatorFilter.Predicate.and(...patterns.map(pattern => this.createDelegate(pattern)));
    }

    filter(item: { id: string }): boolean {
        return this.delegate.filter(item);
    }

    protected createDelegate(pattern: string): FileNavigatorFilter.Predicate {
        const delegate = new Minimatch(pattern, { matchBase: true });
        return {
            filter: item => !delegate.match(item.id)
        };
    }

}
