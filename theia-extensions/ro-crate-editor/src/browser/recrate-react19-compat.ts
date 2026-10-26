import ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';

// ReCrate bundles Ant Design 5, whose rc-util renderer reads createRoot from
// react-dom when its module first loads. React 19 exports it from react-dom/client.
// Install the compatible renderer before importing ReCrate's bundle.
const compatibleReactDOM = ReactDOM as typeof ReactDOM & {
    createRoot?: typeof createRoot;
};
compatibleReactDOM.createRoot ??= createRoot;
