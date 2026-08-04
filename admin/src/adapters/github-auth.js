function parseAuthorizationMessage(message) {
  if (typeof message !== "string") return null;
  if (message === "authorizing:github") {
    return { status: "authorizing" };
  }
  const prefix = "authorization:github:";
  if (!message.startsWith(prefix)) return null;
  const payload = message.slice(prefix.length);
  const separator = payload.indexOf(":");
  if (separator < 0) return null;
  const status = payload.slice(0, separator);
  const raw = payload.slice(separator + 1);
  if (status !== "success") {
    return {
      status: "error",
      error: raw.replace(/^"|"$/g, "") || "GitHub authorization failed."
    };
  }
  try {
    const result = JSON.parse(raw);
    if (!result?.token) {
      return {
        status: "error",
        error: "GitHub authorization returned no token."
      };
    }
    return { status: "success", result };
  } catch {
    return {
      status: "error",
      error: "GitHub authorization returned an invalid response."
    };
  }
}

function browserStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function requestGitHubAuthorization({
  baseUrl,
  windowObject = window,
  popupName = "minicms-github-oauth"
}) {
  const normalizedBaseUrl = `${String(baseUrl).replace(/\/+$/, "")}/`;
  const authUrl = new URL("auth", normalizedBaseUrl);
  const authOrigin = authUrl.origin;

  return new Promise((resolve, reject) => {
    const popup = windowObject.open(
      authUrl.toString(),
      popupName,
      "popup=yes,width=700,height=800"
    );
    if (!popup) {
      reject(new Error("Allow popups to sign in with GitHub."));
      return;
    }

    let settled = false;
    const closePoll = windowObject.setInterval(() => {
      if (!popup.closed || settled) return;
      cleanup();
      reject(new Error("GitHub sign-in was closed."));
    }, 400);

    function cleanup() {
      settled = true;
      windowObject.clearInterval(closePoll);
      windowObject.removeEventListener("message", onMessage);
      popup.close();
    }

    function onMessage(event) {
      if (event.origin !== authOrigin || event.source !== popup) return;
      const authorization = parseAuthorizationMessage(event.data);
      if (!authorization) return;
      if (authorization.status === "authorizing") {
        popup.postMessage("ready", authOrigin);
        return;
      }
      cleanup();
      if (authorization.status === "error") {
        reject(new Error(authorization.error));
        return;
      }
      resolve(authorization.result);
    }

    windowObject.addEventListener("message", onMessage);
  });
}

function createGitHubAuth({
  baseUrl,
  repository,
  windowObject = window,
  storage = browserStorage()
}) {
  const storageKey = `minicms:github:${repository}:token`;
  let token = storage?.getItem(storageKey) || "";

  function storeToken(nextToken) {
    token = nextToken || "";
    if (!storage) return;
    if (token) storage.setItem(storageKey, token);
    else storage.removeItem(storageKey);
  }

  async function login() {
    const authorization = await requestGitHubAuthorization({
      baseUrl,
      windowObject
    });
    storeToken(authorization.token);
    return authorization;
  }

  return {
    getToken: () => token,
    login,
    logout: () => storeToken("")
  };
}

export {
  createGitHubAuth,
  parseAuthorizationMessage,
  requestGitHubAuthorization
};
