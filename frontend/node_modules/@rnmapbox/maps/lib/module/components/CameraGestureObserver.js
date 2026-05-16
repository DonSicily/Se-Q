"use strict";

import { memo } from 'react';
import RNMBXCameraGestureObserverNativeComponent from '../specs/RNMBXCameraGestureObserverNativeComponent';
import { jsx as _jsx } from "react/jsx-runtime";
/**
 * CameraGestureObserver
 *
 * Unified native observer optimized for onMapSteady.
 */
export default /*#__PURE__*/memo(props => {
  return /*#__PURE__*/_jsx(RNMBXCameraGestureObserverNativeComponent, {
    ...props,
    hasOnMapSteady: props.onMapSteady ? true : false
  });
});
//# sourceMappingURL=CameraGestureObserver.js.map