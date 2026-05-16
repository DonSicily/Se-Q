"use strict";

import React from 'react';
import { NativeModules } from 'react-native';
import RNMBXRasterParticleLayerNativeComponent from '../specs/RNMBXRasterParticleLayerNativeComponent';
import AbstractLayer from "./AbstractLayer.js";
import { jsx as _jsx } from "react/jsx-runtime";
const Mapbox = NativeModules.RNMBXModule;

// @{codepart-replace-start(LayerPropsCommon.codepart-tsx)}

// @{codepart-replace-end}

/**
 * RasterParticleLayer renders a particle animation driven by velocity data from a raster array source.
 * This is typically used to visualize wind patterns, ocean currents, or other directional flow data.
 *
 * @experimental This component requires Mapbox Maps SDK v11.4.0 or later
 */
class RasterParticleLayer extends AbstractLayer {
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
      _jsx(RNMBXRasterParticleLayerNativeComponent, {
        ref: this.setNativeLayer,
        ...props
      })
    );
  }
}
export default RasterParticleLayer;
//# sourceMappingURL=RasterParticleLayer.js.map