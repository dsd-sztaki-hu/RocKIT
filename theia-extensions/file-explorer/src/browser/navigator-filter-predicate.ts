// *****************************************************************************
// Copyright (C) 2018 TypeFox and others.
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
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

import { Minimatch } from 'minimatch';

interface Predicate {
    filter(item: { id: string }): boolean;
}

/**
 * Concrete file navigator filter predicate decoupled from Theia preferences.
 */
export class FileNavigatorFilterPredicate implements Predicate {

    private readonly delegate: Predicate;

    constructor(exclusions: { [key: string]: boolean }) {
        const patterns = Object.keys(exclusions)
            .filter(pattern => exclusions[pattern]);
        this.delegate = this.and(...patterns.map(pattern => this.createDelegate(pattern)));
    }

    filter(item: { id: string }): boolean {
        return this.delegate.filter(item);
    }

    protected createDelegate(pattern: string): Predicate {
        const delegate = new Minimatch(pattern, { matchBase: true });
        return {
            filter: item => !delegate.match(item.id)
        };
    }

    private and(...predicates: Predicate[]): Predicate {
        return {
            filter: item => predicates.every(predicate => predicate.filter(item))
        };
    }

}
