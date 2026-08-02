function focusPropsForNode(
  nodeId,
  { selectedId, onSelectNode, onBoundary = null }
) {
  const id = typeof nodeId === "string" ? nodeId : "";
  if (!id) return {};
  const selected = id === selectedId;
  return {
    ref: onBoundary ? (element) => onBoundary(id, element) : undefined,
    tabIndex: 0,
    role: "button",
    "aria-label": `Select content node ${id}`,
    "aria-pressed": selected,
    "data-minicms-node-id": id,
    "data-minicms-selected": selected ? "true" : undefined,
    onClick(event) {
      event.stopPropagation();
      if (
        event.target?.closest?.(
          "a[href], button[type='submit'], input[type='submit'], [formaction]"
        )
      ) {
        event.preventDefault();
      }
      event.currentTarget?.focus?.({ preventScroll: true });
      onSelectNode(id);
    },
    onKeyDown(event) {
      if (
        !["Enter", " "].includes(event.key) ||
        event.repeat ||
        event.target !== event.currentTarget
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onSelectNode(id);
    }
  };
}

export { focusPropsForNode };
