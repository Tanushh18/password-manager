import React from 'react';
import ReactDOM from 'react-dom';
import './styles/theme.css';
import './index.css';
import App from './App';
import { store } from "./redux/store";
import { Provider } from "react-redux";
import { register as registerServiceWorker } from "./serviceWorkerRegistration";

ReactDOM.render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
  document.getElementById('root')
);

// Makes Aurelia installable on phones and usable offline.
registerServiceWorker();
