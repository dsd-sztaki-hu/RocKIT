// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { CompositeTreeNode, TreeImpl, TreeNode } from '@theia/core/lib/browser'
// import { wait } from '@theia/core/lib/common/promise-util'
import { inject } from '@theia/core/shared/inversify'
import { ExampleTreeNode, ROOT_NODE_ID } from './entities-overview-model'
import { EntitiesOverviewTreeItemFactory } from './entities-overview-tree-item-factory'

const INITIAL_RENDERED_CHILDREN = 150

/**
 * Tree implementation.
 *
 * We override this to enable lazy child node resolution on node expansion.
 */
export class EntitiesOverviewTree extends TreeImpl {
  @inject(EntitiesOverviewTreeItemFactory)
  private readonly itemFactory: EntitiesOverviewTreeItemFactory

  /**
   * Resolves children of the given parent node.
   *
   * @param parent the node for which to provide the children
   * @returns a new array of child tree nodes for the given parent node.
   */
  override async resolveChildren(parent: CompositeTreeNode): Promise<TreeNode[]> {
    // root children are initialized once and never change, so we just return a copy of the original children
    if (parent.id === ROOT_NODE_ID) {
      return [...parent.children]
    }

    // non-container nodes do not have children, so we return an empty array
    if (!ExampleTreeNode.is(parent)) {
      return []
    }

    // Keep already materialized children. Additional children are appended by the model
    // as the user scrolls, so expansion does not instantiate every entity at once.
    if (parent.children.length > 0) {
      return [...parent.children]
    }

    // simulate asynchronous loading of children. In the UI we can see a busy marker when we expand a node because of this.
    // (in practice, we would call an expensive function to fetch the children and return the corresponding promise)
    // await wait(2000);
    return (parent.data.children ?? [])
      .slice(0, INITIAL_RENDERED_CHILDREN)
      .map((item) => {
        const child = this.itemFactory.toTreeNode(item)
        ;(child as { parent: CompositeTreeNode }).parent = parent
        return child
      })
  }

  notifyUpdated(nodes: TreeNode[]): void {
    this.onDidUpdateEmitter.fire(nodes)
  }
}
