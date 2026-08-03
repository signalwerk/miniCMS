import { init } from "./main.jsx";

const apiUrl = import.meta.env.MINICMS_PUBLIC_API_URL;

init({
  target: "#root",
  configUrl: new URL("/api/config", `${apiUrl}/`).toString(),
  environment: "development",
  connectorOptions: {
    development: { apiUrl }
  }
}).catch(() => {});
