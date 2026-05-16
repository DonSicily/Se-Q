import type { ViewProps } from 'react-native';
import { DirectEventHandler, Double } from 'react-native/Libraries/Types/CodegenTypes';
import type { UnsafeMixed } from './codegenUtils';
export type OnMapSteadyEvent = {
    reason: 'steady' | 'timeout';
    idleDurationMs?: Double;
    lastGestureType?: string | null | undefined;
    timestamp: Double;
};
export interface NativeProps extends ViewProps {
    quietPeriodMs?: UnsafeMixed<number>;
    maxIntervalMs?: UnsafeMixed<number>;
    hasOnMapSteady: UnsafeMixed<boolean>;
    onMapSteady?: DirectEventHandler<OnMapSteadyEvent>;
}
declare const _default: (props: Omit<NativeProps, "ref"> & {
    ref?: React.Ref<import("react-native").HostInstance>;
}) => React.ReactNode;
export default _default;
//# sourceMappingURL=RNMBXCameraGestureObserverNativeComponent.d.ts.map