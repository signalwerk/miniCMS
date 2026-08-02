const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 15;
const ID_PATTERN = /^[a-z0-9]{15}$/;
const MAX_UNBIASED_BYTE = 252;

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function createId(usedIds) {
  let id;
  do {
    id = "";
    while (id.length < ID_LENGTH) {
      for (const value of randomBytes(ID_LENGTH * 2)) {
        if (value >= MAX_UNBIASED_BYTE) continue;
        id += ID_ALPHABET[value % ID_ALPHABET.length];
        if (id.length === ID_LENGTH) break;
      }
    }
  } while (usedIds?.has(id));
  usedIds?.add(id);
  return id;
}

function isGeneratedIdWidget(widget) {
  return widget === "id" || widget === "uuid";
}

export {
  ID_ALPHABET,
  ID_LENGTH,
  ID_PATTERN,
  createId,
  isGeneratedIdWidget
};
