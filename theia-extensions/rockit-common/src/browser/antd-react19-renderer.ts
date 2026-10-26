// Ant Design 5 needs a React 19 renderer for its static message and modal APIs.
import { unstableSetRender } from 'antd';
import { createRoot, Root } from '@theia/core/shared/react-dom/client';

const roots = new WeakMap<Element | DocumentFragment, Root>();

unstableSetRender((node, container) => {
    let root = roots.get(container);
    if (!root) {
        root = createRoot(container);
        roots.set(container, root);
    }
    root.render(node);

    return async () => {
        // Ant Design may unmount while React is rendering another component.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        root.unmount();
        roots.delete(container);
    };
});
