function requiresAdapterLogin(adapter, session) {
  return Boolean(
    session?.authenticationRequired && !session?.authenticated
  );
}

export { requiresAdapterLogin };
