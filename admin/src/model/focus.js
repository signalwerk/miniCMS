function focusableElements(root) {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll(
      "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [contenteditable='true'], [tabindex]:not([tabindex='-1'])"
    )
  ).filter(
    (element) =>
      element.getClientRects().length > 0 &&
      !element.closest("[hidden], [aria-hidden='true']")
  );
}

function isolateFocusSurface(surface) {
  const states = [];
  let current = surface;
  while (current?.parentElement) {
    const parent = current.parentElement;
    for (const sibling of parent.children) {
      if (sibling === current || !(sibling instanceof HTMLElement)) continue;
      if (
        sibling.matches(
          "[data-portal], [data-mantine-shared-portal-node], .tags-select__menu-portal, [aria-live], [role='alert'], [role='status'], .toast, .dialog-backdrop"
        )
      ) {
        continue;
      }
      states.push({
        element: sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute("aria-hidden")
      });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    current = parent;
    if (parent === document.body) break;
  }

  return () => {
    for (const state of states) {
      state.element.inert = state.inert;
      if (state.ariaHidden === null) {
        state.element.removeAttribute("aria-hidden");
      } else {
        state.element.setAttribute("aria-hidden", state.ariaHidden);
      }
    }
  };
}

export { focusableElements, isolateFocusSurface };
