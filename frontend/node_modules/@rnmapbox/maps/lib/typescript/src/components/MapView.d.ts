import React, { Component } from 'react';
import { ViewProps, NativeSyntheticEvent, NativeMethods, LayoutChangeEvent } from 'react-native';
import { type NativeMapViewActual } from '../specs/RNMBXMapViewNativeComponent';
import { type NativeArg, type OrnamentPositonProp } from '../utils';
import Logger from '../utils/Logger';
import type { FilterExpression } from '../utils/MapboxStyles';
import { type Position } from '../types/Position';
import { type Location } from '../modules/location/locationManager';
export type Point = {
    x: number;
    y: number;
};
type BBox = [number, number, number, number];
export type RegionPayload = {
    zoomLevel: number;
    heading: number;
    animated: boolean;
    isUserInteraction: boolean;
    visibleBounds: GeoJSON.Position[];
    pitch: number;
};
export type ScreenPointPayload = {
    readonly screenPointX: number;
    readonly screenPointY: number;
};
export type GestureSettings = {
    /**
     * Whether double tapping the map with one touch results in a zoom-in animation.
     */
    doubleTapToZoomInEnabled?: boolean;
    /**
     * Whether single tapping the map with two touches results in a zoom-out animation.
     */
    doubleTouchToZoomOutEnabled?: boolean;
    /**
     * Whether pan/scroll is enabled for the pinch gesture.
     */
    pinchPanEnabled?: boolean;
    /**
     * Whether zoom is enabled for the pinch gesture.
     */
    pinchZoomEnabled?: boolean;
    /**
     * Whether a deceleration animation following a pinch-zoom gesture is enabled. True by default.
     * (Android only)
     */
    pinchZoomDecelerationEnabled?: boolean;
    /**
     * Whether the pitch gesture is enabled.
     */
    pitchEnabled?: boolean;
    /**
     * Whether the quick zoom gesture is enabled.
     */
    quickZoomEnabled?: boolean;
    /**
     * Whether the rotate gesture is enabled.
     */
    rotateEnabled?: boolean;
    /**
     * Whether a deceleration animation following a rotate gesture is enabled. True by default.
     * (Android only)
     */
    rotateDecelerationEnabled?: boolean;
    /**
     * Whether the single-touch pan/scroll gesture is enabled.
     */
    panEnabled?: boolean;
    /**
     * A constant factor that determines how quickly pan deceleration animations happen. Multiplied with the velocity vector once per millisecond during deceleration animations.
     *
     * On iOS Defaults to UIScrollView.DecelerationRate.normal.rawValue
     * On android set to 0 to disable deceleration, and non zero to enabled it.
     */
    panDecelerationFactor?: number;
    /**
     * Whether rotation is enabled for the pinch zoom gesture.
     */
    simultaneousRotateAndPinchZoomEnabled?: boolean;
    /**
     * The amount by which the zoom level increases or decreases during a double-tap-to-zoom-in or double-touch-to-zoom-out gesture. 1.0 by default. Must be positive.
     * (Android only)
     */
    zoomAnimationAmount?: number;
};
/**
 * v10 only
 */
export type MapState = {
    properties: {
        center: GeoJSON.Position;
        bounds: {
            ne: GeoJSON.Position;
            sw: GeoJSON.Position;
        };
        zoom: number;
        heading: number;
        pitch: number;
    };
    gestures: {
        isGestureActive: boolean;
    };
    timestamp?: number;
};
/**
 * label localization settings (v10 only). `true` is equivalent to current locale.
 */
