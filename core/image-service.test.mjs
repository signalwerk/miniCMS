import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImageServiceMediaUrl,
  buildImageServiceUrl,
  imageServicePath,
  imageServiceMediaPath,
  normalizeHttpOrigin,
  normalizeImageProcessingConfig,
  parseContentAddressedMediaPath,
  parseImageServiceUrl,
  parseImageOperations,
  prependImageServiceOperations,
  serializeImageOperations,
  validateImageProcessingConfig
} from "./image-service.js";

const CONTENT_SHA =
  "c5a4c3f1bb4b1ba46407335be8e668361cf6c0383fc266a3657c268bf31ed2cc";
const imageSource = (filename, collection = "images") =>
  `/media/${collection}/${CONTENT_SHA}/${filename}`;

test("builds a readable canonical URL for content-addressed media", () => {
  const source = imageSource("big-picture.jpg");
  assert.deepEqual(parseContentAddressedMediaPath(source), {
    collection: "images",
    sha: CONTENT_SHA,
    filename: "big-picture.jpg",
    path: source
  });
  assert.equal(
    imageServicePath(source, {
      config: {
        site: {
          image_processing: {
            width: 1600,
            height: 900,
            fit: "inside",
            format: "avif",
            quality: 75,
            cache: { schema: "photos_2" }
          }
        }
      }
    }),
    `/photos_2/media/images/${CONTENT_SHA}/resize@width:1600,height:900,fit:inside;quality@75/big-picture.avif`
  );
});

test("preserves both JPEG output extensions", () => {
  const source = imageSource("photo.png");
  for (const format of ["jpg", "jpeg"]) {
    const route = imageServicePath(source, {
      width: 320,
      height: 240,
      format
    });
    assert.match(route, new RegExp(`/photo\\.${format}$`));
    assert.equal(parseImageServiceUrl(route)?.format, format);
    assert.equal(normalizeImageProcessingConfig({ format }).format, format);
    assert.equal(
      normalizeImageProcessingConfig({ format: format.toUpperCase() }).format,
      format
    );
    const cropped = prependImageServiceOperations(route, [{
      type: "crop",
      options: { left: 0, top: 0, width: 100, height: 80 }
    }]);
    assert.match(cropped, new RegExp(`/photo\\.${format}$`));
    assert.equal(parseImageServiceUrl(cropped)?.format, format);
  }
});

test("parses canonical relative and absolute derivative URLs", () => {
  const source = imageSource("big-picture.jpg");
  const relative = buildImageServiceUrl(source, {
    width: 800,
    height: 600,
    fit: "inside"
  });
  const absolute = buildImageServiceUrl(source, {
    baseUrl: "https://images.example.com",
    width: 800,
    height: 600,
    fit: "inside"
  });

  assert.deepEqual(parseImageServiceUrl(relative), {
    baseUrl: "",
    schema: "v1",
    collection: "images",
    sha: CONTENT_SHA,
    operations: [
      {
        type: "resize",
        options: { width: "800", height: "600", fit: "inside" }
      },
      { type: "quality", options: { value: "82" } }
    ],
    filename: "big-picture",
    format: "webp"
  });
  assert.deepEqual(parseImageServiceUrl(absolute), {
    ...parseImageServiceUrl(relative),
    baseUrl: "https://images.example.com"
  });
  assert.equal(parseImageServiceUrl(source), null);
  assert.equal(
    parseImageServiceUrl(relative.replace("quality@82", "quality@082")),
    null
  );
  assert.equal(
    parseImageServiceUrl("https://cdn.example.com/photo.webp"),
    null
  );
  assert.equal(
    parseImageServiceUrl(absolute.replace("/media/", "/%6dedia/")),
    null
  );
  assert.equal(
    parseImageServiceUrl(absolute.replace("https://", "https://user@")),
    null
  );
  assert.equal(parseImageServiceUrl(`${absolute}?download=1`), null);
  assert.equal(parseImageServiceUrl(`${relative}?`), null);
  assert.equal(parseImageServiceUrl(`${relative}#`), null);
  assert.equal(
    parseImageServiceUrl(relative.replace("/resize@", "/ignored/../resize@")),
    null
  );
  assert.equal(
    parseImageServiceUrl(
      `/media/_image/v1/images/${CONTENT_SHA}/big-picture.jpg/` +
        "resize@width:800,height:600,fit:inside;quality@82/big-picture.webp"
    ),
    null
  );
  assert.equal(
    parseImageServiceUrl(relative.replace("/big-picture.webp", "/Big_Picture.webp")),
    null
  );
  assert.equal(
    parseImageServiceUrl(
      relative.replace("/big-picture.webp", `/${"a".repeat(81)}.webp`)
    ),
    null
  );
});

