import { test } from "node:test";
import assert from "node:assert/strict";
import { aliasKey, findAlias, isModelAllowed, applyAllowlist } from "../src/model-utils.ts";

test("aliasKey: provider/id, or bare id", () => {
	assert.equal(aliasKey("openai", "gpt-4o"), "openai/gpt-4o");
	assert.equal(aliasKey(undefined, "gpt-4o"), "gpt-4o");
});

test("findAlias prefers provider/id over bare id", () => {
	const aliases = { "openai/gpt-4o": "Fancy", "gpt-4o": "Bare" };
	assert.equal(findAlias(aliases, "openai", "gpt-4o"), "Fancy");
	assert.equal(findAlias(aliases, undefined, "gpt-4o"), "Bare");
	assert.equal(findAlias(aliases, "other", "gpt-4o"), "Bare"); // fq miss → bare
	assert.equal(findAlias({}, "openai", "gpt-4o"), undefined);
});

test("isModelAllowed: missing key allows, list filters, [] hides all", () => {
	assert.equal(isModelAllowed({}, "openai", "x"), true); // no filter
	assert.equal(isModelAllowed({ openai: ["a", "b"] }, "openai", "a"), true);
	assert.equal(isModelAllowed({ openai: ["a", "b"] }, "openai", "c"), false);
	assert.equal(isModelAllowed({ openai: [] }, "openai", "a"), false); // hide-all
	assert.equal(isModelAllowed({ openai: ["a"] }, "groq", "a"), true); // other provider unfiltered
});

test("applyAllowlist: no filters returns unchanged; otherwise filters per provider", () => {
	const models = [
		{ provider: "openai", id: "a" },
		{ provider: "openai", id: "b" },
		{ provider: "groq", id: "c" },
	];
	assert.deepEqual(applyAllowlist(models, {}), models);
	assert.deepEqual(
		applyAllowlist(models, { openai: ["a"] }).map((m) => m.id),
		["a", "c"], // openai filtered to [a]; groq unfiltered
	);
	assert.deepEqual(
		applyAllowlist(models, { openai: [] }).map((m) => m.id),
		["c"], // openai hidden entirely
	);
});
