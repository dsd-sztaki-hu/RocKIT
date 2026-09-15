// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { Emitter, MaybePromise } from '@theia/core';
import { DepthFirstTreeIterator, Tree, TreeDecorator } from '@theia/core/lib/browser';
import { WidgetDecoration } from '@theia/core/lib/browser/widget-decoration';
import { Event } from '@theia/core/lib/common';
import { nls } from '@theia/core/lib/common/nls';
import { injectable } from '@theia/core/shared/inversify';
import { ExampleTreeLeaf } from '../entities-overview-model';

/**
 * Example TreeDecorator implementation for our tree widget.
 */
@injectable()
export class EntitiesOverviewDecorator implements TreeDecorator {
    /** Decorator id - required by the TreeDecorator interface */
    id = 'TreeviewExampleDecorator';

    /** Event Emitter for when the decorations change - required by the TreeDecorator interface */
    protected readonly emitter = new Emitter<(tree: Tree) => Map<string, WidgetDecoration.Data>>();    
    get onDidChangeDecorations(): Event<(tree: Tree) => Map<string, WidgetDecoration.Data>> {
        return this.emitter.event;
    }

    /** 
     * The actual decoration calculation.
     * 
     * In contrast to label providers, decorators provide decorations for the complete tree at once.
     * 
     * @param tree the tree to decorate.
     * @returns a Map of node IDs mapped to decorations.
     */
    decorations(tree: Tree): MaybePromise<Map<string, WidgetDecoration.Data>> {
        const result = new Map();

        if (tree.root === undefined) {
            return result;
        }

        // iterate the tree
        for (const treeNode of new DepthFirstTreeIterator(tree.root)) {
            // in our case, we only decorate leaf nodes
            if (ExampleTreeLeaf.is(treeNode)) {
                // we distinguish valid and invalid elements based on the valid property
                const isValid = treeNode.data.valid;
                if (!isValid) {
                    result.set(treeNode.id, <WidgetDecoration.Data>{
                        tooltip: nls.localize('rockit/entitiesOverview/invalidEntity', 'Invalid entity'),
                        // We can also add a caption suffix, this would be displayed after the name of the node.
                        /*captionSuffixes: [{
                            data: ' - invalid',
                            fontData: { style: 'italic' } }]*/
                    });
                }
            }
        }
        return result;
    }
}
