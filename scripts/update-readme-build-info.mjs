import fs from "node:fs";
import path from "node:path";

const README_PATH = path.resolve(process.cwd(), "README.md");

const START = "<!-- vuehex:build-info:start -->";
const END = "<!-- vuehex:build-info:end -->";

function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return "unknown";
	}
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	const precision = unitIndex === 0 ? 0 : unitIndex === 1 ? 1 : 2;
	return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function toNumber(value) {
	if (value == null) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

const version = process.env.VUEHEX_VERSION ?? "";
const tarballBytes = toNumber(process.env.VUEHEX_TARBALL_BYTES);
const distBytes = toNumber(process.env.VUEHEX_DIST_BYTES);

// Prefer a real timestamp if provided; allow workflow to pass something else.
const updatedAt =
	process.env.VUEHEX_UPDATED_AT ??
	new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const blockLines = [
	START,
	"",
	"## Build info",
	"",
	"Latest published build (updated by CI):",
	"",
	`- Version: ${version || "unknown"}`,
	`- npm tarball size: ${formatBytes(tarballBytes ?? Number.NaN)}${tarballBytes != null ? ` (${tarballBytes} bytes)` : ""}`,
	`- dist/ size (uncompressed): ${formatBytes(distBytes ?? Number.NaN)}${distBytes != null ? ` (${distBytes} bytes)` : ""}`,
	`- Updated: ${updatedAt}`,
	"",
	END,
	"",
];

const nextBlock = blockLines.join("\n");

const readme = fs.readFileSync(README_PATH, "utf8");

const hasMarkers = readme.includes(START) && readme.includes(END);

let updated;
if (hasMarkers) {
	const re = new RegExp(`${START}[\\s\\S]*?${END}\\n?`, "m");
	updated = readme.replace(re, nextBlock);
} else {
	// Insert after the initial badges (after the first blank line following the title).
	const titleMatch = readme.match(/^#\s+.*\n(?:.*\n)*?\n/m);
	if (titleMatch?.index != null) {
		const insertAt = titleMatch.index + titleMatch[0].length;
		updated = readme.slice(0, insertAt) + nextBlock + readme.slice(insertAt);
	} else {
		updated = nextBlock + readme;
	}
}

if (updated !== readme) {
	fs.writeFileSync(README_PATH, updated, "utf8");
	process.stdout.write("README updated.\n");
} else {
	process.stdout.write("README already up to date.\n");
}
