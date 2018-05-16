import '../polymer/polymer.js';
import { dom } from '../polymer/lib/legacy/polymer.dom.js';
/**
 * Used to calculate the scroll direction during touch events.
 * @type {!Object}
 */
var lastTouchPosition = {
  pageX: 0,
  pageY: 0
};
/**
 * Used to avoid computing event.path and filter scrollable nodes (better perf).
 * @type {?EventTarget}
 */
var lastRootTarget = null;
/**
 * @type {!Array<!Node>}
 */
var lastScrollableNodes = [];
/**
 * @type {!Array<string>}
 */
var scrollEvents = [
  // Modern `wheel` event for mouse wheel scrolling:
  'wheel',
  // Older, non-standard `mousewheel` event for some FF:
  'mousewheel',
  // IE:
  'DOMMouseScroll',
  // Touch enabled devices
  'touchstart',
  'touchmove'
];

export function currentLockingElement() {
  return _lockingElements[_lockingElements.length - 1];
}

export function elementIsScrollLocked(element) {
  var currentLockingElement = currentLockingElement;

  if (currentLockingElement === undefined)
    return false;

  var scrollLocked;

  if (_hasCachedLockedElement(element)) {
    return true;
  }

  if (_hasCachedUnlockedElement(element)) {
    return false;
  }

  scrollLocked = !!currentLockingElement &&
    currentLockingElement !== element &&
    !_composedTreeContains(currentLockingElement, element);

  if (scrollLocked) {
    _lockedElementCache.push(element);
  } else {
    _unlockedElementCache.push(element);
  }

  return scrollLocked;
}

export function pushScrollLock(element) {
  // Prevent pushing the same element twice
  if (_lockingElements.indexOf(element) >= 0) {
    return;
  }

  if (_lockingElements.length === 0) {
    _lockScrollInteractions();
  }

  _lockingElements.push(element);

  _lockedElementCache = [];
  _unlockedElementCache = [];
}

export function removeScrollLock(element) {
  var index = _lockingElements.indexOf(element);

  if (index === -1) {
    return;
  }

  _lockingElements.splice(index, 1);

  _lockedElementCache = [];
  _unlockedElementCache = [];

  if (_lockingElements.length === 0) {
    _unlockScrollInteractions();
  }
}

export const _lockingElements = [];
export const _lockedElementCache = null;
export const _unlockedElementCache = null;

export function _hasCachedLockedElement(element) {
  return _lockedElementCache.indexOf(element) > -1;
}

export function _hasCachedUnlockedElement(element) {
  return _unlockedElementCache.indexOf(element) > -1;
}

export function _composedTreeContains(element, child) {
  // NOTE(cdata): This method iterates over content elements and their
  // corresponding distributed nodes to implement a contains-like method
  // that pierces through the composed tree of the ShadowDOM. Results of
  // this operation are cached (elsewhere) on a per-scroll-lock basis, to
  // guard against potentially expensive lookups happening repeatedly as
  // a user scrolls / touchmoves.
  var contentElements;
  var distributedNodes;
  var contentIndex;
  var nodeIndex;

  if (element.contains(child)) {
    return true;
  }

  contentElements = dom(element).querySelectorAll('content,slot');

  for (contentIndex = 0; contentIndex < contentElements.length; ++contentIndex) {

    distributedNodes = dom(contentElements[contentIndex]).getDistributedNodes();

    for (nodeIndex = 0; nodeIndex < distributedNodes.length; ++nodeIndex) {
      // Polymer 2.x returns slot.assignedNodes which can contain text nodes.
      if (distributedNodes[nodeIndex].nodeType !== Node.ELEMENT_NODE) continue;

      if (_composedTreeContains(distributedNodes[nodeIndex], child)) {
        return true;
      }
    }
  }

  return false;
}

export function _scrollInteractionHandler(event) {
  // Avoid canceling an event with cancelable=false, e.g. scrolling is in
  // progress and cannot be interrupted.
  if (event.cancelable && _shouldPreventScrolling(event)) {
    event.preventDefault();
  }
  // If event has targetTouches (touch event), update last touch position.
  if (event.targetTouches) {
    var touch = event.targetTouches[0];
    lastTouchPosition.pageX = touch.pageX;
    lastTouchPosition.pageY = touch.pageY;
  }
}

