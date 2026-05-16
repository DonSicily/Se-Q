import type { HostComponent, ViewProps } from 'react-native';
import { DirectEventHandler, Float } from 'react-native/Libraries/Types/CodegenTypes';
type OnAnnotationPositionEvent = {
    x: Float;
    y: Float;
};
export interface NativeProps extends ViewProps {
    onAnnotationPosition?: DirectEventHandler<OnAnnotationPositionEvent>;
}
declare const _default: HostComponent<NativeProps>;
export default _default;
//# sourceMappingURL=RNMBXMarkerViewContentNativeComponent.d.ts.map