// Image attachments for the prompt: clipboard paste, 📎 file picker, and
// drag-and-drop. Pending attachments are held as module state, shown as
// removable thumbnail chips above the textarea, and sent alongside the prompt
// text as Pi image parts ({ type:"image", data:<base64>, mimeType }). Large
// images are downscaled (longest edge ≤ MAX_EDGE) before encoding; smaller ones
// keep their original bytes. The on-the-wire base64 has no `data:` prefix; the
// `data:` URL is kept only for the in-webview thumbnail preview.

import { appendSystem, buildImageBadge, defaultImageName, els } from "./dom";
import { t } from "./i18n";

const MAX_EDGE = 1568; // longest-edge cap (Anthropic's recommended vision max)
const MAX_COUNT = 10; // max attachments per message

export interface ImagePart {
	type: "image";
	data: string; // raw base64, no data: prefix
	mimeType: string;
}

interface Attachment {
	id: string;
	name: string; // filename (picker/drop) or a mime-derived default (paste)
	mimeType: string;
	data: string; // raw base64
	dataUrl: string; // data: URL for the thumbnail preview
}

const pending: Attachment[] = [];
let idCounter = 0;

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("image load failed"));
		img.src = url;
	});
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result));
		r.onerror = () => reject(r.error ?? new Error("read failed"));
		r.readAsDataURL(blob);
	});
}

/** Split a `data:<mime>;base64,<payload>` URL into its mime + raw base64. */
function splitDataUrl(dataUrl: string, fallbackMime: string): { mimeType: string; data: string } {
	const comma = dataUrl.indexOf(",");
	const head = comma >= 0 ? dataUrl.slice(0, comma) : "";
	const m = /^data:([^;,]+)/.exec(head);
	return {
		mimeType: m?.[1] || fallbackMime,
		data: comma >= 0 ? dataUrl.slice(comma + 1) : "",
	};
}

/** Encode a blob to an Attachment, downscaling only if the longest edge exceeds
 *  MAX_EDGE. Small images keep their original bytes + mime; resized ones are
 *  re-encoded to JPEG (if the source was JPEG) or PNG.
 *
 *  Note: the image is loaded from a `data:` URL, NOT `URL.createObjectURL`. The
 *  chat webview CSP allows `img-src ... data:` but not `blob:`, so loading an
 *  Image from an object URL fails (onerror) and no chip ever appears. */
async function processBlob(blob: Blob, name: string): Promise<Attachment | null> {
	try {
		const srcDataUrl = await blobToDataUrl(blob);
		const img = await loadImage(srcDataUrl);
		const longest = Math.max(img.naturalWidth, img.naturalHeight);
		if (longest <= MAX_EDGE || longest === 0) {
			const { mimeType, data } = splitDataUrl(srcDataUrl, blob.type || "image/png");
			return { id: String(++idCounter), name, mimeType, data, dataUrl: srcDataUrl };
		}
		const scale = MAX_EDGE / longest;
		const w = Math.max(1, Math.round(img.naturalWidth * scale));
		const h = Math.max(1, Math.round(img.naturalHeight * scale));
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.drawImage(img, 0, 0, w, h);
		const outMime = blob.type === "image/jpeg" ? "image/jpeg" : "image/png";
		const dataUrl = canvas.toDataURL(outMime, outMime === "image/jpeg" ? 0.92 : undefined);
		const { mimeType, data } = splitDataUrl(dataUrl, outMime);
		return { id: String(++idCounter), name, mimeType, data, dataUrl };
	} catch {
		return null;
	}
}

/** Add image blobs (from paste / file picker / drop), honoring MAX_COUNT. */
export async function addBlobs(blobs: Blob[]): Promise<void> {
	const images = blobs.filter((b) => b && b.type.startsWith("image/"));
	if (images.length === 0) return;
	const room = MAX_COUNT - pending.length;
	if (room <= 0) {
		appendSystem(t("chat.attachTooMany", { n: String(MAX_COUNT) }));
		return;
	}
	const take = images.slice(0, room);
	if (images.length > take.length) appendSystem(t("chat.attachTooMany", { n: String(MAX_COUNT) }));
	for (const blob of take) {
		// File (picker/drop) carries a name; a pasted blob doesn't → mime default.
		const name = (blob as File).name || defaultImageName(blob.type || "image/png");
		const att = await processBlob(blob, name);
		if (att) pending.push(att);
	}
	renderChips();
}

function renderChips(): void {
	const strip = els().attachments;
	strip.innerHTML = "";
	if (pending.length === 0) {
		strip.classList.add("hidden");
		return;
	}
	strip.classList.remove("hidden");
	for (const a of pending) {
		strip.appendChild(
			buildImageBadge({
				dataUrl: a.dataUrl,
				name: a.name,
				onRemove: () => removeAttachment(a.id),
			}),
		);
	}
}

function removeAttachment(id: string): void {
	const i = pending.findIndex((a) => a.id === id);
	if (i >= 0) {
		pending.splice(i, 1);
		renderChips();
	}
}

export function clearAttachments(): void {
	pending.length = 0;
	renderChips();
}

export function hasAttachments(): boolean {
	return pending.length > 0;
}

/** Pi image parts for the outgoing prompt (drops the preview-only dataUrl). */
export function getAttachmentsForSend(): ImagePart[] {
	return pending.map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType }));
}

/** Image metadata for echoing into the sent user bubble (includes the filename,
 *  which the Pi parts omit). Call before clearAttachments(). */
export function getAttachmentsForBubble(): { data: string; mimeType: string; name: string }[] {
	return pending.map((a) => ({ data: a.data, mimeType: a.mimeType, name: a.name }));
}

/** Wire paste / file-picker / drag-and-drop. Call once at boot. */
export function wireAttachments(): void {
	const e = els();

	e.prompt.addEventListener("paste", (ev: ClipboardEvent) => {
		const items = ev.clipboardData?.items;
		if (!items) return;
		const blobs: Blob[] = [];
		for (const it of Array.from(items)) {
			if (it.kind === "file" && it.type.startsWith("image/")) {
				const f = it.getAsFile();
				if (f) blobs.push(f);
			}
		}
		// Only swallow the paste when it carried an image — plain-text paste
		// must still land in the textarea as usual.
		if (blobs.length > 0) {
			ev.preventDefault();
			void addBlobs(blobs);
		}
	});

	e.btnAttach.addEventListener("click", () => e.fileInput.click());
	e.fileInput.addEventListener("change", () => {
		const files = e.fileInput.files;
		if (files && files.length) void addBlobs(Array.from(files));
		e.fileInput.value = ""; // allow re-picking the same file
	});

	const area = e.prompt.closest(".prompt-area") as HTMLElement | null;
	if (area) {
		area.addEventListener("dragover", (ev: DragEvent) => {
			if (ev.dataTransfer && Array.from(ev.dataTransfer.types).includes("Files")) {
				ev.preventDefault();
				area.classList.add("drag-over");
			}
		});
		area.addEventListener("dragleave", (ev: DragEvent) => {
			if (ev.target === area) area.classList.remove("drag-over");
		});
		area.addEventListener("drop", (ev: DragEvent) => {
			const files = ev.dataTransfer?.files;
			if (files && files.length) {
				ev.preventDefault();
				area.classList.remove("drag-over");
				void addBlobs(Array.from(files));
			}
		});
	}
}
