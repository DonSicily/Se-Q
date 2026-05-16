import type { ViewProps } from 'react-native';
import { OnMapSteadyEvent } from '../specs/RNMBXCameraGestureObserverNativeComponent';
type Props = ViewProps & {
    /**
     * Time in milliseconds to wait after last camera change before emitting 'steady' event.
     * Default is 200ms.
     */
    quietPeriodMs?: number;
    /**
     * Maximum time in milliseconds before emitting 'timeout' event during continuous activity.
     */
    maxIntervalMs?: number;
    /**
     * Callback when the map reaches a steady state (no active gestures or animations).
     */
    onMapSteady?: (event: {
        nativeEvent: OnMapSteadyEvent;
    }) => void;
};
/**
 * CameraGestureObserver
 *
 * Unified native observer optimized for onMapSteady.
 */
declare const _default: import("react").MemoExoticComponent<(props: Props) => import("react/jsx-runtime").JSX.Element>;
export default _default;
//# sourceMappingURL=CameraGestureObserver.d.ts.map