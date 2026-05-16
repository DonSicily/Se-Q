"use strict";

import React from 'react';
import { NativeModules } from 'react-native';
import RNMBXHillshadeLayerNativeComponent from '../specs/RNMBXHillshadeLayerNativeComponent';
import AbstractLayer from "./AbstractLayer.js";
import { jsx as _jsx } from "react/jsx-runtime";
const Mapbox = NativeModules.RNMBXModule;

// @{codepart-replace-start(LayerPropsCommon.codepart-tsx)}

// @{codepart-replace-end}

class HillshadeLayer extends AbstractLayer {
  static defaultProps = {
    sourceID: Mapbox.StyleSource.DefaultSourceID
  };
  render() {
    const props = {
      ...this.baseProps,
      sourceLayerID: this.props.sourceLayerID
    };
    return (
      /*#__PURE__*/
      // @ts-expect-error just codegen stuff
      _jsx(RNMBXHillshadeLayerNativeComponent, {
        ref: this.setNativeLayer,
        ...props
      })
    );
  }
}
export default HillshadeLayer;
//# sourceMappingURL=HillshadeLayer.js.map