"use strict";

import React from 'react';
import { NativeModules } from 'react-native';
import { cloneReactChildrenWithProps } from "../utils/index.js";
import RNMBXRasterArraySourceNativeComponent from '../specs/RNMBXRasterArraySourceNativeComponent';
import AbstractSource from "./AbstractSource.js";
import { jsx as _jsx } from "react/jsx-runtime";
const Mapbox = NativeModules.RNMBXModule;
const isTileTemplateUrl = url => !!url && (url.includes('{z}') || url.includes('{bbox-') || url.includes('{quadkey}'));
/**
 * RasterArraySource is a map content source that supplies raster array image tiles to be shown on the map.
 * This is typically used for particle animations like wind or precipitation patterns.
 * The location of and metadata about the tiles are defined either by an option dictionary
 * or by an external file that conforms to the TileJSON specification.
 *
 * @experimental This component requires Mapbox Maps SDK v11.4.0 or later
 */
class RasterArraySource extends AbstractSource {
  static defaultProps = {
    id: Mapbox.StyleSource.DefaultSourceID
  };
  constructor(props) {
    super(props);
    if (isTileTemplateUrl(props.url)) {
      console.warn(`RasterArraySource 'url' property contains a Tile URL Template, but is intended for a StyleJSON URL. Please migrate your RasterArraySource to use: \`tileUrlTemplates=["${props.url}"]\` instead.`);
    }
  }
  render() {
    let {
      url
    } = this.props;
    let {
      tileUrlTemplates
    } = this.props;

    // Swapping url for tileUrlTemplates to provide backward compatibility
    // when RasterArraySource supported only tile url as url prop
    if (isTileTemplateUrl(url)) {
      tileUrlTemplates = [url];
      url = undefined;
    }
    const props = {
      ...this.props,
      id: this.props.id,
      existing: this.props.existing,
      url,
      tileUrlTemplates,
      minZoomLevel: this.props.minZoomLevel,
      maxZoomLevel: this.props.maxZoomLevel,
      tileSize: this.props.tileSize
    };
    return (
      /*#__PURE__*/
      // @ts-expect-error just codegen stuff
      _jsx(RNMBXRasterArraySourceNativeComponent, {
        ref: this.setNativeRef,
        ...props,
        children: cloneReactChildrenWithProps(this.props.children, {
          sourceID: this.props.id
        })
      })
    );
  }
}
export default RasterArraySource;
//# sourceMappingURL=RasterArraySource.js.map