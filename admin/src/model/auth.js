function requiresAdapterLogin(adapter, session) {
  return adapter?.name === "github" && !session?.authenticated;
}

export { requiresAdapterLogin };
