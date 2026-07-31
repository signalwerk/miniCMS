import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";

const AdapterContext = createContext(null);

function AdapterProvider({ adapter, children }) {
  const [session, setSession] = useState(() => adapter.session());

  useEffect(
    () => adapter.subscribeSession(setSession),
    [adapter]
  );

  const value = useMemo(
    () => ({
      adapter,
      session,
      login: () => adapter.login(),
      logout: () => adapter.logout()
    }),
    [adapter, session]
  );

  return (
    <AdapterContext.Provider value={value}>
      {children}
    </AdapterContext.Provider>
  );
}

function useAdapterContext() {
  const context = useContext(AdapterContext);
  if (!context) {
    throw new Error("miniCMS storage adapter is not available.");
  }
  return context;
}

function useAdapter() {
  return useAdapterContext().adapter;
}

export { AdapterProvider, useAdapter, useAdapterContext };
