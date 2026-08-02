function javascriptString(value) {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function inlineCssPlugin() {
  return {
    name: "minicms-inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(
        (entry) => entry.type === "chunk"
      );
      if (chunks.length !== 1 || !chunks[0].isEntry) {
        this.error(
          "The miniCMS browser build must contain exactly one JavaScript entry."
        );
      }

      const cssAssets = Object.entries(bundle)
        .filter(
          ([fileName, entry]) =>
            entry.type === "asset" && fileName.endsWith(".css")
        )
        .sort(([left], [right]) => left.localeCompare(right));
      const otherAssets = Object.entries(bundle).filter(
        ([fileName, entry]) =>
          entry.type === "asset" &&
          !fileName.endsWith(".css")
      );
      if (otherAssets.length) {
        this.error(
          `The miniCMS browser build emitted external assets: ${otherAssets
            .map(([fileName]) => fileName)
            .join(", ")}.`
        );
      }

      const css = cssAssets
        .map(([, asset]) =>
          typeof asset.source === "string"
            ? asset.source
            : Buffer.from(asset.source).toString("utf8")
        )
        .join("\n");
      for (const [fileName] of cssAssets) delete bundle[fileName];
      if (!css) return;

      chunks[0].code = `(()=>{if(typeof document==="undefined"||document.querySelector("style[data-minicms-styles]"))return;const style=document.createElement("style");style.setAttribute("data-minicms-styles","");const script=document.currentScript;if(script&&script.nonce)style.nonce=script.nonce;style.textContent=${javascriptString(css)};(document.head||document.documentElement).appendChild(style)})();\n${chunks[0].code}`;
    }
  };
}

export { inlineCssPlugin };
