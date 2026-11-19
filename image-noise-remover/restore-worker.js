import * as ort from "./runtime/ort.webgpu.min.mjs";

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL("./runtime/", import.meta.url).href;
let session;
let modelName;
let provider;

function noise(length, seed) {
  let value = seed >>> 0;
  function uniform() {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return (((mixed ^ (mixed >>> 14)) >>> 0) + 0.5) / 4294967296;
  }
  const data = new Float32Array(length);
  for (let index = 0; index < length; index += 2) {
    const radius = Math.sqrt(-2 * Math.log(uniform()));
    const angle = 2 * Math.PI * uniform();
    data[index] = radius * Math.cos(angle);
    data[index + 1] = radius * Math.sin(angle);
  }
  return data;
}

const status = (message) => postMessage({ message });
const scalar = (value, dims) => new ort.Tensor("float32", Float32Array.of(value), dims);

async function load(name, executionProvider) {
  if (session) await session.release();
  session = undefined;
  status("Loading model on " + (executionProvider === "webgpu" ? "WebGPU" : "CPU") + "…");
  session = await ort.InferenceSession.create(new URL("./models/" + name + ".onnx", import.meta.url).href, {
    executionProviders: executionProvider === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
  });
  modelName = name;
  provider = executionProvider;
}

async function infer({ model, width, height, pixels, steps, seed, quality }) {
  const meanflow = model === "meanflow";
  const grayscale = model === "fbcnn-gray";
  const channels = grayscale ? 1 : 3;
  const stride = Math.ceil(width / 8) * 8;
  const paddedHeight = Math.ceil(height / 8) * 8;
  const plane = stride * paddedHeight;
  const data = new Float32Array(channels * plane);
  for (let y = 0; y < paddedHeight; y++) {
    for (let x = 0; x < stride; x++) {
      const source = (Math.min(y, height - 1) * width + Math.min(x, width - 1)) * 4;
      const target = y * stride + x;
      if (grayscale) {
        data[target] = Math.round(0.299 * pixels[source] + 0.587 * pixels[source + 1] + 0.114 * pixels[source + 2]) / 255;
      } else {
        for (let channel = 0; channel < 3; channel++) {
          data[target + plane * channel] = pixels[source + (meanflow ? channel : 2 - channel)] / 255;
        }
      }
    }
  }
  const image = new ort.Tensor("float32", data, [1, channels, paddedHeight, stride]);
  let restored;
  if (meanflow) {
    const dims = [1, 48, paddedHeight / 4, stride / 4];
    let state = new ort.Tensor("float32", noise(3 * plane, seed), dims);
    for (let step = steps; step > 0; step--) {
      status("Restoring on " + (provider === "webgpu" ? "WebGPU" : "CPU") + " " + (steps - step + 1) + "/" + steps);
      const feeds = { image, state, time: scalar(step / steps, [1]), previous_time: scalar((step - 1) / steps, [1]) };
      if (step === 1) {
        ({ restored } = await session.run(feeds, ["restored"]));
      } else {
        ({ next_state: state } = await session.run(feeds, ["next_state"]));
      }
    }
  } else {
    status("Restoring on " + (provider === "webgpu" ? "WebGPU" : "CPU") + "…");
    ({ restored } = await session.run({ image, quality: scalar(quality / 100, [1, 1]) }, ["restored"]));
  }
  const result = new Uint8ClampedArray(width * height * 4);
  const output = restored.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      const offset = y * stride + x;
      for (let channel = 0; channel < 3; channel++) {
        const source = grayscale ? 0 : meanflow ? channel : 2 - channel;
        result[target + channel] = output[source * plane + offset] * 255;
      }
      result[target + 3] = 255;
    }
  }
  return result;
}

self.onmessage = async ({ data }) => {
  try {
    let result;
    try {
      if (!session || modelName !== data.model) await load(data.model, navigator.gpu ? "webgpu" : "wasm");
      result = await infer(data);
    } catch (error) {
      if (!navigator.gpu || (session && provider === "wasm")) throw error;
      await load(data.model, "wasm");
      result = await infer(data);
    }
    postMessage({ result }, [result.buffer]);
  } catch (error) {
    postMessage({ error: error.message || String(error) });
  }
};
