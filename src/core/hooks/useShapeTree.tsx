/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as React from 'react'
import type {
  IShapeTreeNode,
  TLAssets,
  TLBounds,
  TLPage,
  TLPageState,
  TLShape,
} from '../types'
import { boundsCollide, boundsContain, vec } from '../../utils'
import { useTLContext } from './useTLContext'

function addToShapeTree<T extends TLShape, M extends Record<string, unknown>>(
  shape: T,
  branch: IShapeTreeNode<T, M>[],
  shapes: TLPage<T>['shapes'],
  pageState: TLPageState,
  assets: TLAssets,
  isChildOfGhost = false,
  isChildOfSelected = false,
  meta?: M,
) {
  // Create a node for this shape
  const node: IShapeTreeNode<T, M> = {
    shape,
    asset: shape.assetId ? assets[shape.assetId] : undefined,
    meta: meta as any,
    isChildOfSelected,
    isGhost: shape.isGhost || isChildOfGhost,
    isEditing: pageState.editingId === shape.id,
    isSelected: pageState.selectedIds.includes(shape.id),
    isHovered:
    // The shape is hovered..
      pageState.hoveredId === shape.id
      // Or the shape has children and...
      || (shape.children !== undefined
        // One of the children is hovered
        && ((pageState.hoveredId && shape.children.includes(pageState.hoveredId))
          // Or one of the children is selected
          || shape.children.some(childId => pageState.selectedIds.includes(childId)))),
  }

  // Add the node to the branch
  branch.push(node)

  // If the shape has children, add nodes for each child to the node's children array
  if (shape.children) {
    node.children = []

    shape.children
      .map(id => shapes[id])
      .sort((a, b) => a.childIndex - b.childIndex)
      .forEach(childShape =>
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        addToShapeTree(
          childShape,
          node.children!,
          shapes,
          pageState,
          assets,
          node.isGhost,
          node.isSelected || node.isChildOfSelected,
          meta,
        ))
  }
}

function shapeIsInViewport(bounds: TLBounds, viewport: TLBounds) {
  return boundsContain(viewport, bounds) || boundsCollide(viewport, bounds)
}

const useShapeTree = <T extends TLShape, M extends Record<string, unknown>>(
  page: TLPage<T>,
  pageState: TLPageState,
  assets: TLAssets,
  meta?: M,
) => {
  const { bounds, callbacks, shapeUtils } = useTLContext()

  const rTimeout = React.useRef<unknown>()
  const rPreviousCount = React.useRef(0)
  const rShapesIdsToRender = React.useRef(new Set<string>())
  const rShapesToRender = React.useRef(new Set<TLShape>())

  const { camera, selectedIds } = pageState

  // Filter the page's shapes down to only those that:
  // - are the direct child of the page
  // - collide with or are contained by the viewport
  // - OR are selected

  const [minX, minY] = vec.sub(vec.div([0, 0], camera.zoom), camera.point)
  const [maxX, maxY] = vec.sub(vec.div([bounds.width, bounds.height], camera.zoom), camera.point)
  const viewport = {
    minX,
    minY,
    maxX,
    maxY,
    height: maxX - minX,
    width: maxY - minY,
  }

  const shapesToRender = rShapesToRender.current
  const shapesIdsToRender = rShapesIdsToRender.current

  shapesToRender.clear()
  shapesIdsToRender.clear()

  Object.values(page.shapes)
    .filter(shape =>
    // Always render shapes that are flagged as stateful
      shapeUtils[shape.type as T['type']].isStateful
        // Always render selected shapes (this preserves certain drag interactions)
        || selectedIds.includes(shape.id)
        // Otherwise, only render shapes that are in view
        || shapeIsInViewport(shapeUtils[shape.type as T['type']].getBounds(shape as any), viewport))
    .forEach((shape) => {
      // If the shape's parent is the page, add it to our sets of shapes to render
      if (shape.parentId === page.id) {
        shapesIdsToRender.add(shape.id)
        shapesToRender.add(shape)
        return
      }

      // If the shape's parent is a different shape (e.g. a group),
      // add the parent to the sets of shapes to render. The parent's
      // children will all be rendered.
      shapesIdsToRender.add(shape.parentId)
      shapesToRender.add(page.shapes[shape.parentId])
    })

  // Call onChange callback when number of rendering shapes changes

  if (shapesToRender.size !== rPreviousCount.current) {
    // Use a timeout to clear call stack, in case the onChange handler
    // produces a new state change, which could cause nested state
    // changes, which is bad in React.
    if (rTimeout.current) {
      clearTimeout(rTimeout.current as number)
    }
    rTimeout.current = requestAnimationFrame(() => {
      callbacks.onRenderCountChange?.(Array.from(shapesIdsToRender.values()))
    })
    rPreviousCount.current = shapesToRender.size
  }

  // Populate the shape tree
  const tree: IShapeTreeNode<T, M>[] = []

  shapesToRender.forEach(shape => addToShapeTree(
    shape,
    tree,
    page.shapes,
    pageState,
    assets,
    shape.isGhost,
    false,
    meta,
  ))

  tree.sort((a, b) => a.shape.childIndex - b.shape.childIndex)

  return tree
}
export default useShapeTree
