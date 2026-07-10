import { parse } from 'yaml';
import {
	buildContentStore,
	transformationType,
	type Direction,
	type Item,
	type ItemStore,
	type Rule,
	type RuleKind
} from '@lt/domain';

/**
 * Node/build-side content loader (the M9 split: fs+YAML here, validation+indexing in
 * the isomorphic domain `buildContentStore`). Vite globs the seed YAML and inlines it
 * as raw strings at build, so this works identically in dev, the built adapter-node
 * server, and the eventual offline PWA — no runtime filesystem, no path fragility.
 *
 * Shape validation lives here (authoring/loading concern); the four cross-record
 * FATAL invariants live in the domain.
 */
const files = import.meta.glob('../content/**/*.yaml', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

let cached: ItemStore | null = null;

/** Build (once, memoized) the validated, indexed content store from the seed YAML. */
export function contentStore(): ItemStore {
	if (!cached) cached = load(files);
	return cached;
}

/** Pure over its sources — the parse + shape-validate + build pipeline, unit-testable. */
export function load(sources: Record<string, string>): ItemStore {
	const rules: Rule[] = [];
	const items: Item[] = [];
	for (const [path, raw] of Object.entries(sources)) {
		const doc = (parse(raw) ?? {}) as { rules?: unknown[]; items?: unknown[] };
		if (Array.isArray(doc.rules)) {
			doc.rules.forEach((r, i) => rules.push(validateRule(r, `${path}#rules[${i}]`)));
		}
		if (Array.isArray(doc.items)) {
			doc.items.forEach((it, i) => items.push(validateItem(it, `${path}#items[${i}]`)));
		}
	}
	return buildContentStore(rules, items, [transformationType]);
}

const RULE_KINDS = new Set<RuleKind>([
	'transformation',
	'paradigm',
	'lexical',
	'syntax',
	'confusable',
	'phonetic',
	'meta'
]);
const DIRECTIONS = new Set<Direction>(['en>es', 'es>en']);
const TIERS = new Set(['primary', 'extended']);
const ROLES = new Set(['tests', 'uses']);

function validateRule(raw: unknown, where: string): Rule {
	const r = obj(raw, where);
	const kind = str(r.kind, where, 'kind');
	if (!RULE_KINDS.has(kind as RuleKind)) bad(where, `unknown rule kind "${kind}"`);
	return {
		key: str(r.key, where, 'key'),
		kind: kind as RuleKind,
		homeLesson: num(r.homeLesson, where, 'homeLesson'),
		bundle: str(r.bundle, where, 'bundle'),
		importance: num(r.importance, where, 'importance'),
		schedulable: bool(r.schedulable, where, 'schedulable'),
		label: opt(r.label, where, 'label'),
		parentKey: opt(r.parentKey, where, 'parentKey')
	};
}

function validateItem(raw: unknown, where: string): Item {
	const r = obj(raw, where);
	const kind = str(r.kind, where, 'kind');
	if (kind !== 'transformation')
		bad(where, `Phase 0 supports only kind "transformation", got "${kind}"`);

	if (!Array.isArray(r.directions) || r.directions.length === 0) {
		bad(where, '"directions" must be a non-empty array');
	}
	const directions = (r.directions as unknown[]).map((d) => {
		if (!DIRECTIONS.has(d as Direction)) bad(where, `unknown direction "${String(d)}"`);
		return d as Direction;
	});

	if (!Array.isArray(r.rule_refs) || r.rule_refs.length === 0) {
		bad(where, '"rule_refs" must be a non-empty array');
	}
	const rule_refs = (r.rule_refs as unknown[]).map((ref) => {
		const rr = obj(ref, where);
		const role = str(rr.role, where, 'rule_refs[].role');
		if (!ROLES.has(role)) bad(where, `unknown rule_ref role "${role}"`);
		return { key: str(rr.key, where, 'rule_refs[].key'), role: role as 'tests' | 'uses' };
	});

	const tier = str(r.tier, where, 'tier');
	if (!TIERS.has(tier)) bad(where, `unknown tier "${tier}"`);

	if (!Array.isArray(r.related_lessons) || !r.related_lessons.every((n) => typeof n === 'number')) {
		bad(where, '"related_lessons" must be an array of numbers');
	}

	return {
		id: str(r.id, where, 'id'),
		kind: 'transformation',
		front_en: str(r.front_en, where, 'front_en'),
		back_es: str(r.back_es, where, 'back_es'),
		hint: opt(r.hint, where, 'hint'),
		accepted_answers:
			r.accepted_answers === undefined
				? undefined
				: strArray(r.accepted_answers, where, 'accepted_answers'),
		min_lesson: num(r.min_lesson, where, 'min_lesson'),
		directions,
		rule_refs,
		tier: tier as 'primary' | 'extended',
		related_lessons: r.related_lessons as number[]
	};
}

// --- tiny hand-rolled validation primitives (keeps the domain dependency-free) ---
function bad(where: string, msg: string): never {
	throw new Error(`content ${where}: ${msg}`);
}
function obj(v: unknown, where: string): Record<string, unknown> {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(where, 'expected a mapping');
	return v as Record<string, unknown>;
}
function str(v: unknown, where: string, field: string): string {
	if (typeof v !== 'string' || v.length === 0) bad(where, `"${field}" must be a non-empty string`);
	return v;
}
function num(v: unknown, where: string, field: string): number {
	if (typeof v !== 'number' || !Number.isFinite(v)) bad(where, `"${field}" must be a number`);
	return v;
}
function bool(v: unknown, where: string, field: string): boolean {
	if (typeof v !== 'boolean') bad(where, `"${field}" must be a boolean`);
	return v;
}
function opt(v: unknown, where: string, field: string): string | undefined {
	return v === undefined ? undefined : str(v, where, field);
}
function strArray(v: unknown, where: string, field: string): string[] {
	if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) {
		bad(where, `"${field}" must be an array of strings`);
	}
	return v as string[];
}