export function _lockScrollInteractions() {
  _boundScrollHandler = _boundScrollHandler ||
    _scrollInteractionHandler.bind(Polymer.IronScrollManager);
  for (var i = 0, l = scrollEvents.length; i < l; i++) {
    // NOTE: browsers that don't support objects as third arg will
    // interpret it as boolean, hence useCapture = true in this case. 
    document.addEventListener(scrollEvents[i], _boundScrollHandler, {
      capture: true,
      passive: false
    });
  }
}

export function _unlockScrollInteractions() {
  for (var i = 0, l = scrollEvents.length; i < l; i++) {
    // NOTE: browsers that don't support objects as third arg will
    // interpret it as boolean, hence useCapture = true in this case.
    document.removeEventListener(scrollEvents[i], _boundScrollHandler, {
      capture: true,
      passive: false
    });
  }
}

export function _shouldPreventScrolling(event) {

  // Update if root target changed. For touch events, ensure we don't
  // update during touchmove.
  var target = dom(event).rootTarget;
  if (event.type !== 'touchmove' && lastRootTarget !== target) {
    lastRootTarget = target;
    lastScrollableNodes = _getScrollableNodes(dom(event).path);
  }

  // Prevent event if no scrollable nodes.
  if (!lastScrollableNodes.length) {
    return true;
  }
  // Don't prevent touchstart event inside the locking element when it has
  // scrollable nodes.
  if (event.type === 'touchstart') {
    return false;
  }
  // Get deltaX/Y.
  var info = _getScrollInfo(event);
  // Prevent if there is no child that can scroll.
  return !_getScrollingNode(lastScrollableNodes, info.deltaX, info.deltaY);
}

export function _getScrollableNodes(nodes) {
  var scrollables = [];
  var lockingIndex = nodes.indexOf(currentLockingElement);
  // Loop from root target to locking element (included).
  for (var i = 0; i <= lockingIndex; i++) {
    // Skip non-Element nodes.
    if (nodes[i].nodeType !== Node.ELEMENT_NODE) {
      continue;
    }
    var node = /** @type {!Element} */ (nodes[i]);
    // Check inline style before checking computed style.
    var style = node.style;
    if (style.overflow !== 'scroll' && style.overflow !== 'auto') {
      style = window.getComputedStyle(node);
    }
    if (style.overflow === 'scroll' || style.overflow === 'auto') {
      scrollables.push(node);
    }
  }
  return scrollables;
}

export function _getScrollingNode(nodes, deltaX, deltaY) {
  // No scroll.
  if (!deltaX && !deltaY) {
    return;
  }
  // Check only one axis according to where there is more scroll.
  // Prefer vertical to horizontal.
  var verticalScroll = Math.abs(deltaY) >= Math.abs(deltaX);
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var canScroll = false;
    if (verticalScroll) {
      // delta < 0 is scroll up, delta > 0 is scroll down.
      canScroll = deltaY < 0 ? node.scrollTop > 0 :
        node.scrollTop < node.scrollHeight - node.clientHeight;
    } else {
      // delta < 0 is scroll left, delta > 0 is scroll right.
      canScroll = deltaX < 0 ? node.scrollLeft > 0 :
        node.scrollLeft < node.scrollWidth - node.clientWidth;
    }
    if (canScroll) {
      return node;
    }
  }
}

export function _getScrollInfo(event) {
  var info = {
    deltaX: event.deltaX,
    deltaY: event.deltaY
  };
  // Already available.
  if ('deltaX' in event) {
    // do nothing, values are already good.
  }
  // Safari has scroll info in `wheelDeltaX/Y`.
  else if ('wheelDeltaX' in event && 'wheelDeltaY' in event) {
    info.deltaX = -event.wheelDeltaX;
    info.deltaY = -event.wheelDeltaY;
  }
  // IE10 has only vertical scroll info in `wheelDelta`.
  else if ('wheelDelta' in event) {
    info.deltaX = 0;
    info.deltaY = -event.wheelDelta;
  }
  // Firefox has scroll info in `detail` and `axis`.
  else if ('axis' in event) {
    info.deltaX = event.axis === 1 ? event.detail : 0;
    info.deltaY = event.axis === 2 ? event.detail : 0;
  }
  // On mobile devices, calculate scroll direction.
  else if (event.targetTouches) {
    var touch = event.targetTouches[0];
    // Touch moves from right to left => scrolling goes right.
    info.deltaX = lastTouchPosition.pageX - touch.pageX;
    // Touch moves from down to up => scrolling goes down.
    info.deltaY = lastTouchPosition.pageY - touch.pageY;
  }
  return info;
}
