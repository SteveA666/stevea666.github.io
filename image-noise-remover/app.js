const $ = (id) => document.getElementById(id);
const fileInput = $("file");
const original = $("original");
const result = $("result");
const context = original.getContext("2d", { willReadFrequently: true });
const resultContext = result.getContext("2d");
const status = $("status");
const comparison = $("comparison");
const stage = $("stage");
const appUrl = new URL(document.currentScript.src);
const workerUrl = new URL("./restore-worker.js", appUrl);
workerUrl.search = appUrl.search;
const openedFromDisk = location.protocol === "file:";
const localServerMessage = "To restore an image, open the app through a local HTTP server or GitHub Pages.";
let bitmap;
let filename;
let restored;
let worker;
let busy = false;
let opening = false;

function updateControls() {
  $("restore").disabled = busy || opening || !bitmap;
  $("save").disabled = busy || opening || !restored;
  $("strength").disabled = busy || opening || !restored;
  for (const key of ["file", "edge", "model", "steps", "seed", "random-seed", "quality"]) {
    $(key).disabled = busy || (opening && key === "edge");
  }
}

function showResult() {
  result.hidden = $("divider").hidden = $("compare-controls").hidden = !restored;
  updateControls();
}

function preparePreview() {
  const edge = $("edge").value;
  const scale = edge === "original" ? 1 : Math.min(1, Number(edge) / Math.max(bitmap.width, bitmap.height));
  original.width = result.width = Math.max(1, Math.round(bitmap.width * scale));
  original.height = result.height = Math.max(1, Math.round(bitmap.height * scale));
  context.fillStyle = "white";
  context.fillRect(0, 0, original.width, original.height);
  context.drawImage(bitmap, 0, 0, original.width, original.height);
  comparison.style.setProperty("--image-width", original.width + "px");
  comparison.hidden = false;
  $("empty").hidden = true;
  $("image-info").textContent = filename + " · " + original.width + " × " + original.height;
  restored = undefined;
  showResult();
  status.textContent = openedFromDisk ? localServerMessage : "Ready. Models are downloaded on first use.";
}

async function decodeImage(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    // Try the browser's image-element decoder if bitmap decoding fails.
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function openImage(file) {
  if (!file || busy || opening) return;
  opening = true;
  updateControls();
  try {
    const next = await decodeImage(file);
    bitmap?.close?.();
    bitmap = next;
    filename = file.name;
    preparePreview();
  } catch {
    status.textContent = "This image could not be opened. Try a JPEG, PNG or WebP file.";
  } finally {
    opening = false;
    updateControls();
  }
}

function drawBlend() {
  if (!restored) return;
  const strength = Number($("strength").value) / 100;
  // Paint the restoration at full strength, then blend in the original.
  resultContext.putImageData(restored, 0, 0);
  resultContext.globalAlpha = 1 - strength;
  resultContext.drawImage(original, 0, 0);
  resultContext.globalAlpha = 1;
}

function updateSplit() {
  comparison.style.setProperty("--split", $("split").value + "%");
}

function receive({ data }) {
  if (data.message) {
    status.textContent = data.message;
    return;
  }
  busy = false;
  if (data.error) {
    status.textContent = "Restoration failed. Try a smaller max edge or a desktop browser. " + data.error;
  } else {
    restored = new ImageData(data.result, original.width, original.height);
    drawBlend();
    status.textContent = "Restoration complete.";
  }
  showResult();
}

function restore() {
  if (!bitmap || busy || opening) return;
  if (openedFromDisk) {
    status.textContent = localServerMessage;
    return;
  }
  const model = $("model").value;
  if (model === "meanflow" && !$("seed").reportValidity()) return;
  const { width, height } = original;
  let pixels;
  try {
    pixels = context.getImageData(0, 0, width, height).data;
  } catch {
    status.textContent = "This image is too large to process at this size. Choose a smaller max edge.";
    return;
  }
  if (!worker) {
    worker = new Worker(workerUrl, { type: "module" });
    worker.onmessage = receive;
    worker.onerror = () => {
      worker.terminate();
      worker = undefined;
      receive({ data: { error: "The browser could not start the model runtime." } });
    };
  }
  busy = true;
  restored = undefined;
  showResult();
  status.textContent = "Preparing restoration…";
  worker.postMessage({
    model, width, height, pixels, steps: Number($("steps").value),
    seed: Number($("seed").value), quality: Number($("quality").value),
  }, [pixels.buffer]);
}

fileInput.addEventListener("change", () => {
  void openImage(fileInput.files[0]);
  fileInput.value = "";
});
function isFileDrag(transfer) {
  return transfer && (
    transfer.files.length > 0 ||
    Array.from(transfer.types).some((type) => type === "Files" || type === "application/x-moz-file") ||
    Array.from(transfer.items ?? []).some((item) => item.kind === "file")
  );
}

// Handle file drops across the page so the browser doesn't navigate to the image.
function acceptFileDrag(event) {
  if (!isFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  const canDrop = !busy && !opening;
  event.dataTransfer.dropEffect = canDrop ? "copy" : "none";
  stage.classList.toggle("drag", canDrop);
}
window.addEventListener("dragenter", acceptFileDrag, true);
window.addEventListener("dragover", acceptFileDrag, true);
window.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) stage.classList.remove("drag");
});
window.addEventListener("drop", (event) => {
  if (!isFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  stage.classList.remove("drag");
  if (busy || opening) return;
  const transfer = event.dataTransfer;
  const file = transfer.files[0] ??
    Array.from(transfer.items ?? []).find((item) => item.kind === "file")?.getAsFile();
  if (file) {
    void openImage(file);
  } else {
    status.textContent = "Drop an image file from your device.";
  }
}, true);
$("edge").addEventListener("change", () => { if (bitmap) preparePreview(); });
$("model").addEventListener("change", () => {
  const meanflow = $("model").value === "meanflow";
  $("flow-settings").hidden = !meanflow;
  $("quality-settings").hidden = meanflow;
});
$("quality").addEventListener("input", () => { $("quality-value").value = $("quality").value; });
$("random-seed").addEventListener("click", () => {
  $("seed").value = crypto.getRandomValues(new Uint32Array(1))[0];
});
$("strength").addEventListener("input", () => {
  $("strength-value").value = $("strength").value + "%";
  drawBlend();
});
$("split").addEventListener("input", updateSplit);
comparison.addEventListener("pointerdown", (event) => {
  if (!restored || event.button !== 0) return;
  comparison.setPointerCapture(event.pointerId);
  moveDivider(event);
});
comparison.addEventListener("pointermove", (event) => {
  if (comparison.hasPointerCapture(event.pointerId)) moveDivider(event);
});
function moveDivider(event) {
  const bounds = comparison.getBoundingClientRect();
  $("split").value = Math.round(100 * (event.clientX - bounds.left) / bounds.width);
  updateSplit();
}
$("restore").addEventListener("click", restore);
$("save").addEventListener("click", () => {
  const outputName = filename.replace(/\.[^.]+$/, "") + "_restored.png";
  result.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = outputName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }, "image/png");
});
