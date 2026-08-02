import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import "./styles.scss";
import App from "./App.jsx";
import { AdapterProvider } from "./adapters/AdapterContext.jsx";
import { createAdapter } from "./adapters/index.js";
import { AuthenticationGate } from "./components/AuthenticationGate/AuthenticationGate.jsx";
import {
  lockPreviewRegistration,
  registerPreview
} from "./components/Preview/registration.js";

let initialization = null;

function resolveRoot(rootOrSelector) {
  const candidate = rootOrSelector ?? "#root";
  if (typeof candidate === "string") {
    const element = document.querySelector(candidate);
    if (element) return element;
    throw new Error(`Could not find the miniCMS root "${candidate}".`);
  }
  if (candidate?.nodeType === 1) return candidate;
  throw new TypeError(
    "miniCMS.init root/target must be an element or a CSS selector."
  );
}

function bootstrapUrl(configUrl) {
  if (configUrl === undefined || configUrl === null || configUrl === "") {
    return undefined;
  }
  return new URL(String(configUrl), document.baseURI);
}

function init(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("miniCMS.init options must be an object.");
  }
  if (initialization) return initialization;

  initialization = (async () => {
    const PreviewComponent = lockPreviewRegistration();
    const root = createRoot(resolveRoot(options.root ?? options.target));
    try {
      const suppliedAdapter =
        options.adapter && typeof options.adapter === "object"
          ? options.adapter
          : null;
      const adapter =
        suppliedAdapter ||
        (await createAdapter({
          adapterOverride:
            options.adapterOverride ??
            (typeof options.adapter === "string" ? options.adapter : undefined),
          bootstrapConfig: options.config,
          bootstrapUrl: bootstrapUrl(options.configUrl),
          fetchImpl: options.fetchImpl,
          apiOptions: options.apiOptions,
          githubOptions: options.githubOptions
        }));
      const application = (
        <AdapterProvider adapter={adapter}>
          <AuthenticationGate>
            <App PreviewComponent={PreviewComponent} />
          </AuthenticationGate>
        </AdapterProvider>
      );
      root.render(
        options.strictMode === false ? (
          application
        ) : (
          <React.StrictMode>{application}</React.StrictMode>
        )
      );
      return Object.freeze({ adapter, root });
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
      throw error;
    }
  })();
  return initialization;
}

const runtime = Object.freeze({
  React,
  init,
  jsxRuntime,
  registerPreview
});

if (typeof window !== "undefined") {
  window.miniCMS = runtime;
  window.dispatchEvent(
    new CustomEvent("minicms:ready", { detail: runtime })
  );
}

export { init, registerPreview };