test("rejects image-service sources outside the content-addressed layout", () => {
  assert.throws(
    () => imageServicePath("/media/Big Picture.jpg"),
    /<collection>\/<sha256>\/<filename>/
  );
});

test("uses exact SVG passthrough and preserves external image URLs", () => {
  const source = imageSource("vector.svg");
  assert.equal(
    imageServicePath(source),
    `/v1/media/images/${CONTENT_SHA}/noop/vector.svg`
  );
  assert.equal(
    buildImageServiceUrl(source, {
      baseUrl: "https://images.example.com"
    }),
    `https://images.example.com/v1/media/images/${CONTENT_SHA}/noop/vector.svg`
  );
  assert.equal(
    buildImageServiceUrl("https://cdn.example.com/already.webp", {
      baseUrl: "https://images.example.com"
    }),
    "https://cdn.example.com/already.webp"
  );
  assert.throws(
    () => buildImageServiceUrl(source, {
      baseUrl: "https://images.example.com/base/path"
    }),
    /origin/
  );
});

test("builds an info route for the original source metadata", () => {
  const source = `content/media/images/${CONTENT_SHA}/photo.png`;
  assert.equal(
    buildImageServiceUrl(source, { info: true }),
    `/v1/media/images/${CONTENT_SHA}/noop/photo.json`
  );
  assert.equal(
    buildImageServiceUrl(source, {
      info: true,
      width: 320,
      height: 180,
      quality: 25
    }),
    `/v1/media/images/${CONTENT_SHA}/noop/photo.json`
  );
});

test("maps API-backed raw media into the fixed service namespace", () => {
  const config = {
    site: {
      media_folder: "content/uploads",
      public_folder: "/assets/library"
    }
  };
  const publicFile =
    `/assets/library/files/${CONTENT_SHA}/report.pdf?download=1`;
  assert.equal(
    buildImageServiceMediaUrl(publicFile, {
      baseUrl: "https://content.example.test",
      config
    }),
    `https://content.example.test/media/files/${CONTENT_SHA}/report.pdf?download=1`
  );
  assert.equal(
    buildImageServiceMediaUrl(
      `content/uploads/files/${CONTENT_SHA}/report.pdf`,
      { config }
    ),
    `/media/files/${CONTENT_SHA}/report.pdf`
  );
  assert.equal(
    imageServiceMediaPath(
      `content/assets/library/files/${CONTENT_SHA}/report.pdf`,
      {
      site: {
        media_folder: "content/assets/library",
        public_folder: "/content"
      }
      }
    ),
    `/media/files/${CONTENT_SHA}/report.pdf`
  );
  assert.equal(
    buildImageServiceMediaUrl("https://cdn.example.test/report.pdf", {
      baseUrl: "https://content.example.test",
      config
    }),
    "https://cdn.example.test/report.pdf"
  );
  assert.equal(
    imageServicePath(
      `/assets/library/images/${CONTENT_SHA}/photo.jpg`,
      { config }
    ),
    `/v1/media/images/${CONTENT_SHA}/resize@width:2400,height:2400,fit:inside;quality@82/photo.webp`
  );
  const sha = "5211e169283f43ab8ad7ea7998d917d5fbb3c568ac85c1a0217e86792822684d";
  assert.deepEqual(
    parseContentAddressedMediaPath(
      `content/uploads/images/${sha}/vector.svg`,
      config
    ),
    {
      collection: "images",
      sha,
      filename: "vector.svg",
      path: `/media/images/${sha}/vector.svg`
    }
  );
});

test("display-specific sizes can downsample further but never exceed project limits", () => {
  const source = imageSource("photo.jpg");
  const config = {
    site: {
      image_processing: { width: 1200, height: 900 }
    }
  };
  assert.match(
    buildImageServiceUrl(source, {
      config,
      width: 320,
      height: 320
    }),
    /resize@width:320,height:320,fit:inside/
  );
  assert.match(
    buildImageServiceUrl(source, {
      config,
      width: 5000,
      height: 5000
    }),
    /resize@width:1200,height:900,fit:inside/
  );
});

