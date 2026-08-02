function createPreviewRegistry() {
  let component = null;
  let locked = false;

  function registerPreview(nextComponent) {
    if (locked) {
      throw new Error(
        "miniCMS.registerPreview must be called before miniCMS.init."
      );
    }
    if (typeof nextComponent !== "function") {
      throw new TypeError(
        "miniCMS.registerPreview requires one React component."
      );
    }
    component = nextComponent;
  }

  function lockPreviewRegistration() {
    locked = true;
    return component;
  }

  return Object.freeze({ lockPreviewRegistration, registerPreview });
}

const previewRegistry = createPreviewRegistry();
const registerPreview = previewRegistry.registerPreview;
const lockPreviewRegistration = previewRegistry.lockPreviewRegistration;

export {
  createPreviewRegistry,
  lockPreviewRegistration,
  registerPreview
};
