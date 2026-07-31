import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.scss";
import App from "./App.jsx";
import { AdapterProvider } from "./adapters/AdapterContext.jsx";
import { createAdapter } from "./adapters/index.js";

const root = createRoot(document.getElementById("root"));

async function boot() {
  try {
    const adapter = await createAdapter();
    root.render(
      <StrictMode>
        <AdapterProvider adapter={adapter}>
          <App />
        </AdapterProvider>
      </StrictMode>
    );
  } catch (error) {
    root.render(
      <div className="boot-screen boot-screen--error">
        <strong>Could not open miniCMS</strong>
        <p>{error.message}</p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }
}

boot();