test("strictly parses and canonicalizes image operations", () => {
  const source =
    "crop@left:-12.25,top:3.5,width:14000.75,height:300.25,rotation:-2.5;quality@90";
  const operations = parseImageOperations(source);
  assert.equal(serializeImageOperations(operations), source);
  assert.equal(
    serializeImageOperations([{
      type: "crop",
      options: {
        left: 0,
        top: 0,
        width: 10,
        height: 10,
        rotation: 1e-7
      }
    }]),
    "crop@left:0,top:0,width:10,height:10,rotation:0.0000001"
  );
  assert.equal(
    serializeImageOperations(parseImageOperations(
      "crop@left:0,top:0,width:10,height:10,rotation:0.00000010"
    )),
    "crop@left:0,top:0,width:10,height:10,rotation:0.0000001"
  );
  assert.deepEqual(parseImageOperations("resize@800;quality@70"), [
    {
      type: "resize",
      options: { width: "800", fit: "inside" }
    },
    { type: "quality", options: { value: "70" } }
  ]);

  for (const invalid of [
    "resize@width:800,width:900",
    "resize@width:9000",
    "resize@width:800,unknown:1",
    "crop@left:0,top:0,width:0,height:20",
    "crop@left:0,top:0,width:0.5,height:20",
    "crop@left:0,top:0,width:10,height:10,rotation:1e-7",
    "resize@width:20;crop@left:0,top:0,width:10,height:10,rotation:45",
    "crop@left:0,top:0,width:10,height:10,rotation:45;rotate@angle:90",
    "quality@101",
    "quality@80;quality@70",
    "quality@80;rotate@angle:90",
    "unknown@1",
    "noop@value:1",
    "noop;quality@80",
    "resize@@800"
  ]) {
    assert.throws(() => parseImageOperations(invalid), /Invalid image operations/);
  }
  assert.throws(
    () => parseImageOperations(`resize@width:1,${"x".repeat(256)}`),
    /too long/
  );
});

test("prepends source-space operations to canonical raster derivatives", () => {
  const relative =
    `/photos_2/media/images/${CONTENT_SHA}/` +
    "resize@width:1600,height:900,fit:inside;quality@75/big-picture.avif";
  const operations = [{
    type: "crop",
    options: {
      left: -12.25,
      top: 3.5,
      width: 800.75,
      height: 450.25,
      rotation: 12.25
    }
  }];
  const expected = relative.replace(
    "/resize@",
    "/crop@left:-12.25,top:3.5,width:800.75,height:450.25,rotation:12.25;resize@"
  );
  assert.equal(prependImageServiceOperations(relative, operations), expected);
  assert.equal(
    prependImageServiceOperations(
      `https://images.example.test${relative}`,
      operations
    ),
    `https://images.example.test${expected}`
  );
});

test("does not prepend operations to passthrough or non-service URLs", () => {
  const crop = [{
    type: "crop",
    options: { left: 0, top: 0, width: 10, height: 10 }
  }];
  for (const source of [
    imageSource("photo.jpg"),
    "https://github.example.test/photo.jpg",
    `/v1/media/images/${CONTENT_SHA}/noop/vector.svg`,
    `/v1/media/images/${CONTENT_SHA}/noop/photo.json`,
    `/v1/media/images/${CONTENT_SHA}/noop/photo.webp`,
    `/v1/media/images/${CONTENT_SHA}/rotate@angle:90;quality@82/photo.webp`
  ]) {
    assert.equal(prependImageServiceOperations(source, crop), null);
  }
  assert.throws(
    () => prependImageServiceOperations(
      `/v1/media/images/${CONTENT_SHA}/resize@width:20,fit:inside/photo.webp`,
      []
    ),
    /prepend/
  );
});

test("validates and normalizes processing and cache configuration", () => {
  assert.deepEqual(normalizeImageProcessingConfig({}), {
    width: 2400,
    height: 2400,
    fit: "inside",
    format: "webp",
    quality: 82,
    cache: { schema: "v1" }
  });
  assert.deepEqual(
    normalizeImageProcessingConfig({
      cache: {
        schema: "release-2",
        strategy: "immutable",
        max_age: 31_536_000
      }
    }).cache,
    { schema: "release-2" }
  );
  assert.throws(
    () => validateImageProcessingConfig({ cache: { schema: "../../bad" } }),
    /cache\.schema/
  );
  assert.throws(
    () => validateImageProcessingConfig({ width: 100_000 }),
    /width/
  );
});

test("normalizes service origins and maps configured public media paths", () => {
  assert.equal(
    normalizeHttpOrigin("https://images.example.com/", "Image URL"),
    "https://images.example.com"
  );
  assert.throws(
    () => normalizeHttpOrigin("https://images.example.com/path", "Image URL"),
    /Image URL/
  );
  assert.equal(
    imageServiceMediaPath(
      `/assets/library/files/${CONTENT_SHA}/report.pdf?download=1`,
      {
      site: {
        media_folder: "content/uploads",
        public_folder: "/assets/library"
      }
      }
    ),
    `/media/files/${CONTENT_SHA}/report.pdf?download=1`
  );
  assert.equal(
    buildImageServiceMediaUrl("//cdn.example.com/report.pdf", {
      baseUrl: "https://images.example.com"
    }),
    "//cdn.example.com/report.pdf"
  );
});

test("rejects unsafe or non-canonical content-addressed paths", () => {
  assert.throws(() => imageServicePath("/media/../secret.jpg"), /traverse/);
  assert.equal(
    parseContentAddressedMediaPath(
      "/media/images/ABCDEF/not-content-addressed.png"
    ),
    null
  );
});