type LocalizeLabels = {
    /** locale code like `es` or `current` for the device's current locale */
    locale: string;
    /** layer id to localize. If not specified, all layers will be localized */
    layerIds?: string[];
} | true;
type Props = ViewProps & {
    /**
     * The distance from the edges of the map view’s frame to the edges of the map view’s logical viewport.
     * @deprecated use Camera `padding` instead
     */
    contentInset?: number | number[];
    /**
     * The projection used when rendering the map
     */
    projection?: 'mercator' | 'globe';
    /**
     * Style URL for map - notice, if non is set it _will_ default to `Mapbox.StyleURL.Street`
     */
    styleURL?: string;
    /**
     * StyleJSON for map - according to TileJSON specs: https://github.com/mapbox/tilejson-spec
     */
    styleJSON?: string;
    /**
     * iOS: The preferred frame rate at which the map view is rendered.
     * The default value for this property is MGLMapViewPreferredFramesPerSecondDefault,
     * which will adaptively set the preferred frame rate based on the capability of
     * the user’s device to maintain a smooth experience. This property can be set to arbitrary integer values.
     *
     * Android: The maximum frame rate at which the map view is rendered, but it can't exceed the ability of device hardware.
     * This property can be set to arbitrary integer values.
     */
    preferredFramesPerSecond?: number;
    /**
     * Enable/Disable zoom on the map
     */
    zoomEnabled?: boolean;
    /**
     * Enable/Disable scroll on the map
     */
    scrollEnabled?: boolean;
    /**
     * Enable/Disable pitch on map
     */
    pitchEnabled?: boolean;
    /**
     * Maximum allowed pitch in degrees. Mirrors the Mapbox map option `maxPitch`.
     */
    maxPitch?: number;
    /**
     * Enable/Disable rotation on map
     */
    rotateEnabled?: boolean;
    /**
     * The Mapbox terms of service, which governs the use of Mapbox-hosted vector tiles and styles,
     * [requires](https://www.mapbox.com/help/how-attribution-works/) these copyright notices to accompany any map that features Mapbox-designed styles, OpenStreetMap data, or other Mapbox data such as satellite or terrain data.
     * If that applies to this map view, do not hide this view or remove any notices from it.
     *
     * You are additionally [required](https://www.mapbox.com/help/how-mobile-apps-work/#telemetry) to provide users with the option to disable anonymous usage and location sharing (telemetry).
     * If this view is hidden, you must implement this setting elsewhere in your app. See our website for [Android](https://www.mapbox.com/android-docs/map-sdk/overview/#telemetry-opt-out) and [iOS](https://www.mapbox.com/ios-sdk/#telemetry_opt_out) for implementation details.
     *
     * Enable/Disable attribution on map. For iOS you need to add MGLMapboxMetricsEnabledSettingShownInApp=YES
     * to your Info.plist
     */
    attributionEnabled?: boolean;
    /**
     * Adds attribution offset, e.g. `{top: 8, left: 8}` will put attribution button in top-left corner of the map. By default on Android, the attribution with information icon (i) will be on the bottom left, while on iOS the mapbox logo will be on bottom left with information icon (i) on bottom right. Read more about mapbox attribution [here](https://docs.mapbox.com/help/getting-started/attribution/)
     */
    attributionPosition?: OrnamentPositonProp;
    /**
     * MapView's tintColor
     */
    tintColor?: string | number[];
    /**
     * Enable/Disable the logo on the map.
     */
    logoEnabled?: boolean;
    /**
     * Adds logo offset, e.g. `{top: 8, left: 8}` will put the logo in top-left corner of the map
     */
    logoPosition?: OrnamentPositonProp;
    /**
     * Enable/Disable the compass from appearing on the map
     */
    compassEnabled?: boolean;
    /**
     * [`mapbox` (v10) implementation only] Enable/Disable if the compass should fade out when the map is pointing north
     */
    compassFadeWhenNorth?: boolean;
    /**
     * [`mapbox` (v10) implementation only] Adds compass offset, e.g. `{top: 8, left: 8}` will put the compass in top-left corner of the map
     */
    compassPosition?: OrnamentPositonProp;
    /**
     * Change corner of map the compass starts at. 0: TopLeft, 1: TopRight, 2: BottomLeft, 3: BottomRight
     */
    compassViewPosition?: number;
    /**
     * Add margins to the compass with x and y values
     */
    compassViewMargins?: Point;
    /**
     * [iOS, `mapbox` (v10) implementation only] A string referencing an image key. Requires an `Images` component.
     */
    compassImage?: string;
    /**
     * [`mapbox` (v10) implementation only] Enable/Disable the scale bar from appearing on the map
     */
    scaleBarEnabled?: boolean;
    /**
     * [`mapbox` (v10) implementation only] Adds scale bar offset, e.g. `{top: 8, left: 8}` will put the scale bar in top-left corner of the map
     */
    scaleBarPosition?: OrnamentPositonProp;
    /**
     * [Android only] Enable/Disable use of GLSurfaceView instead of TextureView.
     */
    surfaceView?: boolean;
    /**
     * [Android only] Experimental, call requestDisallowInterceptTouchEvent on parent with onTochEvent, this allows touch interaction to work
     * when embedded into a scroll view
     */
    requestDisallowInterceptTouchEvent?: boolean;
    /**
     * [`mapbox` (v10) implementation only]
     * Set map's label locale, e.g. `{ "locale": "es" }` will localize labels to Spanish, `{ "locale": "current" }` will localize labels to system locale.
     */
    localizeLabels?: LocalizeLabels;
    /**
     * Gesture configuration allows to control the user touch interaction.
     */
    gestureSettings?: GestureSettings;
    /**
     * Map press listener, called when a user presses the map.
     */
    onPress?: (feature: GeoJSON.Feature<GeoJSON.Point, ScreenPointPayload>) => void;
    /**
     * Map long press listener, called when a user long presses the map.
     */
    onLongPress?: (feature: GeoJSON.Feature<GeoJSON.Point, ScreenPointPayload>) => void;
    /**
     * <v10 only
     *
     * This event is triggered whenever the currently displayed map region is about to change.
     *
     * @param {PointFeature} feature - The geojson point feature at the camera center, properties contains zoomLevel, visibleBounds
     */
    onRegionWillChange?: (feature: GeoJSON.Feature<GeoJSON.Point, RegionPayload>) => void;
    /**
     *
     * This event is triggered whenever the currently displayed map region is changing.
     *
     * @param {PointFeature} feature - The geojson point feature at the camera center, properties contains zoomLevel, visibleBounds
     */
    onRegionIsChanging?: (feature: GeoJSON.Feature<GeoJSON.Point, RegionPayload>) => void;
    /**
     *
     * This event is triggered whenever the currently displayed map region finished changing.
     *
     * @param {PointFeature} feature - The geojson point feature at the camera center, properties contains zoomLevel, visibleBounds
     */
    onRegionDidChange?: (feature: GeoJSON.Feature<GeoJSON.Point, RegionPayload>) => void;
    /**
     * v10 only, replaces onRegionIsChanging
     */
    onCameraChanged?: (state: MapState) => void;
    /**
     * v10 only, replaces onRegionDidChange
     */
    onMapIdle?: (state: MapState) => void;
    /**
     * This event is triggered when the map is about to start loading a new map style.
     */
    onWillStartLoadingMap?: () => void;
    /**
     * This is triggered when the map has successfully loaded a new map style.
     */
    onDidFinishLoadingMap?: () => void;
    /**
     * This event is triggered when the map has failed to load a new map style. On v10 it's deprecated and replaced by onMapLoadingError
     * @deprecated use onMapLoadingError
     */
    onDidFailLoadingMap?: () => void;
    /**
     * This event is tiggered when there is an error during map load. V10 only, replaces onDidFailLoadingMap, might be called multiple times and not exclusive with onDidFinishLoadingMap.
     */
    onMapLoadingError?: () => void;
    /**
     * This event is triggered when the map will start rendering a frame.
     */
    onWillStartRenderingFrame?: () => void;
    /**
     * This event is triggered when the map finished rendering a frame.
     */
    onDidFinishRenderingFrame?: () => void;
    /**
     * This event is triggered when the map fully finished rendering a frame.
     */
    onDidFinishRenderingFrameFully?: () => void;
    /**
     * This event is triggered when the map will start rendering the map.
     */
    onWillStartRenderingMap?: () => void;
    /**
     * This event is triggered when the map finished rendering the map.
     */
    onDidFinishRenderingMap?: () => void;
    /**
     * This event is triggered when the map fully finished rendering the map.
     */
    onDidFinishRenderingMapFully?: () => void;
    /**
     * This event is triggered when the user location is updated.
     */
    onUserLocationUpdate?: (feature: Location) => void;
    /**
     * This event is triggered when a style has finished loading.
     */
    onDidFinishLoadingStyle?: () => void;
    /**
     * The emitted frequency of regionwillchange events
     */
    regionWillChangeDebounceTime?: number;
    /**
     * The emitted frequency of regiondidchange events
     */
    regionDidChangeDebounceTime?: number;
    /**
     * Set to true to deselect any selected annotation when the map is tapped. If set to true you will not receive
     * the onPress event for the taps that deselect the annotation. Default is false.
     */
    deselectAnnotationOnTap?: boolean;
    /**
     * @private Experimental support for custom MapView instances
     */
    mapViewImpl?: string;
    /**
     * @private Experimental support for custom MapView instances
     */
    _nativeImpl?: NativeMapViewActual;
};
declare const CallbablePropKeys: readonly ["onRegionWillChange", "onRegionIsChanging", "onRegionDidChange", "onUserLocationUpdate", "onWillStartLoadingMap", "onMapLoadingError", "onDidFinishLoadingMap", "onDidFailLoadingMap", "onWillStartRenderingFrame", "onDidFinishRenderingFrame", "onDidFinishRenderingFrameFully", "onWillStartRenderingMap", "onDidFinishRenderingMap", "onDidFinishRenderingMapFully", "onDidFinishLoadingStyle", "onMapIdle", "onCameraChanged"];
type CallbablePropKeys = typeof CallbablePropKeys[number];
type Debounced<F> = F & {
    clear(): void;
    flush(): void;
};
declare const MapView_base: {
    new (...args: any[]): {
        _turboModule: import("react-native").TurboModule;
        _preRefMapMethodQueue: Array<{
            method: {
                name: string;
                args: NativeArg[];
            };
            resolver: (value: NativeArg) => void;
        }>;
        _runPendingNativeMethods<RefType>(nativeRef: RefType): Promise<void>;
        _runNativeMethod<RefType, ReturnType = NativeArg>(methodName: string, nativeRef: RefType | undefined, args?: NativeArg[]): Promise<ReturnType>;
        context: unknown;
        setState<K extends never>(state: {} | ((prevState: Readonly<{}>, props: object) => {} | Pick<{}, K> | null) | Pick<{}, K> | null, callback?: (() => void) | undefined): void;
        forceUpdate(callback?: (() => void) | undefined): void;
        render(): React.ReactNode;
        readonly props: object;
        state: Readonly<{}>;
        componentDidMount?(): void;
        shouldComponentUpdate?(nextProps: object, nextState: Readonly<{}>, nextContext: any): boolean;
        componentWillUnmount?(): void;
        componentDidCatch?(error: Error, errorInfo: React.ErrorInfo): void;
        getSnapshotBeforeUpdate?(prevProps: object, prevState: Readonly<{}>): any;
        componentDidUpdate?(prevProps: object, prevState: Readonly<{}>, snapshot?: any): void;
        componentWillMount?(): void;
        UNSAFE_componentWillMount?(): void;
        componentWillReceiveProps?(nextProps: object, nextContext: any): void;
        UNSAFE_componentWillReceiveProps?(nextProps: object, nextContext: any): void;
        componentWillUpdate?(nextProps: object, nextState: Readonly<{}>, nextContext: any): void;
        UNSAFE_componentWillUpdate?(nextProps: object, nextState: Readonly<{}>, nextContext: any): void;
    };
} & {
    new (props: Props): React.PureComponent<Props, {}, any>;
    new (props: Props, context: any): React.PureComponent<Props, {}, any>;
    contextType?: React.Context<any> | undefined;
    propTypes?: any;
};
/**
 * MapView backed by Mapbox Native GL
 */
