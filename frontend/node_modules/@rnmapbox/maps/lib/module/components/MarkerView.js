"use strict";

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet } from 'react-native';
import RNMBXMakerViewContentComponent from '../specs/RNMBXMarkerViewContentNativeComponent';
import NativeMarkerViewComponent from '../specs/RNMBXMarkerViewNativeComponent';
import { jsx as _jsx } from "react/jsx-runtime";
// Device pixel ratio is constant for the lifetime of the app.
const PIXEL_RATIO = PixelRatio.get();
const DEFAULT_ANCHOR = {
  x: 0.5,
  y: 0.5
};
/**
 * MarkerView represents an interactive React Native marker on the map.
 *
 * If you have static views, consider using PointAnnotation or SymbolLayer to display
 * an image, as they'll offer much better performance. Mapbox suggests using this
 * component for a maximum of around 100 views displayed at one time.
 *
 * This is implemented with view annotations on [Android](https://docs.mapbox.com/android/maps/guides/annotations/view-annotations/)
 * and [iOS](https://docs.mapbox.com/ios/maps/guides/annotations/view-annotations).
 *
 * This component has no dedicated `onPress` method. Instead, handle gestures
 * with the React views passed in as `children` — Pressable, TouchableOpacity,
 * etc. all work including their visual feedback (opacity, scale, etc.).
 */
const MarkerView = ({
  anchor = DEFAULT_ANCHOR,
  allowOverlap = false,
  allowOverlapWithPuck = false,
  isSelected = false,
  coordinate,
  style,
  children
}) => {
  // Android new-arch (Fabric) fix: UIManager.measure reads from the Fabric shadow
  // tree, which doesn't include Mapbox's native setTranslationX/Y positioning.
  // Strategy: intercept setTranslationX/Y on the native side (see
  // RNMBXMarkerViewContent.kt), relay the values as an onAnnotationPosition event,
  // then apply them as a React `transform` on RNMBXMarkerView so the shadow tree
  // reflects the actual on-screen position. This makes
  // Pressability._responderRegion correct and onPress / touch feedback work.
  //
  // Key details:
  //  • position:'absolute' on RNMBXMarkerView → all markers have Yoga pos (0,0)
  //    in MapView, so the only shadow-tree offset is the transform itself.
  //  • Transform goes on RNMBXMarkerView (not RNMBXMarkerViewContent) so Fabric
  //    never fights Mapbox's native positioning.
  //  • PIXEL_RATIO: Android translationX/Y is in device pixels; React transform
  //    expects logical pixels (points).
  const [annotationTranslate, setAnnotationTranslate] = useState(null);

  // Mirror of Kotlin-side dedup: skip setState when position hasn't changed so
  // we don't trigger a re-render for no-op native position re-applications.
  const lastTranslateRef = useRef(null);
  const handleTouchEnd = useCallback(e => {
    e.stopPropagation();
  }, []);
  const handleAnnotationPosition = useCallback(e => {
    const x = e.nativeEvent.x / PIXEL_RATIO;
    const y = e.nativeEvent.y / PIXEL_RATIO;
    const last = lastTranslateRef.current;
    if (last !== null && last.x === x && last.y === y) return;
    lastTranslateRef.current = {
      x,
      y
    };
    setAnnotationTranslate({
      x,
      y
    });
  }, []);
  if (anchor.x < 0 || anchor.y < 0 || anchor.x > 1 || anchor.y > 1) {
    console.warn(`[MarkerView] Anchor with value (${anchor.x}, ${anchor.y}) should not be outside the range [(0, 0), (1, 1)]`);
  }
  const nativeCoordinate = useMemo(() => [Number(coordinate[0]), Number(coordinate[1])],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [coordinate[0], coordinate[1]]);
  const nativeStyle = useMemo(() => [styles.absolutePosition, style, annotationTranslate != null ? {
    transform: [{
      translateX: annotationTranslate.x
    }, {
      translateY: annotationTranslate.y
    }]
  } : undefined], [style, annotationTranslate]);
  return /*#__PURE__*/_jsx(RNMBXMarkerView, {
    style: nativeStyle,
    coordinate: nativeCoordinate,
    anchor: anchor,
    allowOverlap: allowOverlap,
    allowOverlapWithPuck: allowOverlapWithPuck,
    isSelected: isSelected,
    onTouchEnd: handleTouchEnd,
    children: /*#__PURE__*/_jsx(RNMBXMakerViewContentComponent, {
      collapsable: false,
      style: styles.contentContainer,
      onAnnotationPosition: handleAnnotationPosition,
      children: children
    })
  });
};
const RNMBXMarkerView = NativeMarkerViewComponent;
const styles = StyleSheet.create({
  absolutePosition: {
    position: 'absolute'
  },
  contentContainer: {
    flex: 0,
    alignSelf: 'flex-start'
  }
});
export default MarkerView;
//# sourceMappingURL=MarkerView.js.map