declare class MapView extends MapView_base {
    static defaultProps: Props;
    deprecationLogged: {
        contentInset: boolean;
        regionDidChange: boolean;
        regionIsChanging: boolean;
    };
    logger: Logger;
    _onDebouncedRegionWillChange: Debounced<(payload: GeoJSON.Feature<GeoJSON.Point, RegionPayload & {
        isAnimatingFromUserInteraction: boolean;
    }>) => void>;
    _onDebouncedRegionDidChange: Debounced<(payload: GeoJSON.Feature<GeoJSON.Point, RegionPayload & {
        isAnimatingFromUserInteraction: boolean;
    }>) => void>;
    _nativeRef?: RNMBXMapViewRefType;
    state: {
        isReady: boolean | null;
        region: null;
        width: number;
        height: number;
        isUserInteraction: boolean;
    };
    constructor(props: Props);
    componentDidMount(): void;
    componentWillUnmount(): void;
    componentDidUpdate(prevProps: Props): void;
    _setHandledMapChangedEvents(props: Props): void;
    /**
     * Converts a geographic coordinate to a screen coordinate relative to the map view.
     *
     * @example
     * const longitude = 144.949901;
     * const latitude = -37.817070;
     * const [x, y] = await this._map.getPointInView([longitude, latitude]);
     *
     * @param {Position} coordinate - A point expressed in the map view's coordinate system `[longitude, latitude]`.
     * @return {Position} A point expressed in screen coordinates relative to the map view `[x, y]`.
     */
    getPointInView(coordinate: Position): Promise<Position>;
    /**
     * Converts a screen coordinate relative to the map view to a geographic coordinate.
     *
     * @example
     * const x = 100; const y = 100;
     * const [longitude, latitude] = await this._map.getCoordinateFromView([x, y]);
     *
     * @param {Position} point - A point expressed in screen coordinates relative to the map view `[x, y]`.
     * @return {Position} A point expressed in the map view's coordinate system `[longitude, latitude]`.
     */
    getCoordinateFromView(point: Position): Promise<Position>;
    /**
     * The coordinate bounds of the map viewport.
     *
     * @example
     * const [[rightLon, topLat], [leftLon, bottomLat]] = await this._map.getVisibleBounds();
     *
     * @return {[Position, Position]} The geographic coordinate bounds of the map viewport `[[rightLon, topLat], [leftLon, bottomLat]]`.
     */
    getVisibleBounds(): Promise<[Position, Position]>;
    /**
     * Returns an array of rendered map features that intersect with a given point.
     *
     * @example
     * const x = 30; const y = 40;
     * this._map.queryRenderedFeaturesAtPoint([x, y], ['==', 'type', 'Point'], ['id1', 'id2'])
     *
     * @param  {Position} coordinate - A point expressed in the map view’s coordinate system `[x, y]`;
     * @param  {FilterExpression | []} filter - A set of strings that correspond to the names of layers defined in the current style. Only the features contained in these layers are included in the returned array.
     * @param  {string[]} layerIDs - A array of layer IDs by which to filter the features.
     * @return {FeatureCollection}  A GeoJSON feature collection containing the query results.
     */
    queryRenderedFeaturesAtPoint(coordinate: Position, filter?: FilterExpression | [], layerIDs?: string[]): Promise<GeoJSON.FeatureCollection | undefined>;
    /**
     * Returns an array of rendered map features that intersect with the given rectangle,
     * restricted to the given style layers and filtered by the given predicate. In v10,
     * passing an empty array will query the entire visible bounds of the map.
     *
     * @example
     * const left = 40; const top = 30;
     * const right = 10; const bottom = 20;
     * this._map.queryRenderedFeaturesInRect([top, left, bottom, right], ['==', 'type', 'Point'], ['id1', 'id2'])
     *
     * @param  {BBox | []} bbox - A rectangle expressed in density-independent screen coordinates relative to the map view `[top, left, bottom, right]` or `[minY, minX, maxY, maxX]` (not geographic coordinates). An empty array queries the visible map area.
     * @param  {FilterExpression} filter - An array of strings that correspond to the names of layers defined in the current style. Only the features contained in these layers are included in the returned array.
     * @param  {string[] | null} layerIDs -  A array of layer IDs by which to filter the features.
     * @return {FeatureCollection} A GeoJSON feature collection containing the query results.
     */
    queryRenderedFeaturesInRect(bbox: BBox | [], filter?: FilterExpression | [], layerIDs?: string[] | null): Promise<GeoJSON.FeatureCollection | undefined>;
    /**
     * Returns an array of GeoJSON Feature objects representing features within the specified vector tile or GeoJSON source that satisfy the query parameters.
     *
     * @example
     * this._map.querySourceFeatures('your-source-id', [], ['your-source-layer'])
     *
     * @param  {String} sourceId - Style source identifier used to query for source features.
     * @param  {FilterExpression | []} filter - A filter to limit query results.
     * @param  {string[]} sourceLayerIDs - The name of the source layers to query. For vector tile sources, this parameter is required. For GeoJSON sources, it is ignored.
     * @return {FeatureCollection} A GeoJSON feature collection.
     */
    querySourceFeatures(sourceId: string, filter?: FilterExpression | [], sourceLayerIDs?: string[]): Promise<GeoJSON.FeatureCollection>;
    /**
     * Map camera will perform updates based on provided config. Deprecated use Camera#setCamera.
     * @deprecated use Camera#setCamera
     */
    setCamera(): void;
    _runNative<ReturnType>(methodName: string, args?: NativeArg[]): Promise<ReturnType>;
    /**
     * Takes snapshot of map with current tiles and returns a Base64-encoded PNG image,
     * or an file-system URI to a temporary PNG file if `writeToDisk` is `true`.
     *
     * @param  {boolean} writeToDisk If `true`, creates a temporary PNG file and returns a file-system URI, otherwise returns a Base64-encoded PNG image. (Defaults to `false`)
     * @return {string} A a Base64-encoded PNG image or a file-system URI to a temporary PNG file.
     */
    takeSnap(writeToDisk?: boolean): Promise<string>;
    /**
     * Returns the current zoom of the map view.
     *
     * @example
     * const zoom = await this._map.getZoom();
     *
     * @return {number} The current zoom of the map view.
     */
    getZoom(): Promise<number>;
    /**
     * Returns the map's center point expressed as geographic coordinates `[longitude, latitude]`.
     *
     * @example
     * const center = await this._map.getCenter();
     *
     * @return {Position} The map's center point expressed as geographic coordinates `[longitude, latitude]`.
     */
    getCenter(): Promise<Position>;
    /**
     *
     * Clears temporary map data from the data path defined in the given resource
     * options. Useful to reduce the disk usage or in case the disk cache contains
     * invalid data.
     *
     * v10 only
     */
    clearData(): Promise<void>;
    /**
     * Queries the currently loaded data for elevation at a geographical location.
     * The elevation is returned in meters relative to mean sea-level.
     * Returns null if terrain is disabled or if terrain data for the location hasn't been loaded yet.
     *
     * @param {Position} coordinate - The geographic coordinates `[longitude, latitude]` at which to query elevation.
     * @return {number} Elevation in meters relative to mean sea-level.
     */
    queryTerrainElevation(coordinate: Position): Promise<number>;
    /**
     * Sets the visibility of all the layers referencing the specified `sourceLayerId` and/or `sourceId`
     *
     * @example
     * await this._map.setSourceVisibility(false, 'composite', 'building')
     *
     * @param {boolean} visible - Visibility of the layers
     * @param {string} sourceId - Target source identifier (e.g. 'composite')
     * @param {string | null} sourceLayerId - Target source-layer identifier (e.g. 'building'). If `null`, the change affects all layers in the target source.
     */
    setSourceVisibility(visible: boolean, sourceId: string, sourceLayerId?: string | null): void;
    /**
     * Updates the state map of a feature within a style source.
     *
     * Updates entries in the state map of a given feature within a style source.
     * Only entries listed in the `state` will be updated.
     * An entry in the feature state map that is not listed in `state` will retain its previous value.
     *
     * @param {string} featureId Identifier of the feature whose state should be updated.
     * @param {[k: string]: NativeArg} state Map of entries to update with their respective new values.
     * @param {string} sourceId Style source identifier.
     * @param {string | null} sourceLayerId Style source layer identifier (for multi-layer sources such as vector sources).
     */
    setFeatureState(featureId: string, state: {
        [k: string]: NativeArg;
    }, sourceId: string, sourceLayerId?: string | null): Promise<void>;
    /**
     * Returns the state map of a feature within a style source.
     *
     * @param {string} featureId Identifier of the feature whose state should be queried.
     * @param {string} sourceId Style source identifier.
     * @param {string | null} sourceLayerId Style source layer identifier (for multi-layer sources such as vector sources).
     */
    getFeatureState(featureId: string, sourceId: string, sourceLayerId?: string | null): Promise<Readonly<Record<string, unknown>>>;
    /**
     * Removes entries from a feature state object.
     *
     * Removes a specified property or all properties from a feature’s state object,
     * depending on the value of `stateKey`.
     *
     * @param {string} featureId Identifier of the feature whose state should be removed.
     * @param {string | null} stateKey The name of the property to remove. If `null`, all feature’s state object properties are removed.
     * @param {string} sourceId Style source identifier.
     * @param {string | null} sourceLayerId Style source layer identifier (for multi-layer sources such as vector sources).
     */
    removeFeatureState(featureId: string, stateKey: string | null, sourceId: string, sourceLayerId?: string | null): Promise<void>;
    _decodePayload<T>(payload: T | string): T;
    _onPress(e: NativeSyntheticEvent<{
        payload: GeoJSON.Feature<GeoJSON.Point, ScreenPointPayload> | string;
    }>): void;
    _onLongPress(e: NativeSyntheticEvent<{
        payload: GeoJSON.Feature<GeoJSON.Point, ScreenPointPayload> | string;
    }>): void;
    _onRegionWillChange(payload: GeoJSON.Feature<GeoJSON.Point, RegionPayload & {
        isAnimatingFromUserInteraction: boolean;
    }>): void;
    _onRegionDidChange(payload: GeoJSON.Feature<GeoJSON.Point, RegionPayload>): void;
    _onCameraChanged(e: NativeSyntheticEvent<{
        payload: MapState | string;
    }>): void;
    _onChange(e: NativeSyntheticEvent<{
        type: string;
        payload: GeoJSON.Feature<GeoJSON.Point, RegionPayload & {
            isAnimatingFromUserInteraction: boolean;
        }> | string;
    }>): void;
    _onLayout(e: LayoutChangeEvent): void;
    _handleOnChange(propName: CallbablePropKeys, payload: object): void;
    _getContentInset(): number[] | undefined;
    _setNativeRef(nativeRef: RNMBXMapViewRefType | null): void;
    setNativeProps(props: NativeProps): void;
    _setStyleURL(props: Props): void;
    _setLocalizeLabels(props: Props): void;
    render(): import("react/jsx-runtime").JSX.Element;
}
type NativeProps = Omit<Props, 'onPress' | 'onLongPress' | 'onCameraChanged'> & {
    onPress?: (event: NativeSyntheticEvent<{
        type: string;
        payload: string;
    }>) => void;
    onLongPress?: (event: NativeSyntheticEvent<{
        type: string;
        payload: string;
    }>) => void;
    onCameraChanged?: (event: NativeSyntheticEvent<{
        type: string;
        payload: string;
    }>) => void;
};
type RNMBXMapViewRefType = Component<NativeProps> & Readonly<NativeMethods>;
export default MapView;
//# sourceMappingURL=MapView.d.ts.map